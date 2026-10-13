// Headless end-to-end check: drives the vrf-grpc effect against the running Go
// server using a fake vrf form context that captures the lifecycle listeners.
import { createConnectTransport } from '@connectrpc/connect-web'
import * as grpcMod from '../src/index'
let grpc: any = grpcMod
while (grpc && typeof grpc !== 'function' && grpc.default) grpc = grpc.default
import { TodoService } from '../gen/ts/todo/v1/todo_connect'

const transport = createConnectTransport({
  baseUrl: 'http://localhost:8099',
  useBinaryFormat: false,
})

// Minimal fake of the vrf effect context. Captures the listeners the effect
// registers, then lets us invoke them like the form engine would.
function makeForm(name: string, extra: Record<string, any> = {}) {
  const listeners: Record<string, any> = {}
  const messages: any[] = []

  const form: any = {
    name,
    single: false,
    isNew: () => extra.rfId == null,
    resourceId: () => extra.rfId,
    $resource: extra.$resource,
    ...extra,
  }

  const register = (key: string) => (fn: any) => (listeners[key] = fn)

  const effect = grpc({
    transport,
    resources: { Todo: TodoService },
  })

  effect.effect({
    form,
    onLoad: register('onLoad'),
    onCreate: register('onCreate'),
    onUpdate: register('onUpdate'),
    onSave: register('onSave'),
    onLoadSource: register('onLoadSource'),
    onLoadSources: register('onLoadSources'),
    onExecuteAction: register('onExecuteAction'),
    showMessage: (m: any) => messages.push(m),
    strings: {
      resourceName: () => name,
      urlResourceName: () => name,
      urlResourceCollectionName: () => name,
    },
  } as any)

  return { listeners, messages }
}

const ok = (label: string, cond: boolean, detail?: any) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`, detail ?? '')
  if (!cond) process.exitCode = 1
}

async function main() {
  // 1. onLoad existing resource
  const load = makeForm('Todo', { rfId: '1' })
  const loaded = await load.listeners.onLoad('1')
  ok('onLoad maps GetTodo -> resource', loaded?.id === '1' && loaded?.title === 'Try vrf-grpc', loaded)

  // 2. onLoadSource maps ListTodos -> array
  const src = await load.listeners.onLoadSource('todos')
  ok('onLoadSource maps ListTodos -> array', Array.isArray(src) && src.length >= 1, `len=${src.length}`)

  // 3. onCreate validation error -> field errors
  const createBad = makeForm('Todo')
  const [okFlag, errors] = await createBad.listeners.onCreate({ title: '', description: 'x' })
  ok('onCreate invalid -> [false, {title:[...]}]', okFlag === false && Array.isArray(errors?.title), errors)

  // 4. onCreate success -> returns new id
  const createOk = makeForm('Todo')
  const [okFlag2, newId] = await createOk.listeners.onCreate({ title: 'Written via adapter' })
  ok('onCreate valid -> [true, id]', okFlag2 === true && !!newId, `id=${newId}`)

  // 5. onUpdate existing resource
  const upd = makeForm('Todo', { rfId: newId })
  const [okFlag3, updated] = await upd.listeners.onUpdate({ title: 'Updated title', completed: true })
  ok('onUpdate -> [true, resource]', okFlag3 === true && updated?.title === 'Updated title', updated)

  // 6. action Todo#complete via onSave
  const act = makeForm('Todo#complete', { rfId: newId })
  const [okFlag4, completed] = await act.listeners.onSave({})
  ok('onSave action complete -> completed=true', okFlag4 === true && completed?.completed === true, completed)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
