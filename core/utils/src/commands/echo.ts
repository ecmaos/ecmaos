import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: echo [OPTION]... [STRING]...
Echo the STRING(s) to standard output.

  -n     do not output the trailing newline
  --help display this help and exit`
  writelnStdout(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'echo',
    description: 'Print arguments to the standard output',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length === 0) {
        await writelnStdout(process, terminal, '')
        return 0
      }

      let noNewline = false
      const textParts: string[] = []
      let i = 0

      while (i < argv.length) {
        const arg = argv[i]
        if (!arg) {
          i++
          continue
        }
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-n') {
          noNewline = true
        } else if (arg.startsWith('-') && arg.length > 1 && arg !== '--') {
          const flags = arg.slice(1).split('')
          if (flags.includes('n')) {
            noNewline = true
          }
          const invalidFlag = flags.find(f => f !== 'n')
          if (invalidFlag) {
            await writelnStdout(process, terminal, `echo: invalid option -- '${invalidFlag}'`)
            return 1
          }
        } else {
          textParts.push(arg)
        }
        i++
      }

      const text = textParts.join(' ')
      const output = noNewline ? text : text + '\n'

      if (process) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(new TextEncoder().encode(output))
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(output)
      }

      return 0
    }
  })
}

