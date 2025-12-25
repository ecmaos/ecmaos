import chalk from 'chalk'
import parseArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args'
import parseUsage from 'command-line-usage'
import type { TerminalCommand as ITerminalCommand } from '@ecmaos/types'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { writelnStdout, writelnStderr } from './helpers.js'

/**
 * The TerminalCommand class sets up a common interface for builtin terminal commands
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
    options: parseUsage.OptionDefinition[]
    run: (argv: CommandLineOptions, process?: Process) => Promise<number | void>
    shell: Shell
    terminal: Terminal
    stdin?: ReadableStream<Uint8Array>
    stdout?: WritableStream<Uint8Array>
    stderr?: WritableStream<Uint8Array>
  }) {
    this.command = command
    this.description = description
    this.kernel = kernel
    this.options = options
    this.shell = shell
    this.terminal = terminal
    this.stdin = stdin
    this.stdout = stdout
    this.stderr = stderr

    this.run = async (pid: number, argv: string[]) => {
      if (argv === null) return 1
      const process = this.kernel.processes.get(pid) as Process | undefined
      try {
        const parsed = parseArgs(this.options, { argv })
        if (parsed.help) {
          await writelnStdout(process, this.terminal, this.usage)
          return 0
        }

        return await run(parsed, process)
      } catch (error) {
        await writelnStderr(process, this.terminal, chalk.red(String(error)))
        return 1
      }
    }
  }

  get usage() {
    return parseUsage([
      { header: this.command, content: this.description },
      { header: 'Usage', content: this.usageContent },
      { header: 'Options', optionList: this.options }
    ])
  }

  get usageContent() {
    return `${this.command} ${this.options.map(option => {
      let optionStr = option.name
      if (option.type === Boolean) optionStr = `[--${option.name}]`
      else if (option.type === String) optionStr = option.defaultOption ? `<${option.name}>` : `[--${option.name} <value>]`

      if (option.multiple) optionStr += '...'
      return optionStr
    }).join(' ')}`
  }
}

