import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'dirname',
    description: 'Strip last component from file path',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to process' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const paths = (argv.path as string[]) || []

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
