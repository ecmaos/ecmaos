import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: date [OPTION]... [+FORMAT]
Print or set the system date and time.

  -I, --iso-8601[=TIMESPEC]  output date/time in ISO 8601 format
  -R, --rfc-2822              output date and time in RFC 2822 format
  -f, --format=FORMAT         output date/time in specified format (strftime-like)
  --help                      display this help and exit`
  writelnStdout(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'date',
    description: 'Print or set the system date and time',
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
      let output = ''
      let iso8601 = false
      let rfc2822 = false
      let format: string | undefined

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-I' || arg === '--iso-8601') {
          iso8601 = true
        } else if (arg === '-R' || arg === '--rfc-2822') {
          rfc2822 = true
        } else if (arg === '-f' || arg === '--format') {
          if (i + 1 < argv.length) {
            format = argv[++i]
          } else {
            await writelnStdout(process, terminal, 'date: option requires an argument -- \'f\'')
            return 1
          }
        } else if (arg.startsWith('--format=')) {
          format = arg.slice(9)
        } else if (arg.startsWith('--iso-8601=')) {
          iso8601 = true
        } else if (arg.startsWith('-f')) {
          format = arg.slice(2)
        } else if (arg.startsWith('+')) {
          format = arg.slice(1)
        }
      }

      if (iso8601) {
        output = now.toISOString()
      } else if (rfc2822) {
        output = now.toUTCString()
      } else if (format) {
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
