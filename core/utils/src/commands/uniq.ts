import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: uniq [OPTION]... [INPUT [OUTPUT]]
Report or omit repeated lines.

  -c, --count     prefix lines by the number of occurrences
  -d, --repeated  only print duplicate lines
  -u, --unique    only print unique lines
  --help          display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'uniq',
    description: 'Report or omit repeated lines',
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
      let count = false
      let repeated = false
      let unique = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-c' || arg === '--count') {
          count = true
        } else if (arg === '-d' || arg === '--repeated') {
          repeated = true
        } else if (arg === '-u' || arg === '--unique') {
          unique = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('c')) count = true
          if (flags.includes('d')) repeated = true
          if (flags.includes('u')) unique = true
          const invalidFlags = flags.filter(f => !['c', 'd', 'u'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `uniq: invalid option -- '${invalidFlags[0]}'`)
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
                await writelnStderr(process, terminal, `uniq: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `uniq: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        if (lines.length === 0) {
          return 0
        }

        let prevLine: string | null = null
        let countValue = 1

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (line === undefined) continue

          if (prevLine === null) {
            prevLine = line
            countValue = 1
            continue
          }

          if (line === prevLine) {
            countValue++
          } else {
            if (repeated && countValue === 1) {
            } else if (unique && countValue > 1) {
            } else {
              const output = count ? `${countValue.toString().padStart(7)} ${prevLine}` : prevLine
              await writer.write(new TextEncoder().encode(output + '\n'))
            }
            if (line !== undefined) {
              prevLine = line
            }
            countValue = 1
          }
        }

        if (prevLine !== null) {
          if (repeated && countValue === 1) {
          } else if (unique && countValue > 1) {
          } else {
            const output = count ? `${countValue.toString().padStart(7)} ${prevLine}` : prevLine
            await writer.write(new TextEncoder().encode(output + '\n'))
          }
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
