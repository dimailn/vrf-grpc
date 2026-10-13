import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRouterTransport, ConnectError, Code, Transport } from '@connectrpc/connect'
import { BadRequest } from '../gen/ts/google/rpc/error_details_pb'
import { TodoService } from '../gen/ts/todo/v1/todo_connect'
import { Todo, ListTodosResponse } from '../gen/ts/todo/v1/todo_pb'
import { driveForm } from './support/form'

// Records the request each RPC received, so we can assert how the convention
// path shapes requests.
let seen: Record<string, any>

function makeTransport(): Transport {
  seen = {}
  return createRouterTransport((router) => {
    router.service(TodoService, {
      getTodo(req) {
        seen.getTodo = req
        return new Todo({ id: req.id, title: 'Loaded', description: 'd' })
      },
      createTodo(req) {
        seen.createTodo = req
        if (!req.todo?.title) {
          throw new ConnectError('validation failed', Code.InvalidArgument, undefined, [
            new BadRequest({ fieldViolations: [{ field: 'title', description: "can't be blank" }] }),
          ])
        }
        return new Todo({ id: '42', title: req.todo.title })
      },
      updateTodo(req) {
        seen.updateTodo = req
        return new Todo({ id: req.id, title: req.todo?.title })
      },
      completeTodo(req) {
        seen.completeTodo = req
        return new Todo({ id: req.id, completed: true })
      },
      listTodos(req) {
        seen.listTodos = req
        return new ListTodosResponse({
          todos: [new Todo({ id: '1', title: 'a' }), new Todo({ id: '2', title: 'b' })],
        })
      },
      deleteTodo() {
        return {}
      },
    })
  })
}

let transport: Transport
const resources = () => ({ Todo: TodoService })

beforeEach(() => {
  transport = makeTransport()
})

describe('convention — onLoad', () => {
  it('calls GetTodo with { id } and returns a plain resource', async () => {
    const { listeners } = driveForm({ name: 'Todo', rfId: '7' }, { transport, resources: resources() })
    const res = await listeners.onLoad('7')

    assert.equal(seen.getTodo.id, '7')
    assert.deepEqual(res, { id: '7', title: 'Loaded', description: 'd', completed: false, createdAt: '' })
  })

  it('returns {} for a new record without fetching', async () => {
    const { listeners } = driveForm({ name: 'Todo', rfId: null }, { transport, resources: resources() })
    const res = await listeners.onLoad(undefined)

    assert.deepEqual(res, {})
    assert.equal(seen.getTodo, undefined)
  })
})

describe('convention — onCreate', () => {
  it('wraps the resource under the lowercased name and returns the new id', async () => {
    const { listeners } = driveForm({ name: 'Todo' }, { transport, resources: resources() })
    const [ok, id] = await listeners.onCreate({ title: 'Hello' })

    assert.equal(seen.createTodo.todo.title, 'Hello')
    assert.equal(ok, true)
    assert.equal(id, '42')
  })

  it('maps a BadRequest validation error to field errors', async () => {
    const { listeners, messages } = driveForm({ name: 'Todo' }, { transport, resources: resources() })
    const [ok, errors] = await listeners.onCreate({ title: '' })

    assert.equal(ok, false)
    assert.deepEqual(errors, { title: ["can't be blank"] })
    // field-level error → no form-level message emitted
    assert.equal(messages.length, 0)
  })
})

describe('convention — onUpdate', () => {
  it('calls UpdateTodo with { id, todo } and returns the updated resource', async () => {
    const { listeners } = driveForm({ name: 'Todo', rfId: '7' }, { transport, resources: resources() })
    const [ok, res] = await listeners.onUpdate({ title: 'New' })

    assert.equal(seen.updateTodo.id, '7')
    assert.equal(seen.updateTodo.todo.title, 'New')
    assert.equal(ok, true)
    assert.equal(res.id, '7')
    assert.equal(res.title, 'New')
  })
})

describe('convention — onSave / actions', () => {
  it('returns a synchronous undefined for non-action forms (falls through to create/update)', () => {
    const { listeners } = driveForm({ name: 'Todo', rfId: '7' }, { transport, resources: resources() })
    const result = listeners.onSave({})

    assert.equal(result, undefined) // not a Promise
  })

  it('routes an action form to {verb}{Name}', async () => {
    const { listeners } = driveForm({ name: 'Todo#complete', rfId: '7' }, { transport, resources: resources() })
    const [ok, res] = await listeners.onSave({})

    assert.equal(seen.completeTodo.id, '7')
    assert.equal(ok, true)
    assert.equal(res.completed, true)
  })
})

describe('convention — sources', () => {
  it('loads a collection via List{Name} and returns the array field', async () => {
    const { listeners } = driveForm({ name: 'Todo' }, { transport, resources: resources() })
    const todos = await listeners.onLoadSource('todos')

    assert.ok(seen.listTodos)
    assert.equal(todos.length, 2)
    assert.equal(todos[0].id, '1')
  })

  it('onLoadSources indexes several sources by name', async () => {
    const { listeners } = driveForm({ name: 'Todo' }, { transport, resources: resources() })
    const index = await listeners.onLoadSources(['todos'])

    assert.deepEqual(Object.keys(index), ['todos'])
    assert.equal(index.todos.length, 2)
  })
})
