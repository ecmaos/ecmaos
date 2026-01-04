import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cal [MONTH] [YEAR]
Display a calendar.

  MONTH   month (1-12)
  YEAR    year
  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cal',
    description: 'Display a calendar',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const now = new Date()
      let month: number | undefined
      let year: number | undefined

      if (argv.length === 1) {
        const argStr = argv[0]
        if (!argStr) {
          month = now.getMonth() + 1
          year = now.getFullYear()
        } else {
          const arg = parseInt(argStr, 10)
          if (isNaN(arg)) {
            await writelnStdout(process, terminal, 'cal: invalid argument')
            return 1
          }
          if (arg >= 1 && arg <= 12) {
            month = arg
            year = now.getFullYear()
          } else {
            year = arg
            month = now.getMonth() + 1
          }
        }
      } else if (argv.length === 2) {
        const monthStr = argv[0]
        const yearStr = argv[1]
        if (!monthStr || !yearStr) {
          await writelnStdout(process, terminal, 'cal: invalid arguments')
          return 1
        }
        month = parseInt(monthStr, 10)
        year = parseInt(yearStr, 10)
        if (isNaN(month) || isNaN(year)) {
          await writelnStdout(process, terminal, 'cal: invalid arguments')
          return 1
        }
      } else {
        month = now.getMonth() + 1
        year = now.getFullYear()
      }

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
