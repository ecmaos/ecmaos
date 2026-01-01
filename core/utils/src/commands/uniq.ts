import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'uniq',
    description: 'Report or omit repeated lines',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'count', type: Boolean, alias: 'c', description: 'Prefix lines by the number of occurrences' },
      { name: 'repeated', type: Boolean, alias: 'd', description: 'Only print duplicate lines' },
      { name: 'unique', type: Boolean, alias: 'u', description: 'Only print unique lines' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to process' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const files = (argv.path as string[]) || []
      const count = (argv.count as boolean) || false
      const repeated = (argv.repeated as boolean) || false
      const unique = (argv.unique as boolean) || false

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
            prevLine = line
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
