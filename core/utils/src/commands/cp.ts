import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cp',
    description: 'Copy files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The source and destination paths' }
    ],
    run: async (argv: CommandLineOptions) => {
      const args = (argv.args as string[]) || []
      const [source, destination] = args.map(arg => path.resolve(shell.cwd, arg))
      if (!source || !destination) return 1
      const destinationStats = await shell.context.fs.promises.stat(destination).catch(() => null)
      const finalDestination = destinationStats?.isDirectory() ? path.join(destination, path.basename(source)) : destination
      await shell.context.fs.promises.copyFile(source, finalDestination)
      return 0
    }
  })
}

