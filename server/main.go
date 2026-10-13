package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"connectrpc.com/connect"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	todov1 "github.com/dimailn/vrf-grpc/server/gen/todo/v1"
	"github.com/dimailn/vrf-grpc/server/gen/todo/v1/todov1connect"
)

// store is a tiny in-memory todo repository.
type store struct {
	mu    sync.Mutex
	seq   int
	todos map[string]*todov1.Todo
}

func newStore() *store {
	s := &store{todos: map[string]*todov1.Todo{}}
	// Seed one item so the playground has something to load.
	s.create(&todov1.Todo{Title: "Try vrf-grpc", Description: "Open the playground form"})
	return s
}

func (s *store) create(t *todov1.Todo) *todov1.Todo {
	s.seq++
	t.Id = strconv.Itoa(s.seq)
	t.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	s.todos[t.Id] = t
	return t
}

// TodoServer implements the generated TodoServiceHandler.
type TodoServer struct {
	store *store
}

func (srv *TodoServer) GetTodo(
	_ context.Context,
	req *connect.Request[todov1.GetTodoRequest],
) (*connect.Response[todov1.Todo], error) {
	srv.store.mu.Lock()
	defer srv.store.mu.Unlock()

	t, ok := srv.store.todos[req.Msg.Id]
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("todo %q not found", req.Msg.Id))
	}
	return connect.NewResponse(t), nil
}

func (srv *TodoServer) ListTodos(
	_ context.Context,
	req *connect.Request[todov1.ListTodosRequest],
) (*connect.Response[todov1.ListTodosResponse], error) {
	srv.store.mu.Lock()
	defer srv.store.mu.Unlock()

	out := &todov1.ListTodosResponse{}
	for _, t := range srv.store.todos {
		if req.Msg.Completed != nil && *req.Msg.Completed != t.Completed {
			continue
		}
		out.Todos = append(out.Todos, t)
	}
	return connect.NewResponse(out), nil
}

func (srv *TodoServer) CreateTodo(
	_ context.Context,
	req *connect.Request[todov1.CreateTodoRequest],
) (*connect.Response[todov1.Todo], error) {
	if err := validateTodo(req.Msg.Todo); err != nil {
		return nil, err
	}

	srv.store.mu.Lock()
	defer srv.store.mu.Unlock()

	t := srv.store.create(&todov1.Todo{
		Title:       req.Msg.Todo.GetTitle(),
		Description: req.Msg.Todo.GetDescription(),
		Completed:   req.Msg.Todo.GetCompleted(),
	})
	return connect.NewResponse(t), nil
}

func (srv *TodoServer) UpdateTodo(
	_ context.Context,
	req *connect.Request[todov1.UpdateTodoRequest],
) (*connect.Response[todov1.Todo], error) {
	if err := validateTodo(req.Msg.Todo); err != nil {
		return nil, err
	}

	srv.store.mu.Lock()
	defer srv.store.mu.Unlock()

	t, ok := srv.store.todos[req.Msg.Id]
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("todo %q not found", req.Msg.Id))
	}
	t.Title = req.Msg.Todo.GetTitle()
	t.Description = req.Msg.Todo.GetDescription()
	t.Completed = req.Msg.Todo.GetCompleted()
	return connect.NewResponse(t), nil
}

func (srv *TodoServer) DeleteTodo(
	_ context.Context,
	req *connect.Request[todov1.DeleteTodoRequest],
) (*connect.Response[todov1.DeleteTodoResponse], error) {
	srv.store.mu.Lock()
	defer srv.store.mu.Unlock()

	delete(srv.store.todos, req.Msg.Id)
	return connect.NewResponse(&todov1.DeleteTodoResponse{}), nil
}

func (srv *TodoServer) CompleteTodo(
	_ context.Context,
	req *connect.Request[todov1.CompleteTodoRequest],
) (*connect.Response[todov1.Todo], error) {
	srv.store.mu.Lock()
	defer srv.store.mu.Unlock()

	t, ok := srv.store.todos[req.Msg.Id]
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("todo %q not found", req.Msg.Id))
	}
	t.Completed = true
	return connect.NewResponse(t), nil
}

// validateTodo returns an InvalidArgument error carrying a google.rpc.BadRequest
// detail so the adapter can map field violations to vrf's per-field errors.
func validateTodo(t *todov1.Todo) error {
	if t != nil && t.GetTitle() != "" {
		return nil
	}

	br := &errdetails.BadRequest{
		FieldViolations: []*errdetails.BadRequest_FieldViolation{
			{Field: "title", Description: "can't be blank"},
		},
	}
	err := connect.NewError(connect.CodeInvalidArgument, errors.New("validation failed"))
	if detail, derr := connect.NewErrorDetail(br); derr == nil {
		err.AddDetail(detail)
	}
	return err
}

func main() {
	srv := &TodoServer{store: newStore()}

	mux := http.NewServeMux()
	path, handler := todov1connect.NewTodoServiceHandler(srv)
	mux.Handle(path, withCORS(handler))

	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	log.Printf("vrf-grpc playground server listening on %s (path %s)", addr, path)
	// h2c lets us serve gRPC/Connect over plaintext HTTP/2 for local dev.
	if err := http.ListenAndServe(addr, h2c.NewHandler(mux, &http2.Server{})); err != nil {
		log.Fatal(err)
	}
}

// withCORS allows the Vite playground (different origin) to call the server.
func withCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers",
			"Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, X-Grpc-Web, X-User-Agent")
		w.Header().Set("Access-Control-Expose-Headers",
			"Grpc-Status, Grpc-Message, Connect-Content-Encoding")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}
