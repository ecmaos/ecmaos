import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'paste',
    description: 'Merge lines of files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'delimiters', type: String, alias: 'd', description: 'Reuse characters from LIST instead of TABs', defaultValue: '\t' },
      { name: 'serial', type: Boolean, alias: 's', description: 'Paste one file at a time instead of in parallel' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to paste' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const files = (argv.path as string[]) || []
      const delimiters = (argv.delimiters as string) || '\t'
      const serial = (argv.serial as boolean) || false

      const writer = process.stdout.getWriter()

      const readFileLines = async (filePath: string): Promise<string[]> => {
        if (filePath.startsWith('/dev')) {
          throw new Error('cannot paste device files')
        }

        let interrupted = false
        const interruptHandler = () => { interrupted = true }
        kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

        try {
          const handle = await shell.context.fs.promises.open(filePath, 'r')
          const stat = await shell.context.fs.promises.stat(filePath)

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

          const lines = content.split('\n')
          if (lines[lines.length - 1] === '') {
            lines.pop()
          }
          return lines
        } finally {
          kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
        }
      }

      try {
        if (files.length === 0) {
          if (!process.stdin) {
            return 0
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          let content = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) {
                content += decoder.decode(value, { stream: true })
              }
            }
          } finally {
            reader.releaseLock()
          }

          const lines = content.split('\n')
          if (lines[lines.length - 1] === '') {
            lines.pop()
          }

          for (const line of lines) {
            await writer.write(new TextEncoder().encode(line + '\n'))
          }

          return 0
        }

        const fileLines: string[][] = []

        for (const file of files) {
          const fullPath = path.resolve(shell.cwd, file)
          try {
            const lines = await readFileLines(fullPath)
            fileLines.push(lines)
          } catch (error) {
            await writelnStderr(process, terminal, `paste: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            return 1
          }
        }

        if (serial) {
          for (const file of fileLines) {
            for (const line of file) {
              await writer.write(new TextEncoder().encode(line + '\n'))
            }
          }
        } else {
          const maxLines = Math.max(...fileLines.map(f => f.length))
          const delimiter = delimiters[0] || '\t'

          for (let i = 0; i < maxLines; i++) {
            const parts: string[] = []
            for (const file of fileLines) {
              parts.push(file[i] || '')
            }
            await writer.write(new TextEncoder().encode(parts.join(delimiter) + '\n'))
          }
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
