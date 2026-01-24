/**
 * Terminal types and interfaces
 */

import type { ITerminalAddon, ITerminalOptions, Terminal as XTerm } from '@xterm/xterm'
import type { OptionDefinition } from 'command-line-args'

import type { Kernel } from './kernel.ts'
import type { Shell } from './shell.ts'

/**
 * Terminal configuration options
 */
export interface TerminalOptions extends ITerminalOptions {
  /** XTerm addons to load */
  addons?: Map<string, ITerminalAddon>
  /** Reference to kernel instance */
  kernel?: Kernel
  /** Reference to shell instance */
  shell?: Shell
  /** WebSocket connection */
  socket?: WebSocket
  /** Terminal theme */
  theme?: {
    background?: string
    foreground?: string
    promptColor?: string
  }
}

/**
 * Terminal events
 */
export enum TerminalEvents {
  ATTACH = 'terminal:attach',
  CREATED = 'terminal:created',
  EXECUTE = 'terminal:execute',
  INPUT = 'terminal:input',
  INTERRUPT = 'terminal:interrupt',
  KEY = 'terminal:key',
  LISTEN = 'terminal:listen',
  MESSAGE = 'terminal:message',
  MOUNT = 'terminal:mount',
  PASTE = 'terminal:paste',
  RESIZE = 'terminal:resize',
  UNLISTEN = 'terminal:unlisten',
  WRITE = 'terminal:write',
  WRITELN = 'terminal:writeln'
}

/**
 * Terminal event interfaces
 */
export interface TerminalAttachEvent {
  terminal: Terminal
  socket: WebSocket
}

export interface TerminalCreatedEvent {
  terminal: Terminal
}

export interface TerminalExecuteEvent {
  terminal: Terminal
  command: string
}

export interface TerminalInputEvent {
  terminal: Terminal
  data: string
}

export interface TerminalInterruptEvent {
  terminal: Terminal
}

export interface TerminalKeyEvent {
  key: string
  domEvent: KeyboardEvent
}

export interface TerminalListenEvent {
  terminal: Terminal
}

export interface TerminalMessageEvent {
  terminal: Terminal
  message: MessageEvent
}

export interface TerminalMountEvent {
  terminal: Terminal
  element: HTMLElement
}

export interface TerminalPasteEvent {
  text: string
}

export interface TerminalResizeEvent {
  cols: number
  rows: number
}

export interface TerminalUnlistenEvent {
  terminal: Terminal
}

export interface TerminalWriteEvent {
  text: string
}

export interface TerminalWritelnEvent {
  text: string
}

/**
 * Interface for terminal functionality
 */
export interface Terminal extends XTerm {
  /** Get terminal addons */
  readonly addons: Map<string, ITerminalAddon>
  /** Get ANSI escape sequences */
  readonly ansi: {
    style: {
      reset: string
      bold: string
      green: string
      red: string
      yellow: string
      gray: string
      cyan: string
      [key: string]: string
    }
  }
  /** Get terminal commands */
  readonly commands: Record<string, TerminalCommand>
  /** Get current command */
  readonly cmd: string
  /** Get current working directory */
  readonly cwd: string
  /** Get emoji utilities */
  readonly emojis: any
  /** Get event emitter */
  readonly events: any
  /** Get terminal ID */
  readonly id: string
  /** Get WebSocket connection */
  readonly socket?: WebSocket
  /** Get socket public key */
  readonly socketKey?: JsonWebKey
  /** Get standard input stream */
  readonly stdin: ReadableStream<Uint8Array>
  /** Get standard output stream */
  readonly stdout: WritableStream<Uint8Array>
  /** Get standard error stream */
  readonly stderr: WritableStream<Uint8Array>

  /** Get/set prompt template */
  promptTemplate: string

  /**
   * Mount terminal to DOM element
   * @param element - Element to mount to
   */
  mount(element: HTMLElement): void

  /** Hide terminal */
  hide(): void

  /**
   * Create a special terminal link
   * @param uri - Link URI
   * @param text - Link text
   */
  createSpecialLink(uri: string, text: string): string

  /**
   * Connect to WebSocket
   * @param socket - WebSocket to connect
   */
  connect(socket: WebSocket): void

  /** Start listening for input */
  listen(): void

  /** Stop listening for input */
  unlisten(): void

  /**
   * Read a line of input
   * @param prompt - Input prompt
   * @param hide - Hide input
   * @param noListen - Don't auto-listen
   */
  readline(prompt?: string, hide?: boolean, noListen?: boolean): Promise<string>

  /**
   * Create a spinner
   * @param spinner - Spinner type
   * @param prefix - Prefix text
   * @param suffix - Suffix text
   */
  spinner(spinner: string, prefix?: string, suffix?: string): any

  /**
   * Get terminal prompt
   * @param text - Prompt text
   */
  prompt(text?: string): string

  /**
   * Paste text to terminal
   * @param data - Text to paste
   */
  paste(data?: string): Promise<void>

  /**
   * Clear terminal command
   */
  clearCommand(): string

  /**
   * Restore terminal command
   * @param cmd - Command to restore
   */
  restoreCommand(cmd: string): void

  /**
   * Get input stream
   */
  getInputStream(): ReadableStream<Uint8Array>

  /**
   * Get a new input stream with a close function to signal EOF.
   * Use this when you need to close the stream gracefully (e.g., for Ctrl+D).
   */
  getInputStreamWithClose(): { stream: ReadableStream<Uint8Array>, close: () => void }

  /**
   * Dispatch data to all stdin subscribers.
   * Used to send keyboard input to processes reading from stdin.
   */
  dispatchStdin(key: string): void

  /**
   * Write text to terminal
   * @param data - Text to write
   */
  write(data: string | Uint8Array): void

  /**
   * Write line to terminal
   * @param data - Text to write
   */
  writeln(data: string | Uint8Array): void
}

export interface TerminalCommand {
  command: string
  description: string
  kernel: Kernel
  options?: OptionDefinition[]
  run: (pid: number, argv: string[]) => Promise<number | undefined | void>
  shell: Shell
  terminal: Terminal
  stdin?: ReadableStream<Uint8Array>
  stdout?: WritableStream<Uint8Array>
  stderr?: WritableStream<Uint8Array>
  
  /** Get formatted usage string including command description and options (only available when using unified parser) */
  readonly usage?: string
  /** Get formatted usage content string (only available when using unified parser) */
  readonly usageContent?: string
}


