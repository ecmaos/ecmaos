import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'seq',
    description: 'Print a sequence of numbers',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'separator', type: String, alias: 's', description: 'Use STRING to separate numbers', defaultValue: '\n' },
      { name: 'args', type: String, defaultOption: true, multiple: true, description: 'FIRST [INCREMENT] LAST' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const args = (argv.args as string[]) || []
      const separator = (argv.separator as string) || '\n'

      if (args.length === 0) {
        await writelnStderr(process, terminal, 'seq: missing operand')
        return 1
      }

      let first = 1
      let increment = 1
      let last: number

      if (args.length === 1) {
        last = parseFloat(args[0])
        if (isNaN(last)) {
          await writelnStderr(process, terminal, `seq: invalid number: ${args[0]}`)
          return 1
        }
      } else if (args.length === 2) {
        first = parseFloat(args[0])
        last = parseFloat(args[1])
        if (isNaN(first) || isNaN(last)) {
          await writelnStderr(process, terminal, 'seq: invalid number')
          return 1
        }
      } else if (args.length === 3) {
        first = parseFloat(args[0])
        increment = parseFloat(args[1])
        last = parseFloat(args[2])
        if (isNaN(first) || isNaN(increment) || isNaN(last)) {
          await writelnStderr(process, terminal, 'seq: invalid number')
          return 1
        }
      } else {
        await writelnStderr(process, terminal, 'seq: too many arguments')
        return 1
      }

      const writer = process.stdout.getWriter()
      const numbers: number[] = []

      if (increment > 0) {
        for (let i = first; i <= last; i += increment) {
          numbers.push(i)
        }
      } else if (increment < 0) {
        for (let i = first; i >= last; i += increment) {
          numbers.push(i)
        }
      } else {
        await writelnStderr(process, terminal, 'seq: zero increment')
        writer.releaseLock()
        return 1
      }

      const output = numbers.map(n => {
        if (Number.isInteger(n)) {
          return n.toString()
        } else {
          return n.toFixed(10).replace(/\.?0+$/, '')
        }
      }).join(separator)

      try {
        await writer.write(new TextEncoder().encode(output + (separator === '\n' ? '' : '\n')))
        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
