import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'hex',
    description: 'Display file contents or stdin in hexadecimal format',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file to display (if omitted, reads from stdin)' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const filePath = argv.path as string | undefined
      let data: Uint8Array

      try {
        if (!filePath) {
          if (!process.stdin) {
            await writelnStderr(process, terminal, 'Usage: hex <file>')
            await writelnStderr(process, terminal, '   or: <command> | hex')
            return 1
          }

          if (process.stdinIsTTY) {
            await writelnStderr(process, terminal, 'Usage: hex <file>')
            await writelnStderr(process, terminal, '   or: <command> | hex')
            return 1
          }

          const reader = process.stdin.getReader()
          const chunks: Uint8Array[] = []

          try {
            const first = await reader.read()
            
            if (first.done && !first.value) {
              await writelnStderr(process, terminal, 'Usage: hex <file>')
              await writelnStderr(process, terminal, '   or: <command> | hex')
              return 1
            }
            
            if (first.value) {
              chunks.push(first.value)
            }
            
            if (!first.done) {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                if (value) {
                  chunks.push(value)
                }
              }
            }
          } finally {
            reader.releaseLock()
          }

          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          if (totalLength === 0) {
            await writelnStderr(process, terminal, 'Usage: hex <file>')
            await writelnStderr(process, terminal, '   or: <command> | hex')
            return 1
          }

          data = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }
        } else {
          const fullPath = path.resolve(shell.cwd, filePath)

          const exists = await shell.context.fs.promises.exists(fullPath)
          if (!exists) {
            await writelnStderr(process, terminal, `hex: ${filePath}: No such file or directory`)
            return 1
          }

          const stats = await shell.context.fs.promises.stat(fullPath)
          if (stats.isDirectory()) {
            await writelnStderr(process, terminal, `hex: ${filePath}: Is a directory`)
            return 1
          }

          data = await shell.context.fs.promises.readFile(fullPath)
        }
        const bytesPerLine = 16

        for (let offset = 0; offset < data.length; offset += bytesPerLine) {
          const lineBytes = data.slice(offset, offset + bytesPerLine)
          const offsetHex = offset.toString(16).padStart(8, '0')
          
          const hexGroups: string[] = []
          const asciiChars: string[] = []
          
          for (let i = 0; i < bytesPerLine; i++) {
            if (i < lineBytes.length) {
              const byte = lineBytes[i]
              if (byte === undefined) continue
              
              const hex = byte.toString(16).padStart(2, '0')
              
              if (i % 2 === 0) {
                hexGroups.push(hex)
              } else {
                hexGroups[hexGroups.length - 1] += hex
              }
              
              if (byte >= 32 && byte <= 126) {
                asciiChars.push(String.fromCharCode(byte))
              } else {
                asciiChars.push('.')
              }
            } else {
              if (i % 2 === 0) {
                hexGroups.push('  ')
              } else {
                hexGroups[hexGroups.length - 1] += '  '
              }
              asciiChars.push(' ')
            }
          }
          
          const hexString = hexGroups.join(' ').padEnd(47, ' ')
          const asciiString = asciiChars.join('')
          
          await writelnStdout(process, terminal, `${offsetHex}: ${hexString}  ${asciiString}`)
        }

        return 0
      } catch (error) {
        const errorPath = filePath || 'stdin'
        await writelnStderr(process, terminal, `hex: ${errorPath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      }
    }
  })
}
