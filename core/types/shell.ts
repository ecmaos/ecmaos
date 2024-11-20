/**
 * Shell types and interfaces
 */

import type { Credentials } from '@zenfs/core'
import type { Kernel } from './kernel.ts'
import type { Terminal } from './terminal.ts'

/**
 * Options for configuring the shell
 */
export interface ShellOptions {
  /** Current working directory */
  cwd?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Reference to kernel instance */
  kernel: Kernel
  /** Reference to terminal instance */
  terminal?: Terminal
  /** User ID */
  uid: number
  /** Group ID */
  gid: number
}

/**
 * Interface for shell functionality
 */
export interface Shell {
  /** Current working directory */
  cwd: string
  /** Environment variables */
  readonly env: Map<string, string>
  /** Environment variables as object */
  readonly envObject: Record<string, string>
  /** Current user's credentials */
  credentials: Credentials
  /** Current username */
  readonly username: string

  /**
   * Attach terminal to shell
   * @param terminal - Terminal to attach
   */
  attach(terminal: Terminal): void

  /**
   * Clear positional parameters
   */
  clearPositionalParameters(): void

  /**
   * Execute a command
   * @param line - Command line to execute
   */
  execute(line: string): Promise<number>

  /**
   * Set positional parameters
   * @param args - Arguments to set
   */
  setPositionalParameters(args: string[]): void
} 