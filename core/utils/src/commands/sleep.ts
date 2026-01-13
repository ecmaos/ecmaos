import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: sleep NUMBER[SUFFIX]...
Pause for NUMBER seconds.  SUFFIX may be 's' for seconds (the default),
'm' for minutes, 'h' for hours or 'd' for days.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

function parseDuration(value: string): number {
  const match = value.match(/^([0-9]+(?:\.[0-9]+)?)([smhd]?)$/)
  if (!match?.[1]) return NaN

  const num = parseFloat(match[1])
  if (isNaN(num)) return NaN

  const suffix = match[2] || 's'
  switch (suffix) {
    case 's':
      return num * 1000
    case 'm':
      return num * 60 * 1000
    case 'h':
      return num * 60 * 60 * 1000
    case 'd':
      return num * 24 * 60 * 60 * 1000
    default:
      return NaN
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'sleep',
    description: 'Delay for a specified amount of time',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (!process) return 1

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      if (argv.length === 0) {
        await writelnStderr(process, terminal, 'sleep: missing operand')
        await writelnStderr(process, terminal, "Try 'sleep --help' for more information.")
        return 1
      }

      let totalDuration = 0

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg.startsWith('-')) {
          await writelnStderr(process, terminal, `sleep: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'sleep --help' for more information.")
          return 1
        } else {
          const duration = parseDuration(arg)
          if (isNaN(duration)) {
            await writelnStderr(process, terminal, `sleep: invalid time interval '${arg}'`)
            return 1
          }
          totalDuration += duration
        }
      }

      if (totalDuration <= 0) return 0

      let interrupted = false
      const interruptHandler = () => { interrupted = true }
      terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

      try {
        await new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => resolve(), totalDuration)

          if (interrupted) {
            clearTimeout(timeoutId)
            resolve()
          }
        })
      } catch (error) {
        if (!interrupted) {
          await writelnStderr(process, terminal, `sleep: ${error instanceof Error ? error.message : 'Unknown error'}`)
          return 1
        }
      } finally {
        terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      }

      return interrupted ? 130 : 0
    }
  })
}
