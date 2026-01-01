import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tail',
    description: 'Print the last lines of files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'lines', type: Number, alias: 'n', description: 'Print the last NUM lines instead of the last 10' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to read' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const writer = process.stdout.getWriter()
      const numLines = (argv.lines as number) ?? 10

      try {
        if (!argv.path || !(argv.path as string[])[0]) {
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
              }
            }
            if (buffer) {
              lines.push(buffer)
            }
          } finally {
            try {
              reader.releaseLock()
            } catch {
            }
          }

          const output = lines.slice(-numLines).join('\n')
          if (output) {
            await writer.write(new TextEncoder().encode(output + '\n'))
          }

          return 0
        }

        const files = (argv.path as string[]) || []
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
              let buffer = ''
              let bytesRead = 0
              const chunkSize = 1024

              while (bytesRead < stat.size) {
                if (interrupted) break
                const data = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - bytesRead)
                await handle.read(data, 0, readSize, bytesRead)
                const chunk = data.subarray(0, readSize)
                buffer += decoder.decode(chunk, { stream: true })
                bytesRead += readSize
              }

              const lines = buffer.split('\n')
              if (lines[lines.length - 1] === '') {
                lines.pop()
              }

              const output = lines.slice(-numLines).join('\n')
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
                }
              } while (bytesRead > 0)

              const allLines = buffer.split('\n')
              if (allLines[allLines.length - 1] === '') {
                allLines.pop()
              }
              lines.push(...allLines)

              const output = lines.slice(-numLines).join('\n')
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
