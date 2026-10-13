import { createApp } from 'vue'
// vrf ships as a CommonJS bundle whose module.exports is the installer; the
// default-import interop varies by bundler, so resolve it defensively.
import * as VrfNs from 'vrf'
const Vrf: any = (VrfNs as any).default ?? VrfNs

import grpc from '../src/index'
import { transport, TodoService } from './api'
import kit from './kit'
import App from './App.vue'

const app = createApp(App)

app.use(Vrf, {
  translate: (name: string) => name,
  adapters: [kit],
  effects: [
    grpc({
      transport,
      resources: {
        Todo: TodoService,
      },
    }),
  ],
})

app.mount('#app')
