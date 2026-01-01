/**
 * Core kernel types and interfaces
 */

import type { BIOSModule } from '@ecmaos/bios'
import type { DeviceDriver } from '@zenfs/core'
import type { InitOptions } from 'i18next'
import type { Notyf } from 'notyf'
import type Module from 'node:module'
import type { JSONSchemaForNPMPackageJsonFiles } from '@schemastore/package'

import type {
  Auth,
  Components,
  Dom,
  DomOptions,
  KernelDevice,
  EventCallback,
  Events,
  Filesystem,
  FilesystemConfigMounts,
  FilesystemOptions,
  I18n,
  Intervals,
  KernelModules,
  Keyboard,
  Log,
  LogOptions,
  Memory,
  ProcessManager,
  Protocol,
  Service,
  ServiceOptions,
  Shell,
  StorageProvider,
  Terminal,
  Users,
  Wasm,
  Windows,
  Workers,
} from './index.ts'

/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * @remarks
 * The Kernel class is the core of the ecmaOS system.
 * It manages the system's resources and provides a framework for system services.
 *
 */
export interface Kernel {
  /** Unique identifier for this kernel instance */
  readonly id: string

  /** Name of the kernel */
  readonly name: string

  /** Version string of the kernel */
  readonly version: string

  /** Current state of the kernel */
  readonly state: KernelState

  /** Configuration options passed to the kernel */
  readonly options: KernelOptions

  /** Terminal interface for user interaction */
  readonly terminal: Terminal

  /** Shell for command interpretation and execution */
  readonly shell: Shell

  /** Logging system */
  readonly log: Log

  // Core services

  /** Authentication and authorization service */
  readonly auth: Auth

  /** BIOS module providing low-level functionality */
  bios?: BIOSModule

  /** Broadcast channel for inter-kernel communication */
  readonly channel: BroadcastChannel

  /** Web Components manager */
  readonly components: Components

  /** DOM manipulation service */
  readonly dom: Dom

  /** Map of registered devices and their drivers */
  readonly devices: Map<string, { device: KernelDevice, drivers?: DeviceDriver[] }>

  /** Event management system */
  readonly events: Events

  /** Virtual filesystem */
  readonly filesystem: Filesystem

  /** Internationalization service */
  readonly i18n: I18n

  /** Interval management service */
  readonly intervals: Intervals

  /** Keyboard interface */
  readonly keyboard: Keyboard

  /** Memory management service */
  readonly memory: Memory

  /** Module management service */
  readonly modules: KernelModules

  /** Map of loaded packages */
  readonly packages: Map<string, Module>

  /** Process management service */
  readonly processes: ProcessManager

  /** Protocol handler service */
  readonly protocol: Protocol

  /** Map of available screensavers */
  readonly screensavers: Map<string, {
    default: (options: { terminal: Terminal }) => Promise<void>
    exit: () => Promise<void>
  }>

  /** Service management system */
  readonly service: Service

  /** Storage provider interface */
  readonly storage: StorageProvider

  /** Toast notification service */
  readonly toast: Notyf

  /** User management service */
  readonly users: Users

  /** WebAssembly service */
  readonly wasm: Wasm

  /** Window management service */
  readonly windows: Windows

  /** Web Worker management service */
  readonly workers: Workers

  // Event handling aliases

  /** Add an event listener */
  addEventListener: (event: KernelEvents, listener: EventCallback) => void

  /** Remove an event listener */
  removeEventListener: (event: KernelEvents, listener: EventCallback) => void

  // Core methods

  /** Boot the kernel with optional configuration */
  boot(options?: BootOptions): Promise<void>

  /** Configure kernel options */
  configure(options: KernelOptions): Promise<void>

  /** Execute a command or program */
  execute(options: KernelExecuteOptions): Promise<number>

  /** Get the main export from a package */
  getPackageMainExport(pkgData: JSONSchemaForNPMPackageJsonFiles): string | null

  /** Show a system notification */
  notify(title: string, options?: object): Promise<Notification | void>

  /** Add an event listener */
  on(event: KernelEvents, listener: EventCallback): void

  /** Remove an event listener */
  off(event: KernelEvents, listener: EventCallback): void

  /** Reboot the kernel */
  reboot(): Promise<void>

  /** Shutdown the kernel */
  shutdown(): Promise<void>
}

/**
 * Kernel events
 */
export enum KernelEvents {
  BOOT = 'kernel:boot',
  EXECUTE = 'kernel:execute',
  PANIC = 'kernel:panic',
  REBOOT = 'kernel:reboot',
  SHUTDOWN = 'kernel:shutdown',
  UPLOAD = 'kernel:upload'
}

/**
 * Kernel states
 */
export enum KernelState {
  BOOTING = 'booting',
  PANIC = 'panic',
  RUNNING = 'running',
  SHUTDOWN = 'shutdown'
}

/**
 * Options for configuring the kernel
 */
export interface KernelOptions {
  blacklist?: {
    commands?: string[]
  }
  credentials?: {
    username: string
    password: string
  }
  devices?: Record<string, KernelDevice>
  dom?: DomOptions
  filesystem?: FilesystemOptions<FilesystemConfigMounts>
  i18n?: InitOptions
  log?: LogOptions
  service?: ServiceOptions
  socket?: WebSocket
  toast?: object
}

/**
 * Options for booting the kernel
 */
export interface BootOptions {
  figletFont?: string
  figletFontRandom?: boolean
  figletColor?: string
  silent?: boolean
}

/**
 * Options for executing commands
 */
export interface KernelExecuteOptions {
  command: string
  file?: string
  args?: string[]
  kernel?: Kernel
  shell: Shell
  terminal?: Terminal
  stdin?: ReadableStream<Uint8Array>
  stdinIsTTY?: boolean
  stdout?: WritableStream<Uint8Array>
  stdoutIsTTY?: boolean
  stderr?: WritableStream<Uint8Array>
}

/**
 * Event interfaces
 */
export interface KernelExecuteEvent {
  command: string
  args?: string[]
  exitCode: number
}

export interface KernelPanicEvent {
  error: Error
}

export interface KernelShutdownEvent {
  data: Record<string, unknown>
}

export interface KernelUploadEvent {
  file: string
  path: string
}
