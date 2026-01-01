import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: head [OPTION]... [FILE]...
Print the first 10 lines of each FILE to standard output.

  -n, -nNUMBER        print the first NUMBER lines instead of 10
  --help             display this help and exit`
  writelnStdout(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'head',
    description: 'Print the first lines of files',
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

      let numLines = 10
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-n' || arg.startsWith('-n')) {
          if (arg === '-n' && i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined) {
              const num = parseInt(nextArg, 10)
              if (!isNaN(num)) numLines = num
            }
          } else if (arg.startsWith('-n') && arg.length > 2) {
            const num = parseInt(arg.slice(2), 10)
            if (!isNaN(num)) numLines = num
          }
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        }
      }

      const writer = process.stdout.getWriter()

      try {
        if (files.length === 0) {
          if (!process.stdin) {
            return 0
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          const lines: string[] = []
          let buffer = ''

          try {
            while (true) {
              let readResult
              try {
                readResult = await reader.read()
              } catch (error) {
                if (error instanceof Error) {
                  throw error
                }
                break
              }

              const { done, value } = readResult
              if (done) {
                buffer += decoder.decode()
                break
              }
              if (value) {
                buffer += decoder.decode(value, { stream: true })
                const newLines = buffer.split('\n')
                buffer = newLines.pop() || ''
                lines.push(...newLines)
                if (lines.length >= numLines) break
              }
            }
            if (buffer && lines.length < numLines) {
              lines.push(buffer)
            }
          } finally {
            try {
              reader.releaseLock()
            } catch {
            }
          }

          const output = lines.slice(0, numLines).join('\n')
          if (output) {
            await writer.write(new TextEncoder().encode(output + '\n'))
          }

          return 0
        }

        const isMultipleFiles = files.length > 1

        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          if (!file) continue
          const fullPath = path.resolve(shell.cwd, file)

          if (isMultipleFiles) {
            const header = i > 0 ? '\n' : ''
            await writer.write(new TextEncoder().encode(`${header}==> ${file} <==\n`))
          }

          let interrupted = false
          const interruptHandler = () => { interrupted = true }
          kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

          try {
            if (!fullPath.startsWith('/dev')) {
              const handle = await shell.context.fs.promises.open(fullPath, 'r')
              const stat = await shell.context.fs.promises.stat(fullPath)

              const decoder = new TextDecoder()
              const lines: string[] = []
              let buffer = ''
              let bytesRead = 0
              const chunkSize = 1024

              while (bytesRead < stat.size && lines.length < numLines) {
                if (interrupted) break
                const data = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - bytesRead)
                await handle.read(data, 0, readSize, bytesRead)
                const chunk = data.subarray(0, readSize)
                buffer += decoder.decode(chunk, { stream: true })
                const newLines = buffer.split('\n')
                buffer = newLines.pop() || ''
                lines.push(...newLines)
                bytesRead += readSize
                if (lines.length >= numLines) break
              }
              if (buffer && lines.length < numLines) {
                lines.push(buffer)
              }

              const output = lines.slice(0, numLines).join('\n')
              if (output) {
                await writer.write(new TextEncoder().encode(output + '\n'))
              }
            } else {
              const device = await shell.context.fs.promises.open(fullPath)
              const decoder = new TextDecoder()
              const lines: string[] = []
              let buffer = ''
              const chunkSize = 1024
              const data = new Uint8Array(chunkSize)
              let bytesRead = 0

              do {
                if (interrupted) break
                const result = await device.read(data)
                bytesRead = result.bytesRead
                if (bytesRead > 0) {
                  buffer += decoder.decode(data.subarray(0, bytesRead), { stream: true })
                  const newLines = buffer.split('\n')
                  buffer = newLines.pop() || ''
                  lines.push(...newLines)
                  if (lines.length >= numLines) break
                }
              } while (bytesRead > 0 && lines.length < numLines)

              if (buffer && lines.length < numLines) {
                lines.push(buffer)
              }

              const output = lines.slice(0, numLines).join('\n')
              if (output) {
                await writer.write(new TextEncoder().encode(output + '\n'))
              }
            }
          } finally {
            kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
          }
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
