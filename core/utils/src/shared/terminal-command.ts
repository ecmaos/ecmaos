import chalk from 'chalk'
import parseArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args'
import parseUsage from 'command-line-usage'
import type { TerminalCommand as ITerminalCommand } from '@ecmaos/types'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { writelnStdout, writelnStderr } from './helpers.js'

type UnifiedParserRun = (argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => Promise<number | void>
type RawArgvRun = (pid: number, argv: string[]) => Promise<number | void>

/**
 * The TerminalCommand class sets up a common interface for builtin terminal commands
 * Supports two modes:
 * - Unified parser mode: When options are provided, uses command-line-args (for kernel commands)
 * - Raw argv mode: When options are not provided, passes raw argv directly (for coreutils commands)
 */
export class TerminalCommand implements ITerminalCommand {
  command: string = ''
  description: string = ''
  kernel: Kernel
  options: OptionDefinition[] = []
  run: (pid: number, argv: string[]) => Promise<number | void>
  shell: Shell
  terminal: Terminal
  stdin?: ReadableStream<Uint8Array>
  stdout?: WritableStream<Uint8Array>
  stderr?: WritableStream<Uint8Array>

  constructor({ command, description, kernel, options, run, shell, terminal, stdin, stdout, stderr }: {
    command: string
    description: string
    kernel: Kernel
    options?: parseUsage.OptionDefinition[]
    run: UnifiedParserRun | RawArgvRun
    shell: Shell
    terminal: Terminal
    stdin?: ReadableStream<Uint8Array>
    stdout?: WritableStream<Uint8Array>
    stderr?: WritableStream<Uint8Array>
  }) {
    this.command = command
    this.description = description
    this.kernel = kernel
    this.options = options || []
    this.shell = shell
    this.terminal = terminal
    this.stdin = stdin
    this.stdout = stdout
    this.stderr = stderr

    const useUnifiedParser = this.options.length > 0

    if (useUnifiedParser) {
      const unifiedRun = run as UnifiedParserRun
      this.run = async (pid: number, argv: string[]) => {
        if (argv === null) return 1
        const process = this.kernel.processes.get(pid) as Process | undefined
        try {
          const parsed = parseArgs(this.options, { argv, stopAtFirstUnknown: true })
          if (parsed.help) {
            await writelnStdout(process, this.terminal, this.usage)
            return 0
          }

          return await unifiedRun(parsed, process, argv)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (errorMessage.includes('UNKNOWN_OPTION') || errorMessage.includes('Unknown option')) {
            return await unifiedRun({} as CommandLineOptions, process, argv)
          }
          await writelnStderr(process, this.terminal, chalk.red(errorMessage))
          return 1
        }
      }
    } else {
      const rawRun = run as RawArgvRun
      this.run = async (pid: number, argv: string[]) => {
        if (argv === null) return 1
        return await rawRun(pid, argv)
      }
    }
  }

  get usage() {
    if (this.options.length === 0) {
      return ''
    }
    return parseUsage([
      { header: this.command, content: this.description },
      { header: 'Usage', content: this.usageContent },
      { header: 'Options', optionList: this.options }
    ])
  }

  get usageContent() {
    if (this.options.length === 0) {
      return ''
    }
    return `${this.command} ${this.options.map(option => {
      let optionStr = option.name
      if (option.type === Boolean) optionStr = `[--${option.name}]`
      else if (option.type === String) optionStr = option.defaultOption ? `<${option.name}>` : `[--${option.name} <value>]`

      if (option.multiple) optionStr += '...'
      return optionStr
    }).join(' ')}`
  }
}

