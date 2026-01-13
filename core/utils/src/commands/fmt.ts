import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: fmt [OPTION]... [FILE]...
Reformat paragraph text.

  -w, --width=WIDTH      maximum line width (default: 75)
  -s, --split-only       split long lines, but do not join short lines
  -u, --uniform-spacing use uniform spacing (one space between words)
  --help                display this help and exit`
  writelnStderr(process, terminal, usage)
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function formatText(lines: string[], width: number, splitOnly: boolean, uniformSpacing: boolean): string[] {
  const result: string[] = []
  let currentParagraph: string[] = []
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    if (trimmed === '') {
      if (currentParagraph.length > 0) {
        const formatted = formatParagraph(currentParagraph, width, splitOnly, uniformSpacing)
        result.push(...formatted)
        currentParagraph = []
      }
      result.push('')
    } else {
      currentParagraph.push(trimmed)
    }
  }
  
  if (currentParagraph.length > 0) {
    const formatted = formatParagraph(currentParagraph, width, splitOnly, uniformSpacing)
    result.push(...formatted)
  }
  
  return result
}

function formatParagraph(paragraph: string[], width: number, splitOnly: boolean, uniformSpacing: boolean): string[] {
  if (paragraph.length === 0) return []
  
  let text = paragraph.join(' ')
  if (uniformSpacing) {
    text = normalizeWhitespace(text)
  } else {
    text = text.replace(/\s+/g, ' ')
  }
  
  if (splitOnly) {
    return splitLongLines(text, width)
  }
  
  const words = text.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return []
  
  const result: string[] = []
  let currentLine = ''
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    
    if (testLine.length <= width) {
      currentLine = testLine
    } else {
      if (currentLine) {
        result.push(currentLine)
      }
      currentLine = word
      
      if (currentLine.length > width) {
        const split = splitLongLines(currentLine, width)
        if (split.length > 0) {
          result.push(...split.slice(0, -1))
          currentLine = split[split.length - 1] || word
        }
      }
    }
  }
  
  if (currentLine) {
    result.push(currentLine)
  }
  
  return result
}

function splitLongLines(text: string, width: number): string[] {
  if (text.length <= width) return [text]
  
  const result: string[] = []
  let remaining = text
  
  while (remaining.length > width) {
    let breakPoint = width
    
    const spaceIndex = remaining.lastIndexOf(' ', width)
    if (spaceIndex > 0) {
      breakPoint = spaceIndex
    }
    
    result.push(remaining.slice(0, breakPoint).trim())
    remaining = remaining.slice(breakPoint).trim()
  }
  
  if (remaining.length > 0) {
    result.push(remaining)
  }
  
  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'fmt',
    description: 'Reformat paragraph text',
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

      let width = 75
      let splitOnly = false
      let uniformSpacing = false
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-w' || arg === '--width') {
          if (i + 1 < argv.length) {
            const widthStr = argv[++i]
            if (widthStr !== undefined) {
              const parsed = parseInt(widthStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                width = parsed
              } else {
                await writelnStderr(process, terminal, `fmt: invalid width: ${widthStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--width=')) {
          const widthStr = arg.slice(8)
          const parsed = parseInt(widthStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            width = parsed
          } else {
            await writelnStderr(process, terminal, `fmt: invalid width: ${widthStr}`)
            return 1
          }
        } else if (arg.startsWith('-w')) {
          const widthStr = arg.slice(2)
          if (widthStr) {
            const parsed = parseInt(widthStr, 10)
            if (!isNaN(parsed) && parsed > 0) {
              width = parsed
            } else {
              await writelnStderr(process, terminal, `fmt: invalid width: ${widthStr}`)
              return 1
            }
          }
        } else if (arg === '-s' || arg === '--split-only') {
          splitOnly = true
        } else if (arg === '-u' || arg === '--uniform-spacing') {
          uniformSpacing = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('s')) splitOnly = true
          if (flags.includes('u')) uniformSpacing = true
          const invalidFlags = flags.filter(f => !['s', 'u'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `fmt: invalid option -- '${invalidFlags[0]}'`)
            await writelnStderr(process, terminal, "Try 'fmt --help' for more information.")
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
                await writelnStderr(process, terminal, `fmt: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `fmt: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        const formatted = formatText(lines, width, splitOnly, uniformSpacing)
        for (const line of formatted) {
          await writer.write(new TextEncoder().encode(line + '\n'))
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `fmt: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
