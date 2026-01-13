import path from 'path'
import columnify from 'columnify'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: column [OPTION]... [FILE]...
Format input into columns.

  -t, --table              create a table
  -s, --separator=SEP      specify column separator (default: whitespace)
  -c, --columns=COLS       specify number of columns
  --help                   display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'column',
    description: 'Format input into columns',
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

      let table = false
      let separator: string | undefined
      let columns: number | undefined
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-t' || arg === '--table') {
          table = true
        } else if (arg === '-s' || arg === '--separator') {
          if (i + 1 < argv.length) {
            separator = argv[++i]
          }
        } else if (arg.startsWith('--separator=')) {
          separator = arg.slice(12)
        } else if (arg.startsWith('-s')) {
          separator = arg.slice(2) || undefined
        } else if (arg === '-c' || arg === '--columns') {
          if (i + 1 < argv.length) {
            const colsStr = argv[++i]
            if (colsStr !== undefined) {
              const parsed = parseInt(colsStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                columns = parsed
              } else {
                await writelnStderr(process, terminal, `column: invalid column count: ${colsStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--columns=')) {
          const colsStr = arg.slice(11)
          const parsed = parseInt(colsStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            columns = parsed
          } else {
            await writelnStderr(process, terminal, `column: invalid column count: ${colsStr}`)
            return 1
          }
        } else if (arg.startsWith('-c')) {
          const colsStr = arg.slice(2)
          if (colsStr) {
            const parsed = parseInt(colsStr, 10)
            if (!isNaN(parsed) && parsed > 0) {
              columns = parsed
            } else {
              await writelnStderr(process, terminal, `column: invalid column count: ${colsStr}`)
              return 1
            }
          }
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        } else {
          await writelnStderr(process, terminal, `column: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'column --help' for more information.")
          return 1
        }
      }

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
                await writelnStderr(process, terminal, `column: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `column: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        if (table && separator) {
          const data: Array<Record<string, string>> = []
          const headers = new Set<string>()

          for (const line of lines) {
            if (!line.trim()) continue
            const parts = line.split(separator)
            const row: Record<string, string> = {}
            parts.forEach((part, idx) => {
              const header = `col${idx + 1}`
              headers.add(header)
              row[header] = part.trim()
            })
            data.push(row)
          }

          if (data.length > 0) {
            const tableOutput = columnify(data, {
              columns: Array.from(headers),
              columnSplitter: '  ',
              showHeaders: true
            })
            await writer.write(new TextEncoder().encode(tableOutput))
          }
        } else if (table) {
          const data: Array<Record<string, string>> = []
          const headers = new Set<string>()

          for (const line of lines) {
            if (!line.trim()) continue
            const parts = line.trim().split(/\s+/)
            const row: Record<string, string> = {}
            parts.forEach((part, idx) => {
              const header = `col${idx + 1}`
              headers.add(header)
              row[header] = part
            })
            data.push(row)
          }

          if (data.length > 0) {
            const tableOutput = columnify(data, {
              columns: Array.from(headers),
              columnSplitter: '  ',
              showHeaders: true
            })
            await writer.write(new TextEncoder().encode(tableOutput))
          }
        } else {
          const words: string[] = []
          for (const line of lines) {
            if (separator) {
              words.push(...line.split(separator).map(w => w.trim()).filter(w => w))
            } else {
              words.push(...line.trim().split(/\s+/).filter(w => w))
            }
          }

          if (columns && columns > 0) {
            const rows: string[][] = []
            for (let i = 0; i < words.length; i += columns) {
              rows.push(words.slice(i, i + columns))
            }

            const data: Array<Record<string, string>> = []
            for (const row of rows) {
              const rowObj: Record<string, string> = {}
              for (let i = 0; i < columns; i++) {
                rowObj[`col${i + 1}`] = row[i] || ''
              }
              data.push(rowObj)
            }

            if (data.length > 0) {
              const tableOutput = columnify(data, {
                columns: Array.from({ length: columns }, (_, i) => `col${i + 1}`),
                columnSplitter: '  ',
                showHeaders: false
              })
              await writer.write(new TextEncoder().encode(tableOutput))
            }
          } else {
            for (const word of words) {
              await writer.write(new TextEncoder().encode(word + '\n'))
            }
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `column: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
