import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'echo',
    description: 'Print arguments to the standard output',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'text', type: String, typeLabel: '{underline text}', defaultOption: true, multiple: true, description: 'The text to print' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const text = ((argv.text as string[]) || []).join(' ')
      const data = new TextEncoder().encode(text + '\n')

      if (process) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(data)
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(text + '\n')
      }

      return 0
    }
  })
}

