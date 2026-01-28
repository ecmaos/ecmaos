import { Kernel } from '#kernel.ts'
import './ui.css'

const username = import.meta.env.ECMAOS_AUTOLOGIN_USERNAME
const password = import.meta.env.ECMAOS_AUTOLOGIN_PASSWORD
const socket = import.meta.env.ECMAOS_METAL_SOCKET

// Create terminal containers for TTYs 0-9
const terminalContainer = document.getElementById('terminal')
if (terminalContainer) {
  // Rename the existing terminal div to terminal-tty0
  terminalContainer.id = 'terminal-tty0'
  terminalContainer.classList.add('terminal-container', 'active')
  
  // Create containers for TTYs 1-9
  for (let i = 1; i <= 9; i++) {
    const ttyContainer = document.createElement('div')
    ttyContainer.id = `terminal-tty${i}`
    ttyContainer.className = 'terminal-container'
    document.body.appendChild(ttyContainer)
  }
}

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

kernel.terminal.mount(document.getElementById('terminal-tty0') as HTMLElement)

// Set up global keyboard handler for TTY switching
// Use capture phase to intercept before xterm.js handles it
const ttySwitchHandler = async (event: KeyboardEvent) => {
  if (event.ctrlKey && event.shiftKey) {
    // Use event.code instead of event.key because Shift+number produces symbols
    // e.g., Shift+1 produces key='!' but code='Digit1'
    const codeMatch = event.code.match(/^Digit([0-9])$/)
    if (codeMatch && codeMatch[1]) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const ttyNumber = parseInt(codeMatch[1])
      try {
        await kernel.switchTty(ttyNumber)
      } catch (error) {
        console.error('Failed to switch TTY:', error)
      }
      return false
    }
  }
  return true
}

// Add handler with capture phase to catch events before xterm.js
document.addEventListener('keydown', ttySwitchHandler, true)

kernel.boot({ silent: import.meta.env.NODE_ENV === 'test', figletFontRandom: false })
