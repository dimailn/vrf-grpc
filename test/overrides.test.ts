import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRouterTransport, Transport } from '@connectrpc/connect'
import { TaskService } from '../gen/ts/task/v1/task_connect'
import { Task, FetchTaskResponse, AddTaskResponse, TasksResponse } from '../gen/ts/task/v1/task_pb'
import { driveForm } from './support/form'
import type { ResourceConfig } from '../src/index'

// A form named "Todo" backed by a foreign, non-conventional TaskService.
let seen: Record<string, any>

function makeTransport(): Transport {
  seen = {}
  return createRouterTransport((router) => {
    router.service(TaskService, {
      fetchTask(req) {
        seen.fetchTask = req
        return new FetchTaskResponse({ task: new Task({ taskId: req.taskId, label: 'L', done: false }) })
      },
      addTask(req) {
        seen.addTask = req
        return new AddTaskResponse({ taskId: '99' })
      },
      saveTask(req) {
        seen.saveTask = req
        return new Task({ taskId: req.taskId, label: req.data?.label, done: req.data?.done })
      },
      tasks(req) {
        seen.tasks = req
        return new TasksResponse({ items: [new Task({ taskId: '1', label: 'a' }), new Task({ taskId: '2' })] })
      },
      archiveTask(req) {
        seen.archiveTask = req
        return new Task({ taskId: req.taskId, done: true })
      },
    })
  })
}

let transport: Transport

// The bridge: overrides for every operation the foreign contract shapes differently.
const bridged = (): ResourceConfig => ({
  service: TaskService,
  idField: 'taskId',
  load: (c, { id }) => c.fetchTask({ taskId: String(id) }).then((r) => r.task),
  create: (c, { resource }) => c.addTask({ data: resource }),
  update: (c, { id, resource }) => c.saveTask({ taskId: String(id), data: resource }),
  source: (c) => c.tasks({}).then((r) => r.items),
  actions: {
    archive: (c, { id }) => c.archiveTask({ taskId: String(id) }),
  },
})

beforeEach(() => {
  transport = makeTransport()
})

describe('overrides — load', () => {
  it('unwraps a nested response (FetchTaskResponse.task)', async () => {
    const { listeners } = driveForm({ name: 'Todo', rfId: '5' }, { transport, resources: { Todo: bridged() } })
    const res = await listeners.onLoad('5')

    assert.equal(seen.fetchTask.taskId, '5')
    assert.deepEqual(res, { taskId: '5', label: 'L', done: false })
  })
})

describe('overrides — create', () => {
  it('nests the resource under { data } and reads id from idField', async () => {
    const { listeners } = driveForm({ name: 'Todo' }, { transport, resources: { Todo: bridged() } })
    const [ok, id] = await listeners.onCreate({ label: 'New' })

    assert.equal(seen.addTask.data.label, 'New')
    assert.equal(ok, true)
    assert.equal(id, '99') // extracted via idField: 'taskId'
  })
})

describe('overrides — update', () => {
  it('maps to SaveTask({ task_id, data })', async () => {
    const { listeners } = driveForm({ name: 'Todo', rfId: '5' }, { transport, resources: { Todo: bridged() } })
    const [ok, res] = await listeners.onUpdate({ label: 'Upd', done: true })

    assert.equal(seen.saveTask.taskId, '5')
    assert.equal(seen.saveTask.data.label, 'Upd')
    assert.equal(seen.saveTask.data.done, true)
    assert.equal(ok, true)
    assert.equal(res.taskId, '5')
    assert.equal(res.label, 'Upd')
  })
})

describe('overrides — actions', () => {
  it('routes Todo#archive to the actions.archive handler', async () => {
    const { listeners } = driveForm({ name: 'Todo#archive', rfId: '5' }, { transport, resources: { Todo: bridged() } })
    const [ok, res] = await listeners.onSave({})

    assert.equal(seen.archiveTask.taskId, '5')
    assert.equal(ok, true)
    assert.equal(res.done, true)
  })
})

describe('overrides — source', () => {
  it('returns the handler array verbatim', async () => {
    const { listeners } = driveForm({ name: 'Todo' }, { transport, resources: { Todo: bridged() } })
    const items = await listeners.onLoadSource('items')

    assert.ok(seen.tasks)
    assert.equal(items.length, 2)
    assert.equal(items[0].taskId, '1')
  })
})

describe('bare convention does not fit a non-conventional contract', () => {
  it('throws because get{Name} is absent on the foreign client', async () => {
    // No overrides: the convention path looks for client.getTodo, which TaskService lacks.
    const { listeners } = driveForm({ name: 'Todo', rfId: '5' }, { transport, resources: { Todo: TaskService } })

    await assert.rejects(() => listeners.onLoad('5'))
  })
})
