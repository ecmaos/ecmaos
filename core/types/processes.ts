/**
 * Process management types and interfaces
 */

import type { Kernel } from './kernel.ts'
import type { Shell } from './shell.ts'
import type { Terminal } from './terminal.ts'

/** Process status type */
export type ProcessStatus = 'running' | 'paused' | 'stopped' | 'exited'

/**
 * ZenFS FileHandle interface
 * @see https://zenfs.dev/core/classes/index.fs.promises.FileHandle.html
 */
export interface FileHandle {
  /** The numeric file descriptor */
  readonly fd: number
  /** Close the file handle */
  close(): Promise<void>
  /** Read file contents */
  readFile(encoding?: BufferEncoding): Promise<string | Buffer>
  /** Write data to file */
  writeFile(data: string | Uint8Array): Promise<void>
  /** Truncate file to specified length */
  truncate(len?: number): Promise<void>
  /** Get a readable web stream */
  readableWebStream?(options?: { type?: 'bytes' }): ReadableStream<Uint8Array>
  /** Get a writable web stream */
  writableWebStream?(): WritableStream<Uint8Array>
}

/**
 * File Descriptor Table interface
 * Manages stdin/stdout/stderr and tracks open file handles
 */
export interface FDTable {
  /** Standard input stream */
  readonly stdin: ReadableStream<Uint8Array> | undefined
  /** Standard output stream */
  readonly stdout: WritableStream<Uint8Array> | undefined
  /** Standard error stream */
  readonly stderr: WritableStream<Uint8Array> | undefined
  /** Get all tracked file handles */
  readonly fileHandles: FileHandle[]
  
  /** Set stdin stream */
  setStdin(stream: ReadableStream<Uint8Array>): void
  /** Set stdout stream */
  setStdout(stream: WritableStream<Uint8Array>): void
  /** Set stderr stream */
  setStderr(stream: WritableStream<Uint8Array>): void
  /** Redirect stderr to stdout (2>&1) */
  redirectStderrToStdout(): void
  /** Track a file handle */
  trackFileHandle(handle: FileHandle): void
  /** Untrack a file handle */
  untrackFileHandle(handle: FileHandle): void
  /** Close all tracked file handles */
  closeFileHandles(): Promise<void>
  /** Cleanup all resources */
  cleanup(): Promise<void>
}

/** Map of process IDs to processes */
export type ProcessesMap = Map<number, Process>

/**
 * Options for configuring processes
 */
export interface ProcessOptions {
  /** User ID */
  uid: number
  /** Group ID */
  gid: number
  /** Command line arguments */
  args?: string[]
  /** Exit code */
  code?: number
  /** Command name */
  command?: string
  /** Working directory */
  cwd?: string
  /** Process entry point */
  entry?: (params: ProcessEntryParams) => Promise<number | undefined | void>
  /** Reference to kernel instance */
  kernel?: Kernel
  /** Parent process ID */
  parent?: number
  /** Reference to shell instance */
  shell?: Shell
  /** Process status */
  status?: ProcessStatus
  /** Standard error stream */
  stderr?: WritableStream<Uint8Array>
  /** Standard input stream */
  stdin?: ReadableStream<Uint8Array>
  /** Whether stdin is a TTY (interactive terminal) vs a pipe */
  stdinIsTTY?: boolean
  /** Standard output stream */
  stdout?: WritableStream<Uint8Array>
  /** Whether stdout is a TTY (interactive terminal) vs a file/pipe */
  stdoutIsTTY?: boolean
  /** Reference to terminal instance */
  terminal?: Terminal
}

/**
 * Parameters passed to process entry point
 */
