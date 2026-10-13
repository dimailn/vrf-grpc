import {
  createPromiseClient,
  PromiseClient,
  Transport,
} from '@connectrpc/connect'
import { ServiceType, toPlainMessage } from '@bufbuild/protobuf'

import type { Effect } from 'vrf'

import { normalizeError, FieldErrors } from './errors'

type AnyClient = PromiseClient<ServiceType>

// Context passed to every resource handler.
export interface HandlerContext {
  id?: string | number
  resource?: any
  action?: string
  form: any
}

// Per-operation overrides. Each returns the raw protobuf response message;
// the adapter converts it to a plain vrf resource (and extracts the id on create).
export interface ResourceHandlers {
  load?: (client: AnyClient, ctx: HandlerContext) => Promise<any>
  create?: (client: AnyClient, ctx: HandlerContext) => Promise<any>
  update?: (client: AnyClient, ctx: HandlerContext) => Promise<any>
  source?: (client: AnyClient, name: string) => Promise<any[]>
  actions?: Record<string, (client: AnyClient, ctx: HandlerContext) => Promise<any>>
}

export interface ResourceConfig extends ResourceHandlers {
  // Generated Connect service definition for this resource.
  service: ServiceType
  // Field on the create response carrying the new id (default "id").
  idField?: string
}

// A resource entry may be just the service (pure convention) or a config with overrides.
export type ResourceEntry = ServiceType | ResourceConfig

