import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'date',
    description: 'Print or set the system date and time',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'iso-8601', type: Boolean, alias: 'I', description: 'Output date/time in ISO 8601 format' },
      { name: 'rfc-2822', type: Boolean, alias: 'R', description: 'Output date and time in RFC 2822 format' },
      { name: 'format', type: String, alias: 'f', description: 'Output date/time in specified format (strftime-like)' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const now = new Date()
      let output = ''

      if (argv['iso-8601'] as boolean) {
        output = now.toISOString()
      } else if (argv['rfc-2822'] as boolean) {
        output = now.toUTCString()
      } else if (argv.format as string) {
        const format = argv.format as string
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, '0')
        const day = String(now.getDate()).padStart(2, '0')
        const hours = String(now.getHours()).padStart(2, '0')
        const minutes = String(now.getMinutes()).padStart(2, '0')
        const seconds = String(now.getSeconds()).padStart(2, '0')
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0')
        
        output = format
          .replace(/%Y/g, String(year))
          .replace(/%m/g, month)
          .replace(/%d/g, day)
          .replace(/%H/g, hours)
          .replace(/%M/g, minutes)
          .replace(/%S/g, seconds)
          .replace(/%s/g, String(Math.floor(now.getTime() / 1000)))
          .replace(/%f/g, milliseconds)
          .replace(/%z/g, now.getTimezoneOffset().toString())
      } else {
        output = now.toString()
      }

      await writelnStdout(process, terminal, output)
      return 0
    }
  })
}
