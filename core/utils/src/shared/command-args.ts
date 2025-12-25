import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'

/**
 * The arguments passed to a command.
 */
export interface CommandArgs {
  process?: Process
  stdin?: ReadableStream<Uint8Array>
  stdout?: WritableStream<Uint8Array>
  stderr?: WritableStream<Uint8Array>
  kernel: Kernel
  shell: Shell
  terminal: Terminal
  args: string[] | CommandLineOptions
}