export interface GrpcOptions {
  transport: Transport
  resources: Record<string, ResourceEntry>
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

const isServiceType = (entry: ResourceEntry): entry is ServiceType =>
  typeof (entry as ServiceType).typeName === 'string' &&
  typeof (entry as ServiceType).methods === 'object'

// Derives the camelCase client method name the generated Connect client exposes
// for an RPC named `${prefix}${Name}` (protobuf-es lowercases the first letter).
const methodName = (prefix: string, name: string) => lowerFirst(prefix + upperFirst(name))

const toResource = (msg: any) => (msg == null ? msg : toPlainMessage(msg))

export default function grpc({ transport, resources }: GrpcOptions): Effect {
  // One client per resource, built lazily and cached.
  const clients = new Map<string, AnyClient>()

  const resolve = (baseName: string): { config: ResourceConfig; client: AnyClient } => {
    const entry = resources[baseName]
    if (!entry) {
      throw new Error(
        `[vrf-grpc] no resource registered for "${baseName}". ` +
          `Add it to the "resources" map.`,
      )
    }

    const config: ResourceConfig = isServiceType(entry) ? { service: entry } : entry

    let client = clients.get(baseName)
    if (!client) {
      client = createPromiseClient(config.service, transport)
      clients.set(baseName, client)
    }

    return { config, client }
  }

  return {
    name: 'grpc',
    api: true,
    effect({ form, onLoad, onCreate, onUpdate, onSave, onLoadSource, onLoadSources, onExecuteAction, showMessage }) {
      const showError = (text: string) =>
        showMessage({ type: 'error', text })

      const baseName = () => form.name.split('#')[0].split('::')[0]
      const isAction = () => form.name.includes('#')
      const actionName = () => form.name.split('#')[1]

      // Calls the given saver and normalizes Connect errors into vrf's
      // [ok, result | fieldErrors] contract (mirrors vrf-rest aroundSave).
      const aroundSave = async <T>(saver: () => Promise<T>): Promise<[boolean, any]> => {
        try {
          return [true, await saver()]
        } catch (e) {
          const { statusHandle, fieldErrors, message } = normalizeError(e)

          if (statusHandle === 'NETWORK_FAILURE' || statusHandle === 'SERVER_FAILURE') {
            // Not a recoverable validation error — surface and rethrow semantics via message.
            showError(message)
            return [false, fieldErrors || { base: [message] }]
          }

          const errors: FieldErrors = fieldErrors || { base: [message] }
          if (errors.base?.length) {
            showError(errors.base.join('; '))
          }
          return [false, errors]
        }
      }

      // --- onLoad: fetch a single resource (or reuse $resource in action mode) ---
      onLoad(async (id) => {
        if (!id && form.isNew()) {
          return {}
        }
        if (isAction()) {
          return form.$resource
        }

        const { config, client } = resolve(baseName())
        const call = config.load
          ? config.load(client, { id, form })
          : (client as any)[methodName('Get', baseName())]({ id: id == null ? '' : String(id) })

        return toResource(await call)
      })

      // --- onCreate ---
      onCreate(async (resource) =>
        aroundSave(async () => {
          const { config, client } = resolve(baseName())
          const wrapperKey = lowerFirst(baseName())

          const msg = config.create
            ? await config.create(client, { resource, form })
            : await (client as any)[methodName('Create', baseName())]({ [wrapperKey]: resource })

          const plain = toResource(msg)
          return plain?.[config.idField || 'id']
        }),
      )

      // --- onUpdate ---
      onUpdate(async (resource) =>
        aroundSave(async () => {
          const { config, client } = resolve(baseName())
          const wrapperKey = lowerFirst(baseName())
          const id = form.resourceId()

          const msg = config.update
            ? await config.update(client, { id, resource, form })
            : await (client as any)[methodName('Update', baseName())]({
                id: id == null ? '' : String(id),
                [wrapperKey]: resource,
              })

          return toResource(msg)
        }),
      )

      // --- onSave: action-mode forms (name="Resource#action") ---
      // NOTE: this must NOT be async. vrf uses onSave's return value only when
      // it is a Promise, otherwise it falls through to onCreate/onUpdate. An
      // async function always returns a Promise, which would hijack the normal
      // create/update path — so return a synchronous `undefined` for non-actions.
      onSave((resource) => {
        if (!isAction()) {
          return undefined
        }

        return aroundSave(async () => {
          const { config, client } = resolve(baseName())
          const action = actionName()
          const id = form.single ? undefined : form.resourceId()
          const ctx: HandlerContext = { id, resource, action, form }

          const handler = config.actions?.[action]
          const msg = handler
            ? await handler(client, ctx)
            : await (client as any)[methodName(upperFirst(action), baseName())]({
                id: id == null ? '' : String(id),
              })

          return toResource(msg)
        })
      })

      // --- onExecuteAction: fire an action against an existing resource ---
      onExecuteAction(async (name, { data } = {} as any) => {
        const { config, client } = resolve(baseName())
        const id = form.resourceId()
        const ctx: HandlerContext = { id, resource: data, action: name, form }

        try {
          const handler = config.actions?.[name]
          const msg = handler
            ? await handler(client, ctx)
            : await (client as any)[methodName(upperFirst(name), baseName())]({
                id: id == null ? '' : String(id),
              })

          return { status: 0, data: toResource(msg), statusHandle: 'SUCCESSFUL' } as any
        } catch (e) {
          const { status, statusHandle, message } = normalizeError(e)
          showError(message)
          return { status, data: undefined, statusHandle } as any
        }
      })

      // --- sources: load collections via List* RPCs ---
      const loadSource = async (name: string) => {
        const { config, client } = resolve(baseName())
        if (config.source) {
          return config.source(client, name)
        }

        const response = await (client as any)[methodName('List', upperFirst(name))]({})
        const plain = toResource(response)
        // Prefer a field named like the source, else the first repeated field.
        return plain?.[name] ?? Object.values(plain || {}).find(Array.isArray) ?? []
      }

      onLoadSource(loadSource)

      onLoadSources(async (names) => {
        const entries = await Promise.all(
          names.map(async (name: string) => [name, await loadSource(name)] as const),
        )
        return entries.reduce((index, [name, source]) => {
          index[name] = source
          return index
        }, {} as Record<string, any[]>)
      })
    },
  }
}
