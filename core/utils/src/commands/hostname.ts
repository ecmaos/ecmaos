import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: hostname [OPTION]
Print the system hostname.

  -f, --fqdn              print the FQDN (Fully Qualified Domain Name)
  -s, --short             print the short hostname
  --help                  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'hostname',
    description: 'Print the system hostname',
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

      let showFqdn = false
      let showShort = false
      const args: string[] = []

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-f' || arg === '--fqdn') {
          showFqdn = true
        } else if (arg === '-s' || arg === '--short') {
          showShort = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('f')) showFqdn = true
          if (flags.includes('s')) showShort = true
          const invalidFlags = flags.filter(f => !['f', 's'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `hostname: invalid option -- '${invalidFlags[0]}'`)
            await writelnStderr(process, terminal, "Try 'hostname --help' for more information.")
            return 1
          }
        } else {
          args.push(arg)
        }
      }

      if (args.length > 0) {
        await writelnStderr(process, terminal, 'hostname: invalid argument')
        await writelnStderr(process, terminal, "Try 'hostname --help' for more information.")
        return 1
      }

      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'

      if (showFqdn) {
        await writelnStdout(process, terminal, hostname)
      } else if (showShort) {
        const shortName = hostname.split('.')[0]
        await writelnStdout(process, terminal, shortName ?? hostname)
      } else {
        await writelnStdout(process, terminal, hostname)
      }

      return 0
    }
  })
}
