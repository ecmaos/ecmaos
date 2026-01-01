import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: dirname [OPTION] NAME...
Output each NAME with its last non-slash component and trailing slashes removed.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'dirname',
    description: 'Strip last component from file path',
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

      const paths: string[] = []
      for (const arg of argv) {
        if (arg !== '--help' && arg !== '-h' && !arg.startsWith('-')) {
          paths.push(arg)
        }
      }

      if (paths.length === 0) {
        await writelnStderr(process, terminal, 'dirname: missing operand')
        return 1
      }

      const writer = process.stdout.getWriter()

      try {
        for (const filePath of paths) {
          const dir = path.dirname(filePath)
          await writer.write(new TextEncoder().encode(dir + '\n'))
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
