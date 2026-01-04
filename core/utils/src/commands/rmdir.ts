import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: rmdir [OPTION]... DIRECTORY...
Remove the DIRECTORY(ies), if they are empty.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'rmdir',
    description: 'Remove a directory',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      if (argv.length === 0) {
        await writelnStderr(process, terminal, 'rmdir: missing operand')
        await writelnStderr(process, terminal, "Try 'rmdir --help' for more information.")
        return 1
      }

      let hasError = false

      for (const target of argv) {
        if (!target || target.startsWith('-')) continue

        const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
        
        try {
          await shell.context.fs.promises.rm(fullPath, { recursive: true, force: true })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          await writelnStderr(process, terminal, `rmdir: ${target}: ${errorMessage}`)
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
