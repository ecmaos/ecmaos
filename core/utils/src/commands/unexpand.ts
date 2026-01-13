import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: unexpand [OPTION]... [FILE]...
Convert spaces to tabs in each FILE.

  -t, --tabs=NUMBER     have tabs NUMBER characters apart, not 8
  -t, --tabs=LIST      use comma separated list of tab positions
  -a, --all            convert all spaces, not just leading spaces
  --help               display this help and exit`
  writelnStderr(process, terminal, usage)
}

function parseTabStops(tabStr: string): number[] {
  if (tabStr.includes(',')) {
    const stops = tabStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0)
    return stops.length > 0 ? stops : [8]
  }
  const single = parseInt(tabStr, 10)
  return !isNaN(single) && single > 0 ? [single] : [8]
}

function unexpandTabs(line: string, tabStops: number[], all: boolean): string {
  if (all) {
    return unexpandAllSpaces(line, tabStops)
  } else {
    return unexpandLeadingSpaces(line, tabStops)
  }
}

function getNextTabStop(column: number, tabStops: number[]): number {
  if (tabStops.length === 1) {
    const interval = tabStops[0] ?? 8
    return Math.ceil((column + 1) / interval) * interval
  }

  for (const stop of tabStops) {
    if (stop > column) {
      return stop
    }
  }

  const lastStop = tabStops[tabStops.length - 1]
  let nextStop = lastStop ?? 8
  while (nextStop <= column) {
    nextStop += lastStop ?? 8
  }
  return nextStop
}

function unexpandLeadingSpaces(line: string, tabStops: number[]): string {
  let leadingSpaces = 0
  let i = 0

  while (i < line.length && line[i] === ' ') {
    leadingSpaces++
    i++
  }

  if (leadingSpaces === 0) {
    return line
  }

  let result = ''
  let column = 0
  let spaceIdx = 0

  while (spaceIdx < leadingSpaces) {
    const nextStop = getNextTabStop(column, tabStops)
    const spacesToNextStop = nextStop - column
    const remainingSpaces = leadingSpaces - spaceIdx

    if (spacesToNextStop <= remainingSpaces) {
      result += '\t'
      column = nextStop
      spaceIdx += spacesToNextStop
    } else {
      result += ' '
      column++
      spaceIdx++
    }
  }

  return result + line.slice(leadingSpaces)
}

function unexpandAllSpaces(line: string, tabStops: number[]): string {
  let result = ''
  let column = 0
  let spaceCount = 0
  let spaceStartColumn = 0

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === ' ') {
      if (spaceCount === 0) {
        spaceStartColumn = column
      }
      spaceCount++
      column++
    } else {
      if (spaceCount > 0) {
        result += convertSpacesToTabs(spaceStartColumn, spaceCount, tabStops)
        spaceCount = 0
      }

      result += char
      if (char === '\n' || char === '\r') {
        column = 0
      } else {
        column++
      }
    }
  }

  if (spaceCount > 0) {
    result += ' '.repeat(spaceCount)
  }

  return result
}

function convertSpacesToTabs(startColumn: number, spaceCount: number, tabStops: number[]): string {
  let result = ''
  let column = startColumn
  let spaceIdx = 0

  while (spaceIdx < spaceCount) {
    const nextStop = getNextTabStop(column, tabStops)
    const spacesToNextStop = nextStop - column
    const remainingSpaces = spaceCount - spaceIdx

    if (spacesToNextStop <= remainingSpaces && spacesToNextStop > 1) {
      result += '\t'
      column = nextStop
      spaceIdx += spacesToNextStop
    } else if (spacesToNextStop === 1 && remainingSpaces >= 1) {
      result += '\t'
      column = nextStop
      spaceIdx += 1
    } else {
      result += ' '
      column++
      spaceIdx++
    }
  }

  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'unexpand',
    description: 'Convert spaces to tabs',
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

      let tabStops: number[] = [8]
      let all = false
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-t' || arg === '--tabs') {
          if (i + 1 < argv.length) {
            const tabStr = argv[++i]
            if (tabStr !== undefined) {
              tabStops = parseTabStops(tabStr)
            }
          }
        } else if (arg.startsWith('--tabs=')) {
          const tabStr = arg.slice(7)
          tabStops = parseTabStops(tabStr)
        } else if (arg.startsWith('-t')) {
          const tabStr = arg.slice(2)
          if (tabStr) {
            tabStops = parseTabStops(tabStr)
          }
        } else if (arg === '-a' || arg === '--all') {
          all = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('a')) all = true
          const invalidFlags = flags.filter(f => f !== 'a')
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `unexpand: invalid option -- '${invalidFlags[0]}'`)
            await writelnStderr(process, terminal, "Try 'unexpand --help' for more information.")
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
                await writelnStderr(process, terminal, `unexpand: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `unexpand: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        for (const line of lines) {
          const unexpanded = unexpandTabs(line, tabStops, all)
          await writer.write(new TextEncoder().encode(unexpanded + '\n'))
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `unexpand: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
