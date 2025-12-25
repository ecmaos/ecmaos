import path from 'path'
import chalk from 'chalk'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'mv',
    description: 'Move or rename files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The source and destination paths' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const args = (argv.args as string[]) || []
      const [sourceInput, destinationInput] = args
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

