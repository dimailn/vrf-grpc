import { createConnectTransport } from '@connectrpc/connect-web'
import { createPromiseClient } from '@connectrpc/connect'

import { TodoService } from '../gen/ts/todo/v1/todo_connect'

// Shared transport: used both by the vrf-grpc effect (for the forms) and by the
// plain generated client below (for list/toggle/delete, which are imperative).
export const transport = createConnectTransport({
  baseUrl: 'http://localhost:8099',
  useBinaryFormat: false,
})

export const todoClient = createPromiseClient(TodoService, transport)

export { TodoService }
