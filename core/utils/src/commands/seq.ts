import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: seq [OPTION]... LAST
       seq [OPTION]... FIRST LAST
       seq [OPTION]... FIRST INCREMENT LAST
Print numbers from FIRST to LAST, in steps of INCREMENT.

  -s, --separator=STRING   use STRING to separate numbers (default: \\n)
  --help                    display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'seq',
    description: 'Print a sequence of numbers',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (!process) return 1

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let separator = '\n'
      const args: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-s' || arg === '--separator') {
          if (i + 1 < argv.length) {
            separator = argv[++i]
          } else {
            await writelnStderr(process, terminal, 'seq: option requires an argument -- \'s\'')
            return 1
          }
        } else if (arg.startsWith('--separator=')) {
          separator = arg.slice(12)
        } else if (arg.startsWith('-s')) {
          separator = arg.slice(2)
        } else if (!arg.startsWith('-')) {
          args.push(arg)
        }
      }

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
