import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'nl',
    description: 'Number lines of files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'starting-line', type: Number, alias: 'v', description: 'First line number for each section', defaultValue: 1 },
      { name: 'increment', type: Number, alias: 'i', description: 'Line number increment at each line', defaultValue: 1 },
      { name: 'format', type: String, alias: 'n', description: 'Line number format: ln (left, no zero), rn (right, no zero), rz (right, zero)', defaultValue: 'rn' },
      { name: 'width', type: Number, alias: 'w', description: 'Use NUMBER columns for line numbers', defaultValue: 6 },
      { name: 'separator', type: String, alias: 's', description: 'Add STRING after (possible) line number', defaultValue: '\t' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to number' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const files = (argv.path as string[]) || []
      const startLine = (argv['starting-line'] as number) ?? 1
      const increment = (argv.increment as number) ?? 1
      const format = (argv.format as string) || 'rn'
      const width = (argv.width as number) ?? 6
      const separator = (argv.separator as string) || '\t'

      const writer = process.stdout.getWriter()

      const formatNumber = (num: number): string => {
        const numStr = num.toString()
        if (format === 'rz') {
          return numStr.padStart(width, '0')
        } else if (format === 'ln') {
          return numStr.padEnd(width, ' ')
        } else {
          return numStr.padStart(width, ' ')
        }
      }

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
                await writelnStderr(process, terminal, `nl: ${file}: cannot number device files`)
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
              await writelnStderr(process, terminal, `nl: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        let lineNumber = startLine
        for (const line of lines) {
          const formattedNum = formatNumber(lineNumber)
          await writer.write(new TextEncoder().encode(`${formattedNum}${separator}${line}\n`))
          lineNumber += increment
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
