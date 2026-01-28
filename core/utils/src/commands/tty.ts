import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: tty [TTY_NUMBER]
Print the current TTY number or switch to a different TTY.

  TTY_NUMBER    switch to the specified TTY (0-9)
  --help        display this help and exit

If no TTY_NUMBER is provided, prints the current TTY number.
If TTY_NUMBER is provided, switches to that TTY.`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tty',
    description: 'Print the current TTY number or switch to a different TTY',
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
        await writelnStdout(process, terminal, kernel.activeTty.toString())
        return 0
      }

      if (argv.length > 1) {
        await writelnStderr(process, terminal, 'tty: too many arguments')
        await writelnStderr(process, terminal, "Try 'tty --help' for more information.")
        return 1
      }

      const ttyNumber = parseInt(argv[0] ?? '0', 10)

      if (isNaN(ttyNumber)) {
        await writelnStderr(process, terminal, `tty: invalid TTY number '${argv[0]}'`)
        await writelnStderr(process, terminal, "Try 'tty --help' for more information.")
        return 1
      }

      if (ttyNumber < 0 || ttyNumber > 9) {
        await writelnStderr(process, terminal, `tty: TTY number must be between 0 and 9`)
        await writelnStderr(process, terminal, "Try 'tty --help' for more information.")
        return 1
      }

      try {
        await kernel.switchTty(ttyNumber)
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `tty: failed to switch to TTY ${ttyNumber}: ${error instanceof Error ? error.message : String(error)}`)
        return 1
      }
    }
  })
}
