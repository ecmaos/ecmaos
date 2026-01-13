import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cmp [OPTION]... FILE1 FILE2
Compare two files byte by byte.

  -l, --verbose          print byte number and differing byte values
  -s, --quiet, --silent  suppress output; return exit status only
  --help                 display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cmp',
    description: 'Compare two files byte by byte',
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

      let verbose = false
      let quiet = false
      const files: string[] = []

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-l' || arg === '--verbose') {
          verbose = true
        } else if (arg === '-s' || arg === '--quiet' || arg === '--silent') {
          quiet = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('l')) verbose = true
          if (flags.includes('s')) quiet = true
          const invalidFlags = flags.filter(f => !['l', 's'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `cmp: invalid option -- '${invalidFlags[0]}'`)
            await writelnStderr(process, terminal, "Try 'cmp --help' for more information.")
            return 1
          }
        } else {
          files.push(arg)
        }
      }

      if (files.length !== 2) {
        await writelnStderr(process, terminal, 'cmp: missing operand after')
        await writelnStderr(process, terminal, "Try 'cmp --help' for more information.")
        return 1
      }

      const file1 = files[0]
      const file2 = files[1]
      if (!file1 || !file2) {
        await writelnStderr(process, terminal, 'cmp: missing operand')
        return 1
      }

      const fullPath1 = path.resolve(shell.cwd, file1)
      const fullPath2 = path.resolve(shell.cwd, file2)

      let interrupted = false
      const interruptHandler = () => { interrupted = true }
      kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

      try {
        if (fullPath1.startsWith('/dev') || fullPath2.startsWith('/dev')) {
          await writelnStderr(process, terminal, 'cmp: cannot compare device files')
          return 1
        }

        const data1 = await shell.context.fs.promises.readFile(fullPath1)
        const data2 = await shell.context.fs.promises.readFile(fullPath2)

        const bytes1 = new Uint8Array(data1)
        const bytes2 = new Uint8Array(data2)

        const minLength = Math.min(bytes1.length, bytes2.length)

        for (let i = 0; i < minLength; i++) {
          if (interrupted) break
          if (bytes1[i] !== bytes2[i]) {
            if (verbose) {
              await writelnStderr(process, terminal, `${i + 1} ${bytes1[i]} ${bytes2[i]}`)
            } else if (!quiet) {
              await writelnStderr(process, terminal, `${file1} ${file2} differ: byte ${i + 1}, line ${Math.floor(i / 80) + 1}`)
            }
            return 1
          }
        }

        if (bytes1.length !== bytes2.length) {
          if (!quiet) {
            await writelnStderr(process, terminal, `cmp: EOF on ${bytes1.length < bytes2.length ? file1 : file2}`)
          }
          return 1
        }

        return 0
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `cmp: ${errorMessage}`)
        return 1
      } finally {
        kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      }
    }
  })
}
