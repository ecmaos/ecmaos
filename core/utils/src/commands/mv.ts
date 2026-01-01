import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: mv [OPTION]... SOURCE... DEST
Rename SOURCE to DEST, or move SOURCE(s) to DIRECTORY.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'mv',
    description: 'Move or rename files',
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

      if (args.length < 2) {
        await writelnStderr(process, terminal, chalk.red('Usage: mv <source> <destination>'))
        return 1
      }

      const sourceInput = args[0]
      const destinationInput = args[args.length - 1]

      if (!sourceInput || !destinationInput) {
        await writelnStderr(process, terminal, chalk.red('Usage: mv <source> <destination>'))
        return 1
      }

      const source = path.resolve(shell.cwd, sourceInput)
      let destination = path.resolve(shell.cwd, destinationInput)

      if (source === destination) return 0
      const disallowedPaths = ['/dev', '/proc', '/sys', '/run']
      if (disallowedPaths.some(path => source.startsWith(path) || destination.startsWith(path))) {
        await writelnStderr(process, terminal, chalk.red('Cannot move disallowed paths'))
        return 2
      }

      if (await shell.context.fs.promises.exists(destination)) {
        if ((await shell.context.fs.promises.stat(destination)).isDirectory()) {
          destination = path.resolve(destination, path.basename(source))
        } else {
          await writelnStderr(process, terminal, chalk.red(`${destination} already exists`))
          return 1
        }
      }

      await shell.context.fs.promises.rename(source, destination)
      return 0
    }
  })
}
