import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cut',
    description: 'Remove sections from each line of files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'fields', type: String, alias: 'f', description: 'Select only these fields' },
      { name: 'delimiter', type: String, alias: 'd', description: 'Use DELIM instead of TAB for field delimiter', defaultValue: '\t' },
      { name: 'characters', type: String, alias: 'c', description: 'Select only these characters' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to process' }
    ],
    run: async (argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => {
      if (!process) return 1

      let fields: string | undefined = (argv.fields as string | undefined) || (argv.f as string | undefined)
      let delimiter: string = (argv.delimiter as string) || (argv.d as string) || '\t'
      let characters: string | undefined = (argv.characters as string | undefined) || (argv.c as string | undefined)
      const processedArgs = new Set<number>()

      if (rawArgv) {
        for (let i = 0; i < rawArgv.length; i++) {
          const arg = rawArgv[i]
          if (!arg) continue
          
          if (arg === '-f' || arg.startsWith('-f')) {
            processedArgs.add(i)
            if (arg === '-f' && i + 1 < rawArgv.length) {
              const nextArg = rawArgv[++i]
              if (nextArg !== undefined) {
                fields = nextArg
                processedArgs.add(i)
              }
            } else if (arg.startsWith('-f')) {
              fields = arg.slice(2)
            }
          } else if (arg === '-c' || arg.startsWith('-c')) {
            processedArgs.add(i)
            if (arg === '-c' && i + 1 < rawArgv.length) {
              const nextArg = rawArgv[++i]
              if (nextArg !== undefined) {
                characters = nextArg
                processedArgs.add(i)
              }
            } else if (arg.startsWith('-c')) {
              characters = arg.slice(2)
            }
          } else if (arg === '-d' || arg.startsWith('-d')) {
            processedArgs.add(i)
            if (arg === '-d' && i + 1 < rawArgv.length) {
              const nextArg = rawArgv[++i]
              if (nextArg !== undefined) {
                delimiter = nextArg
                processedArgs.add(i)
              }
            } else if (arg.startsWith('-d')) {
              delimiter = arg.slice(2)
            }
          }
        }
      }

      const files = rawArgv 
        ? rawArgv.filter((arg, index) => arg && !processedArgs.has(index) && !arg.startsWith('-'))
        : ((argv.path as string[]) || [])

      if (!fields && !characters) {
        await writelnStderr(process, terminal, 'cut: you must specify a list of bytes, characters, or fields')
        return 1
      }

      const writer = process.stdout.getWriter()

      const parseRange = (range: string): number[] => {
        const result: number[] = []
        const parts = range.split(',')
        
        for (const part of parts) {
          if (part.includes('-')) {
            const splitParts = part.split('-')
            const start = splitParts[0]
            const end = splitParts[1]
            const startNum = (start === '' || start === undefined) ? 1 : parseInt(start, 10)
            const endNum = (end === '' || end === undefined) ? Infinity : parseInt(end, 10)
            
            for (let i = startNum; i <= endNum; i++) {
              result.push(i)
            }
          } else {
            result.push(parseInt(part, 10))
          }
        }
        
        return result.sort((a, b) => a - b)
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
                await writelnStderr(process, terminal, `cut: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `cut: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        for (const line of lines) {
          let output = ''

          if (characters) {
            const indices = parseRange(characters)
            const chars = line.split('')
            output = indices.map(i => chars[i - 1] || '').join('')
          } else if (fields) {
            const indices = parseRange(fields)
            const parts = line.split(delimiter)
            output = indices.map(i => (parts[i - 1] || '')).join(delimiter)
          }

          await writer.write(new TextEncoder().encode(output + '\n'))
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
