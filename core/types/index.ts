/**
 * Core type definitions for ecmaOS
 */

export * from './auth.js'
export * from './components.js'
export * from './device.js'
export * from './dom.js'
export * from './events.js'
export * from './filesystem.js'
export * from './i18n.js'
export * from './intervals.js'
export * from './keyboard.js'
export * from './kernel.js'
export * from './log.js'
export * from './memory.js'
export * from './modules.js'
export * from './processes.js'
export * from './protocol.js'
export * from './service.js'
export * from './sockets.js'
export * from './shell.js'
export * from './storage.js'
export * from './telemetry.js'
export * from './terminal.js'
export * from './users.js'
export * from './wasm.js'
export * from './windows.js'
export * from './workers.js'

export type Timer = ReturnType<typeof setInterval>
