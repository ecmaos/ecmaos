import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: sort [OPTION]... [FILE]...
Sort lines of text files.

  -r, --reverse  reverse the result of comparisons
  -n, --numeric   compare according to string numerical value
  -u, --unique    output only the first of an equal run
  --help          display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'sort',
    description: 'Sort lines of text files',
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

      const files: string[] = []
      let reverse = false
      let numeric = false
      let unique = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-r' || arg === '--reverse') {
          reverse = true
        } else if (arg === '-n' || arg === '--numeric') {
          numeric = true
        } else if (arg === '-u' || arg === '--unique') {
          unique = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('r')) reverse = true
          if (flags.includes('n')) numeric = true
          if (flags.includes('u')) unique = true
          const invalidFlags = flags.filter(f => !['r', 'n', 'u'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `sort: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        } else {
          files.push(arg)
        }
      }

      const writer = process.stdout.getWriter()

      try {
        let lines: string[] = []

        if (files.length === 0) {
          if (!process.stdin) {
            return 0
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) {
                buffer += decoder.decode(value, { stream: true })
                const newLines = buffer.split('\n')
                buffer = newLines.pop() || ''
                lines.push(...newLines)
              }
            }
            if (buffer) {
              lines.push(buffer)
            }
          } finally {
            reader.releaseLock()
          }
        } else {
          for (const file of files) {
            const fullPath = path.resolve(shell.cwd, file)

            let interrupted = false
            const interruptHandler = () => { interrupted = true }
            kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

            try {
              if (fullPath.startsWith('/dev')) {
                await writelnStderr(process, terminal, `sort: ${file}: cannot sort device files`)
                continue
              }

              const handle = await shell.context.fs.promises.open(fullPath, 'r')
              const stat = await shell.context.fs.promises.stat(fullPath)

              const decoder = new TextDecoder()
              let content = ''
              let bytesRead = 0
              const chunkSize = 1024

              while (bytesRead < stat.size) {
                if (interrupted) break
                const data = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - bytesRead)
                await handle.read(data, 0, readSize, bytesRead)
                const chunk = data.subarray(0, readSize)
                content += decoder.decode(chunk, { stream: true })
                bytesRead += readSize
              }

              const fileLines = content.split('\n')
              if (fileLines[fileLines.length - 1] === '') {
                fileLines.pop()
              }
              lines.push(...fileLines)
            } catch (error) {
              await writelnStderr(process, terminal, `sort: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        if (numeric) {
          lines.sort((a, b) => {
            const numA = parseFloat(a.trim())
            const numB = parseFloat(b.trim())
            if (isNaN(numA) && isNaN(numB)) return a.localeCompare(b)
            if (isNaN(numA)) return 1
            if (isNaN(numB)) return -1
            return reverse ? numB - numA : numA - numB
          })
        } else {
          lines.sort((a, b) => {
            return reverse ? b.localeCompare(a) : a.localeCompare(b)
          })
        }

        if (unique) {
          const seen = new Set<string>()
          lines = lines.filter(line => {
            if (seen.has(line)) return false
            seen.add(line)
            return true
          })
        }

        for (const line of lines) {
          await writer.write(new TextEncoder().encode(line + '\n'))
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