export interface ProcessEntryParams {
  /** Process ID */
  pid: number
  /** User ID */
  uid: number
  /** Group ID */
  gid: number
  /** Command line arguments */
  args: string[]
  /** Command name */
  command: string
  /** Working directory */
  cwd: string
  /** Process instance */
  instance: Process
  /** Reference to kernel instance */
  kernel: Kernel
  /** Reference to shell instance */
  shell: Shell
  /** Reference to terminal instance */
  terminal: Terminal
  /** Standard input stream */
  stdin?: ReadableStream<Uint8Array>
  /** Whether stdin is a TTY (interactive terminal) vs a pipe */
  stdinIsTTY?: boolean
  /** Standard output stream */
  stdout?: WritableStream<Uint8Array>
  /** Whether stdout is a TTY (interactive terminal) vs a file/pipe */
  stdoutIsTTY?: boolean
  /** Standard error stream */
  stderr?: WritableStream<Uint8Array>
}

/**
 * Process events
 */
export enum ProcessEvents {
  EXIT = 'exit',
  PAUSE = 'pause',
  RESUME = 'resume',
  START = 'start',
  STOP = 'stop'
}

/**
 * Process event interfaces
 */
export interface ProcessExitEvent {
  pid: number
  code: number
}

export interface ProcessStartEvent {
  pid: number
}

export interface ProcessStopEvent {
  pid: number
}

export interface ProcessPauseEvent {
  pid: number
}

export interface ProcessResumeEvent {
  pid: number
}

/**
 * Interface for process functionality
 */
export interface Process {
  /** Get command line arguments */
  readonly args: string[]
  /** Get exit code */
  readonly code?: number
  /** Get command name */
  readonly command: string
  /** Get working directory */
  readonly cwd: string
  /** Get process entry point */
  readonly entry: (params: ProcessEntryParams) => Promise<number | undefined | void>
  /** Get event emitter */
  readonly events: any
  /** Get file descriptor table */
  readonly fd: FDTable
  /** Get group ID */
  readonly gid: number
  /** Get kernel instance */
  readonly kernel: Kernel
  /** Get process ID */
  readonly pid: number
  /** Get shell instance */
  readonly shell: Shell
  /** Get process status */
  readonly status: ProcessStatus
  /** Get standard error stream */
  readonly stderr: WritableStream<Uint8Array>
  /** Get standard input stream */
  readonly stdin: ReadableStream<Uint8Array>
  /** Whether stdin is a TTY (interactive terminal) vs a pipe */
  readonly stdinIsTTY?: boolean
  /** Get standard output stream */
  readonly stdout: WritableStream<Uint8Array>
  /** Whether stdout is a TTY (interactive terminal) vs a file/pipe */
  readonly stdoutIsTTY?: boolean
  /** Get terminal instance */
  readonly terminal: Terminal
  /** Get user ID */
  readonly uid: number

  /** Get/set parent process ID */
  parent?: number

  /** Clean up process resources */
  cleanup(): Promise<void>
  /**
   * Close a file handle and untrack from FDTable
   * @param handle - The file handle to close
   */
  close(handle: FileHandle): Promise<void>
  /** Exit process */
  exit(exitCode?: number): Promise<void>
  /**
   * Marks the process to stay alive after the entry function returns.
   * Useful for background/daemon processes that need to keep running.
   */
  keepAlive(): void
  /**
   * Open a file and automatically track in FDTable
   * @param path - Path to the file
   * @param flags - Open flags (default: 'r')
   * @returns The file handle
   */
  open(path: string, flags?: string): Promise<FileHandle>
  /** Pause process */
  pause(): void
  /** Resume process */
  resume(): void
  /** Start process */
  start(): Promise<number>
  /** Stop process */
  stop(exitCode?: number): Promise<void>
  /** Restart process */
  restart(): void
}

/**
 * Interface for process manager functionality
 */
export interface ProcessManager {
  /** Get all processes */
  readonly all: ProcessesMap

  /**
   * Add a process
   * @param process - Process to add
   */
  add(process: Process): number

  /**
   * Create a process
   * @param options - Process options
   */
  create(options: ProcessOptions): Process

  /**
   * Get a process by ID
   * @param pid - Process ID
   */
  get(pid: number): Process | undefined

  /**
   * Get next available process ID
   */
  pid(): number

  /**
   * Remove a process
   * @param pid - Process ID
   */
  remove(pid: number): void

  /**
   * Spawn a child process
   * @param parent - Parent process ID
   * @param process - Process to spawn
   */
  spawn(parent: number, process: Process): number
} 