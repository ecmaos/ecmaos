import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cal',
    description: 'Display a calendar',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'month', type: Number, description: 'Month (1-12)' },
      { name: 'year', type: Number, description: 'Year' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const now = new Date()
      let month = (argv.month as number | undefined) ?? (now.getMonth() + 1)
      let year = (argv.year as number | undefined) ?? now.getFullYear()

      if (month < 1 || month > 12) {
        await writelnStdout(process, terminal, 'cal: invalid month')
        return 1
      }

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December']
      const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

      const firstDay = new Date(year, month - 1, 1)
      const lastDay = new Date(year, month, 0)
      const daysInMonth = lastDay.getDate()
      const startDayOfWeek = firstDay.getDay()

      let output = `     ${monthNames[month - 1]} ${year}\n`
      output += dayNames.join(' ') + '\n'

      let day = 1
      let isFirstWeek = true

      while (day <= daysInMonth) {
        let line = ''
        for (let i = 0; i < 7; i++) {
          if (isFirstWeek && i < startDayOfWeek) {
            line += '   '
          } else if (day <= daysInMonth) {
            line += day.toString().padStart(2) + ' '
            day++
          } else {
            line += '   '
          }
        }
        output += line.trimEnd() + '\n'
        isFirstWeek = false
      }

      await writelnStdout(process, terminal, output)
      return 0
    }
  })
}
