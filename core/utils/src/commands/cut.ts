import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cut OPTION... [FILE]...
Remove sections from each line of files.

  -f, --fields=LIST       select only these fields
  -d, --delimiter=DELIM   use DELIM instead of TAB for field delimiter
  -c, --characters=LIST    select only these characters
  --help                  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cut',
    description: 'Remove sections from each line of files',
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

      let fields: string | undefined
      let delimiter: string = '\t'
      let characters: string | undefined
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-f' || arg.startsWith('-f')) {
          if (arg === '-f' && i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined) {
              fields = nextArg
            }
          } else if (arg.startsWith('-f') && arg.length > 2) {
            fields = arg.slice(2)
          } else if (arg.startsWith('--fields=')) {
            fields = arg.slice(9)
          }
        } else if (arg === '-c' || arg.startsWith('-c')) {
          if (arg === '-c' && i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined) {
              characters = nextArg
            }
          } else if (arg.startsWith('-c') && arg.length > 2) {
            characters = arg.slice(2)
          } else if (arg.startsWith('--characters=')) {
            characters = arg.slice(13)
          }
        } else if (arg === '-d' || arg.startsWith('-d')) {
          if (arg === '-d' && i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined) {
              delimiter = nextArg
            }
          } else if (arg.startsWith('-d') && arg.length > 2) {
            delimiter = arg.slice(2)
          } else if (arg.startsWith('--delimiter=')) {
            delimiter = arg.slice(12)
          }
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        }
      }

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
