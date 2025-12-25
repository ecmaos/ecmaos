import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'rm',
    description: 'Remove files or directories',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file or directory to remove' }
    ],
    run: async (argv: CommandLineOptions) => {
      const target = (argv.path as string) || shell.cwd
      const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
      if ((await shell.context.fs.promises.stat(fullPath)).isDirectory()) await shell.context.fs.promises.rmdir(fullPath)
      else await shell.context.fs.promises.unlink(fullPath)
      return 0
    }
  })
}

