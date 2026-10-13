import grpc, { GrpcOptions } from '../../src/index'

export interface FakeFormOptions {
  name: string
  rfId?: string | number | null
  single?: boolean
  $resource?: any
}

// Builds the effect and drives it through a minimal fake of the vrf form
// context, capturing the lifecycle listeners it registers so tests can invoke
// them the way the form engine would — no DOM, no server.
export function driveForm(opts: FakeFormOptions, grpcOptions: GrpcOptions) {
  const listeners: Record<string, any> = {}
  const messages: any[] = []
  const rfId = opts.rfId ?? null

  const form: any = {
    name: opts.name,
    single: opts.single ?? false,
    $resource: opts.$resource,
    isNew: () => rfId == null,
    resourceId: () => rfId,
  }

  const register = (key: string) => (fn: any) => (listeners[key] = fn)

  const effect = grpc(grpcOptions)
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
      resourceName: () => opts.name,
      urlResourceName: () => opts.name,
      urlResourceCollectionName: () => opts.name,
    },
  } as any)

  return { listeners, messages, form }
}
