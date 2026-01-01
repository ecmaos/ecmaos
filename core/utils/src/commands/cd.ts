import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cd [DIRECTORY]
Change the shell working directory.

  DIRECTORY  the directory to change to (default: $HOME)
  --help     display this help and exit`
  writelnStdout(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cd',
    description: 'Change the shell working directory',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const destination = argv.length > 0 && !argv[0].startsWith('-') ? argv[0] : shell.cwd
      const fullPath = destination ? path.resolve(shell.cwd, destination) : shell.cwd
      
      try {
        await shell.context.fs.promises.access(fullPath)
        shell.cwd = fullPath
        localStorage.setItem(`cwd:${shell.credentials.uid}`, fullPath)
        return 0
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        if (process) {
          const writer = process.stderr.getWriter()
          try {
            await writer.write(new TextEncoder().encode(`cd: ${destination}: ${errorMessage}\n`))
          } finally {
            writer.releaseLock()
          }
        } else {
          terminal.write(`cd: ${destination}: ${errorMessage}\n`)
        }
        return 1
      }
    }
  })
}
