import path from 'path'
import chalk from 'chalk'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'chmod',
    description: 'Change file mode bits',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The mode and path to the file or directory' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const args = (argv.args as string[]) || []
      if (args.length === 0) {
        await writelnStderr(process, terminal, chalk.red('chmod: missing operand'))
        await writelnStderr(process, terminal, 'Try \'chmod --help\' for more information.')
        return 1
      }

      const [mode, target] = args
      if (!mode || !target) return 1
      const fullPath = path.resolve(shell.cwd, target)
      await shell.context.fs.promises.chmod(fullPath, mode)
      return 0
    }
  })
}

