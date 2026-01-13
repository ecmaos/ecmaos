import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: pr [OPTION]... [FILE]...
Paginate or columnate files for printing.

  -l, --length=NUMBER    set page length (default: 66)
  -w, --width=NUMBER     set page width (default: 72)
  -h, --header=HEADER    set header string
  -t, --omit-header      omit page headers and footers
  -n, --number-lines     number lines
  --help                 display this help and exit`
  writelnStderr(process, terminal, usage)
}

function formatPage(lines: string[], pageLength: number, pageWidth: number, header: string | undefined, omitHeader: boolean, numberLines: boolean, pageNum: number, filename: string): string[] {
  const result: string[] = []
  const bodyLength = omitHeader ? pageLength : pageLength - 2
  
  if (!omitHeader && header !== undefined) {
    const headerLine = header.padEnd(pageWidth).slice(0, pageWidth)
    result.push(headerLine)
    result.push('')
  } else if (!omitHeader) {
    const date = new Date().toLocaleString()
    const headerLine = `${filename} ${date}`.padEnd(pageWidth).slice(0, pageWidth)
    result.push(headerLine)
    result.push('')
  }
  
  const startLine = (pageNum - 1) * bodyLength
  const endLine = Math.min(startLine + bodyLength, lines.length)
  
  for (let i = startLine; i < endLine; i++) {
    let line = lines[i] || ''
    if (line.length > pageWidth) {
      line = line.slice(0, pageWidth)
    } else {
      line = line.padEnd(pageWidth)
    }
    
    if (numberLines) {
      const lineNum = (i + 1).toString().padStart(6)
      line = `${lineNum}  ${line.slice(0, pageWidth - 8)}`
    }
    
    result.push(line)
  }
  
  while (result.length < pageLength && !omitHeader) {
    result.push('')
  }
  
  if (!omitHeader) {
    const footer = `Page ${pageNum}`.padStart(pageWidth)
    result.push(footer)
  }
  
  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'pr',
    description: 'Paginate or columnate files for printing',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (!process) return 1

      let pageLength = 66
      let pageWidth = 72
      let header: string | undefined
      let omitHeader = false
      let numberLines = false
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help') {
          printUsage(process, terminal)
          return 0
        } else if (arg.startsWith('--header=')) {
          header = arg.slice(9)
        } else if (arg === '--header') {
          if (i + 1 < argv.length) {
            header = argv[++i]
          } else {
            await writelnStderr(process, terminal, `pr: option '--header' requires an argument`)
            return 1
          }
        } else if (arg === '-h') {
          if (i + 1 < argv.length) {
            header = argv[++i]
          } else {
            printUsage(process, terminal)
            return 0
          }
        } else if (arg.startsWith('-h') && arg.length > 2) {
          header = arg.slice(2)
        } else if (arg === '-l' || arg === '--length') {
          if (i + 1 < argv.length) {
            const lengthStr = argv[++i]
            if (lengthStr !== undefined) {
              const parsed = parseInt(lengthStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                pageLength = parsed
              } else {
                await writelnStderr(process, terminal, `pr: invalid page length: ${lengthStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--length=')) {
          const lengthStr = arg.slice(9)
          const parsed = parseInt(lengthStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            pageLength = parsed
          } else {
            await writelnStderr(process, terminal, `pr: invalid page length: ${lengthStr}`)
            return 1
          }
        } else if (arg.startsWith('-l')) {
          const lengthStr = arg.slice(2)
          if (lengthStr) {
            const parsed = parseInt(lengthStr, 10)
            if (!isNaN(parsed) && parsed > 0) {
              pageLength = parsed
            } else {
              await writelnStderr(process, terminal, `pr: invalid page length: ${lengthStr}`)
              return 1
            }
          }
        } else if (arg === '-w' || arg === '--width') {
          if (i + 1 < argv.length) {
            const widthStr = argv[++i]
            if (widthStr !== undefined) {
              const parsed = parseInt(widthStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                pageWidth = parsed
              } else {
                await writelnStderr(process, terminal, `pr: invalid page width: ${widthStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--width=')) {
          const widthStr = arg.slice(8)
          const parsed = parseInt(widthStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            pageWidth = parsed
          } else {
            await writelnStderr(process, terminal, `pr: invalid page width: ${widthStr}`)
            return 1
          }
        } else if (arg.startsWith('-w')) {
          const widthStr = arg.slice(2)
          if (widthStr) {
            const parsed = parseInt(widthStr, 10)
            if (!isNaN(parsed) && parsed > 0) {
              pageWidth = parsed
            } else {
              await writelnStderr(process, terminal, `pr: invalid page width: ${widthStr}`)
              return 1
            }
          }
        } else if (arg === '-t' || arg === '--omit-header') {
          omitHeader = true
        } else if (arg === '-n' || arg === '--number-lines') {
          numberLines = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('t')) omitHeader = true
          if (flags.includes('n')) numberLines = true
          const invalidFlags = flags.filter(f => !['t', 'n'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `pr: invalid option -- '${invalidFlags[0]}'`)
            await writelnStderr(process, terminal, "Try 'pr --help' for more information.")
            return 1
          }
        } else {
          files.push(arg)
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
                await writelnStderr(process, terminal, `pr: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `pr: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        const bodyLength = omitHeader ? pageLength : pageLength - 2
        const totalPages = Math.ceil(lines.length / bodyLength)
        const filename = files[0] ?? 'stdin'

        for (let page = 1; page <= totalPages; page++) {
          const pageLines = formatPage(lines, pageLength, pageWidth, header, omitHeader, numberLines, page, filename)
          for (const line of pageLines) {
            await writer.write(new TextEncoder().encode(line + '\n'))
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `pr: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
