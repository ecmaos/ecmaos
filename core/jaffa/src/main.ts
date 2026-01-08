/// <reference types="vite/client" />
/// <reference types="user-agent-data-types" />

import { Kernel } from '@ecmaos/kernel'
import type { Kernel as IKernel, Shell, Terminal } from '@ecmaos/types'
import '@ecmaos/kernel/ui.css'


declare global {
  var kernel: IKernel | undefined // eslint-disable-line no-var
  var kernels: Map<string, IKernel> | undefined // eslint-disable-line no-var
  var shells: Map<string, Shell> | undefined // eslint-disable-line no-var
  var terminals: Map<string, Terminal> | undefined // eslint-disable-line no-var

  interface Navigator {
    userAgentData: NavigatorUAData | null
  }
}

const username = import.meta.env.ECMAOS_AUTOLOGIN_USERNAME
const password = import.meta.env.ECMAOS_AUTOLOGIN_PASSWORD
const socket = import.meta.env.ECMAOS_METAL_SOCKET

const kernel = new Kernel({
  credentials: (username && password) ? { username, password } : undefined,
  dom: { topbar: import.meta.env.NODE_ENV !== 'test' },
  log: { name: `ecmaos:${import.meta.env.NODE_ENV || 'kernel'}` },
  socket: socket ? new WebSocket(socket) : undefined
})

globalThis.kernels = globalThis.kernels || new Map()
globalThis.kernels.set(kernel.id, kernel)

globalThis.shells = globalThis.shells || new Map()
globalThis.shells.set(kernel.shell.id, kernel.shell)

globalThis.terminals = globalThis.terminals || new Map()
globalThis.terminals.set(kernel.terminal.id, kernel.terminal)

const primaryKernel = globalThis.kernels.values().next().value
globalThis.kernel = primaryKernel

kernel.terminal.mount(document.getElementById('terminal') as HTMLElement)
kernel.boot({ silent: import.meta.env.NODE_ENV === 'test', figletFontRandom: false })


