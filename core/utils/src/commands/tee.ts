import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: tee [OPTION]... [FILE]...
Read from standard input and write to standard output and files.

  -a, --append            append to the given files, do not overwrite
  -i, --ignore-interrupts ignore interrupt signals
  --help                  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tee',
    description: 'Read from standard input and write to standard output and files',
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

      if (!process.stdin) {
        await writelnStderr(process, terminal, 'tee: No input provided')
        return 1
      }

      const files: string[] = []
      let append = false
      let ignoreInterrupts = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-a' || arg === '--append') {
          append = true
        } else if (arg === '-i' || arg === '--ignore-interrupts') {
          ignoreInterrupts = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('a')) append = true
          if (flags.includes('i')) ignoreInterrupts = true
          const invalidFlags = flags.filter(f => !['a', 'i'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `tee: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        } else {
          files.push(arg)
        }
      }

      const writer = process.stdout.getWriter()

      try {
        const filePaths: Array<{ path: string; fullPath: string }> = []
        for (const file of files) {
          const expandedPath = shell.expandTilde(file)
          const fullPath = path.resolve(shell.cwd, expandedPath)

          if (!append) {
            try {
              await shell.context.fs.promises.writeFile(fullPath, '')
            } catch (error) {
              await writelnStderr(process, terminal, `tee: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
              return 1
            }
          }

          filePaths.push({ path: file, fullPath })
        }

        const reader = process.stdin.getReader()
        let interrupted = false

        const interruptHandler = () => { interrupted = true }
        if (!ignoreInterrupts) {
          kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)
        }

        try {
          while (true) {
            if (interrupted) break
            const { done, value } = await reader.read()
            if (done) break

            await writer.write(value)

            for (const fileInfo of filePaths) {
              try {
                await shell.context.fs.promises.appendFile(fileInfo.fullPath, value)
              } catch (error) {
                await writelnStderr(process, terminal, `tee: ${fileInfo.path}: ${error instanceof Error ? error.message : 'Write error'}`)
              }
            }
          }
        } finally {
          reader.releaseLock()
          if (!ignoreInterrupts) {
            kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `tee: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
