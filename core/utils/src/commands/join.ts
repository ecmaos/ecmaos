import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'join',
    description: 'Join lines of two files on a common field',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'field', type: Number, alias: 'j', description: 'Specify field for joining', defaultValue: 1 },
      { name: 'file1-field', type: Number, description: 'Field to join from file1' },
      { name: 'file2-field', type: Number, description: 'Field to join from file2' },
      { name: 'delimiter', type: String, alias: 't', description: 'Use character as field delimiter', defaultValue: ' ' },
      { name: 'files', type: String, defaultOption: true, multiple: true, description: 'FILE1 FILE2' }
    ],
    run: async (argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => {
      if (!process) return 1

      let files = (argv.files as string[]) || []
      let field1 = (argv['file1-field'] as number) ?? ((argv.field as number) ?? 1)
      let field2 = (argv['file2-field'] as number) ?? ((argv.field as number) ?? 1)
      let delimiter = (argv.delimiter as string) || ' '

      if (rawArgv) {
        for (let i = 0; i < rawArgv.length; i++) {
          const arg = rawArgv[i]
          if (!arg) continue
          
          if (arg === '-1' && i + 1 < rawArgv.length) {
            const nextArg = rawArgv[++i]
            if (nextArg !== undefined) {
              field1 = parseInt(nextArg, 10) || 1
            }
          } else if (arg === '-2' && i + 1 < rawArgv.length) {
            const nextArg = rawArgv[++i]
            if (nextArg !== undefined) {
              field2 = parseInt(nextArg, 10) || 1
            }
          } else if (arg.startsWith('-t')) {
            delimiter = arg.slice(2) || ' '
          } else if (arg === '-t' && i + 1 < rawArgv.length) {
            const nextArg = rawArgv[++i]
            if (nextArg !== undefined) {
              delimiter = nextArg
            }
          } else if (!arg.startsWith('-')) {
            if (files.length < 2) {
              files.push(arg)
            }
          }
        }
      }

      if (files.length !== 2) {
        await writelnStderr(process, terminal, 'join: exactly two files must be specified')
        return 1
      }

      const file1 = files[0]
      const file2 = files[1]

      const writer = process.stdout.getWriter()

      const readFileLines = async (filePath: string): Promise<string[]> => {
        if (filePath.startsWith('/dev')) {
          throw new Error('cannot join device files')
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
        const fullPath1 = path.resolve(shell.cwd, file1)
        const fullPath2 = path.resolve(shell.cwd, file2)

        const lines1 = await readFileLines(fullPath1)
        const lines2 = await readFileLines(fullPath2)

        const map1 = new Map<string, string[]>()
        for (const line of lines1) {
          const parts = line.split(delimiter)
          const key = parts[field1 - 1] || ''
          if (!map1.has(key)) {
            map1.set(key, [])
          }
          map1.get(key)!.push(line)
        }

        for (const line of lines2) {
          const parts = line.split(delimiter)
          const key = parts[field2 - 1] || ''
          const matches = map1.get(key)
          if (matches) {
            for (const match of matches) {
              const matchParts = match.split(delimiter)
              const output = [...matchParts, ...parts.slice(field2)].join(delimiter)
              await writer.write(new TextEncoder().encode(output + '\n'))
            }
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `join: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
