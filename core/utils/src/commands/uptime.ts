import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: uptime
Print how long the system has been running.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) {
    parts.push(`${days} day${days !== 1 ? 's' : ''}`)
  }
  if (hours > 0) {
    parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`)
  }
  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`)
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs} second${secs !== 1 ? 's' : ''}`)
  }

  return parts.join(', ')
}

function getUptimeSeconds(): number {
  return performance.now() / 1000
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'uptime',
    description: 'Print how long the system has been running',
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

      if (argv.length > 0 && argv[0] !== '--help' && argv[0] !== '-h') {
        await writelnStderr(process, terminal, `uptime: extra operand '${argv[0]}'`)
        await writelnStderr(process, terminal, "Try 'uptime --help' for more information.")
        return 1
      }

      const uptimeSeconds = getUptimeSeconds()
      const uptimeString = formatUptime(uptimeSeconds)
      const now = new Date()
      
      const output = ` ${now.toLocaleTimeString()} up ${uptimeString}`
      await writelnStdout(process, terminal, output)

      return 0
    }
  })
}
