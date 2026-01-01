import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'sort',
    description: 'Sort lines of text files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'reverse', type: Boolean, alias: 'r', description: 'Reverse the result of comparisons' },
      { name: 'numeric', type: Boolean, alias: 'n', description: 'Compare according to string numerical value' },
      { name: 'unique', type: Boolean, alias: 'u', description: 'Output only the first of an equal run' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to sort' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const files = (argv.path as string[]) || []
      const reverse = (argv.reverse as boolean) || false
      const numeric = (argv.numeric as boolean) || false
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
