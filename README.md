# vrf-grpc

A **gRPC effect for the [vrf](https://github.com/dimailn/vrf) form engine**, built
on the [Connect](https://connectrpc.com) protocol.

`vrf-grpc` maps vrf's form lifecycle (`onLoad` / `onCreate` / `onUpdate` /
actions / sources) onto the RPC methods of a **generated Connect client**, so a
declarative `<rf-form>` talks to your gRPC service with little to no glue code.

```vue
<rf-form name="Todo" :rf-id="1" auto>
  <rf-input name="title" />
  <rf-submit />
</rf-form>
```

```ts
import { createConnectTransport } from '@connectrpc/connect-web'
import grpc from 'vrf-grpc'
import { TodoService } from './gen/todo/v1/todo_connect'

app.use(Vrf, {
  effects: [
    grpc({
      transport: createConnectTransport({ baseUrl: 'http://localhost:8080' }),
      resources: {
        Todo: TodoService, // see "Convention over configuration"
      },
    }),
  ],
})
```

---

## Installation

```bash
npm install vrf-grpc @connectrpc/connect @connectrpc/connect-web @bufbuild/protobuf
```

`@connectrpc/connect` and `@bufbuild/protobuf` are peer dependencies; pick a
transport from `@connectrpc/connect-web` (browser) or `@connectrpc/connect-node`.

You bring your own generated client. Generate it from your `.proto` with
[`buf`](https://buf.build) using `protoc-gen-es` + `protoc-gen-connect-es`
(see [`buf.gen.yaml`](./buf.gen.yaml) for a working example).

---

## Convention over configuration

In the common case you register a resource by handing over **just the generated
service** — the adapter derives every RPC it needs from the resource name.

```ts
resources: {
  Todo: TodoService,
}
```

Given a form whose `name` is `Todo`, the adapter wires vrf's lifecycle to these
RPCs (method names are the camelCase the Connect client exposes):

| vrf lifecycle                    | RPC called           | Request sent                       | Used from response            |
| -------------------------------- | -------------------- | ---------------------------------- | ----------------------------- |
| `onLoad(id)`                     | `GetTodo`            | `{ id }`                           | the whole message → resource  |
| `onCreate(resource)`             | `CreateTodo`         | `{ todo: resource }`               | `response.id`                 |
| `onUpdate(resource)`             | `UpdateTodo`         | `{ id, todo: resource }`           | the whole message → resource  |
| action `Todo#complete`           | `CompleteTodo`       | `{ id }`                           | the whole message → resource  |
| source `todos`                   | `ListTodos`          | `{}`                               | `response.todos` (or 1st list)|

### The naming rules

For a resource registered under the key `Name` (the form's `name`, minus any
`#action` suffix):

- **load** → `get{Name}` → `client.get{Name}({ id })`
- **create** → `create{Name}` → `client.create{Name}({ {name}: resource })`
- **update** → `update{Name}` → `client.update{Name}({ id, {name}: resource })`
- **action `#verb`** → `{verb}{Name}` → `client.{verb}{Name}({ id })`
- **source `foos`** → `list{Foos}` → `client.list{Foos}({})`, then `response.foos`

where `{name}` is the resource key with a lowercase first letter (`Todo` → `todo`).

### Data mapping

- **Responses → resources.** `protobuf-es` already emits **camelCase** fields in
  TypeScript, which matches vrf's conventions — no `camelize`/`decamelize` dance
  (unlike REST). The response message is converted to a plain object with
  `toPlainMessage` before it reaches the form.
- **Resources → requests.** The plain form resource is passed straight through as
  a Connect `PartialMessage`. By convention it is wrapped under the lowercased
  resource key (`{ todo: resource }`).
- **Id extraction on create.** The created id is read from `response.id` (change
  the field via [`idField`](#configuration-reference)).

### Errors

Connect errors are normalized into vrf's shape:

- A [`google.rpc.BadRequest`](https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto)
  detail is turned into **per-field errors** (`{ title: ["can't be blank"] }`)
  and fed back to the form, so each message lands on its field.
- Everything else becomes a form-level (`base`) error and is surfaced via
  `showMessage`.
- The gRPC status code is mapped to a vrf `statusHandle`:

  | gRPC code                                                        | `statusHandle`     |
  | ---------------------------------------------------------------- | ------------------ |
  | `INVALID_ARGUMENT`, `FAILED_PRECONDITION`, `OUT_OF_RANGE`, `ALREADY_EXISTS`, `RESOURCE_EXHAUSTED` | `SOFT_FAILURE`     |
  | `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `CANCELED`                   | `NETWORK_FAILURE`  |
  | `INTERNAL`, `DATA_LOSS`, `UNKNOWN`, `UNIMPLEMENTED`              | `SERVER_FAILURE`   |
  | everything else                                                  | `OTHER_FAILURE`    |

To emit field errors from your own server, attach a `google.rpc.BadRequest` with
`field_violations` to an `INVALID_ARGUMENT` error (see
[`server/main.go`](./server/main.go) for a Go example).

---

## When you don't control the contract

Convention only works when the service follows the `Get/Create/Update/List` shape
and flat `{ id }` / `{ name: resource }` requests. Real-world and third-party
contracts rarely do: methods are named `FetchTask`, requests are nested
differently, responses wrap the resource, the id field is `task_id`, and so on.

For those cases, register a **`ResourceConfig`** instead of the bare service and
override only the handlers that deviate. Everything you don't override still falls
back to convention.

```ts
resources: {
  // The form is still <rf-form name="Todo">, but it is backed by a foreign
  // TaskService whose shape we don't control.
  Todo: {
    service: TaskService,

    // GetTask takes { taskId } and returns { task } — unwrap it.
    load: (client, { id }) =>
      client.fetchTask({ taskId: String(id) }).then((res) => res.task),

    // AddTask takes { data } and returns { taskId }. Return the response and
    // point idField at the id so the adapter can extract it (see below).
    create: (client, { resource }) => client.addTask({ data: resource }),
    idField: 'taskId',

    // SaveTask takes { taskId, data } and returns the Task directly.
    update: (client, { id, resource }) =>
      client.saveTask({ taskId: String(id), data: resource }),

    // Collections come from Tasks() -> { items }.
    source: (client, name) => client.tasks({}).then((res) => res.items),

    // Arbitrary action RPCs, keyed by the vrf action verb (Todo#archive).
    actions: {
      archive: (client, { id }) => client.archiveTask({ taskId: String(id) }),
    },
  },
}
```

### What a handler receives and returns

Each handler gets the **cached Connect client** for the resource and a context:

```ts
interface HandlerContext {
  id?: string | number // current resource id (load / update / actions)
  resource?: any        // the plain form resource (create / update / actions)
  action?: string       // the action verb, for action handlers
  form: any             // the live vrf form instance (namespace, single, …)
}
```

Return values:

| Handler            | Return                                                              |
| ------------------ | ------------------------------------------------------------------- |
| `load`             | the resource message (run through `toPlainMessage`)                 |
| `create`           | a message carrying the new id (read via `idField`, default `"id"`)  |
| `update`           | the updated resource message (run through `toPlainMessage`)         |
| `actions[verb]`    | the resource message (run through `toPlainMessage`)                 |
| `source`           | the array **verbatim** (not converted — map it yourself if needed)  |

Because handlers are plain functions over the generated client, you get full
**type safety and autocomplete** on the real request/response messages — the
convention path trades that for zero config.

### Common adaptations

- **Different method names** → override `load` / `create` / `update`, or add
  `actions` with the verb you use in the form name.
- **Wrapped responses** (`GetXResponse { X x = 1 }`) → `.then((r) => r.x)` in the
  handler.
- **Nested / flat request bodies** → shape the request object yourself; nothing is
  wrapped for you when you override.
- **Custom id field** on the create response → set `idField`.
- **Field masks on update** → build the `update_mask` inside your `update` handler.

---

## Configuration reference

```ts
grpc(options: GrpcOptions): Effect
```

```ts
interface GrpcOptions {
  transport: Transport                       // from @connectrpc/connect-web (or -node)
  resources: Record<string, ResourceEntry>   // keyed by the form's resource name
}

type ResourceEntry = ServiceType | ResourceConfig

interface ResourceConfig {
  service: ServiceType        // required: the generated Connect service
  idField?: string            // create-response id field (default "id")
  load?:   (client, ctx) => Promise<Message>
  create?: (client, ctx) => Promise<Message>
  update?: (client, ctx) => Promise<Message>
  source?: (client, name: string) => Promise<any[]>
  actions?: Record<string, (client, ctx) => Promise<Message>>
}
```

The registry is keyed by the form's **resource name** — i.e. `<rf-form name="Todo">`
maps to `resources.Todo`. An action form `name="Todo#complete"` uses the same
`Todo` entry and routes to its `actions.complete` (or, by convention,
`CompleteTodo`).

---

## Repository layout

This repo is both the adapter and a runnable playground.

```
proto/                   # the contract — single source of truth
  todo/v1/todo.proto     #   Todo + TodoService
  google/rpc/…           #   vendored BadRequest (type-URL compatible with googleapis)
buf.gen.yaml             # codegen: Go (server/gen) + TypeScript (gen/ts)
server/                  # Go Connect server with an in-memory store
src/                     # the adapter
  index.ts               #   Effect factory + resource registry
  errors.ts              #   ConnectError → vrf field errors / statusHandle
  map-status.ts          #   gRPC code → vrf statusHandle
gen/ts/                  # generated TypeScript client (shared by adapter + playground)
playground/              # Vue 3 master–detail Todo app driving live rf-forms
  kit/                   #   a minimal vrf UI-kit (RfInput / RfCheckbox / RfSubmit)
scripts/e2e.mts          # headless end-to-end check of the adapter
```

---

## Running the playground

Requires Go, Node, and [`buf`](https://buf.build) (plus the protoc plugins) for
(re)generation.

```bash
npm run generate     # buf generate → server/gen (Go) + gen/ts (TypeScript)
npm run server       # Connect server (defaults to :8099 here; :8080 was taken)
npm run playground   # Vue playground at http://localhost:5173
```

The playground is a master–detail Todo list: the form panel is an `<rf-form>`
driven by the adapter (`GetTodo` on select, `CreateTodo` / `UpdateTodo` on save),
while list/toggle/delete call the generated Connect client directly. Submit with
an empty title to watch a server-side validation error land on the field.

### Headless check (no browser)

```bash
npm run server
npm run e2e          # drives the effect against the server; prints 6/6 checks
```

---

## Tests

Unit tests run on Node's built-in test runner via `tsx` — no server, no browser.
They drive the effect through a fake vrf form context against an **in-memory
Connect transport** (`createRouterTransport`), covering both the convention path
and the override path for non-conventional contracts, plus error/status mapping.

```bash
npm test             # tsx --test test/*.test.ts
npm run test:watch
```

CI runs the suite and the package build on Node 20 & 22, plus a Go build of the
server, via [GitHub Actions](./.github/workflows/ci.yml).

## Building the package

```bash
npm run build        # tsup → dist/ (CJS + ESM + d.ts)
```

Only `dist/` is published (`package.json#files`); the playground, proto, server,
generated code and tests stay out of the npm tarball.

## License

MIT
