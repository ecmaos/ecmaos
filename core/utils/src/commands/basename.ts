import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'basename',
    description: 'Strip directory and suffix from filenames',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'suffix', type: String, alias: 's', description: 'Remove a trailing suffix' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to process' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const paths = (argv.path as string[]) || []
      const suffix = argv.suffix as string | undefined

      if (paths.length === 0) {
        await writelnStderr(process, terminal, 'basename: missing operand')
        return 1
      }

      const writer = process.stdout.getWriter()

      try {
        for (const filePath of paths) {
          let basename = path.basename(filePath)
          
          if (suffix && basename.endsWith(suffix)) {
            basename = basename.slice(0, -suffix.length)
          }
          
          await writer.write(new TextEncoder().encode(basename + '\n'))
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
