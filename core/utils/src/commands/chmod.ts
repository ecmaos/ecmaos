import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: chmod [OPTION]... MODE[,MODE]... FILE...
Change the mode of each FILE to MODE.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'chmod',
    description: 'Change file mode bits',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const args: string[] = []
      for (const arg of argv) {
        if (arg && !arg.startsWith('-')) {
          args.push(arg)
        }
      }

      if (args.length === 0) {
        await writelnStderr(process, terminal, chalk.red('chmod: missing operand'))
        await writelnStderr(process, terminal, 'Try \'chmod --help\' for more information.')
        return 1
      }

      const [mode, target] = args
      if (!mode || !target) {
        await writelnStderr(process, terminal, chalk.red('chmod: missing operand'))
        return 1
      }

      const fullPath = path.resolve(shell.cwd, target)
      
      try {
        await shell.context.fs.promises.chmod(fullPath, mode)
        return 0
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `chmod: ${target}: ${errorMessage}`)
        return 1
      }
    }
  })
}
