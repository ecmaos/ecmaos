import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: expand [OPTION]... [FILE]...
Convert tabs to spaces in each FILE.

  -t, --tabs=NUMBER     have tabs NUMBER characters apart, not 8
  -t, --tabs=LIST       use comma separated list of tab positions
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

function expandTabs(line: string, tabStops: number[]): string {
  let result = ''
  let column = 0
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (char === '\t') {
      let nextStop = tabStops[0] ?? 8
      for (const stop of tabStops) {
        if (stop > column) {
          nextStop = stop
          break
        }
      }
      
      if (nextStop <= column) {
        const lastStop = tabStops[tabStops.length - 1] ?? 8
        nextStop = lastStop
        while (nextStop <= column) {
          nextStop += lastStop
        }
      }
      
      const spaces = nextStop - column
      result += ' '.repeat(spaces)
      column = nextStop
    } else {
      result += char
      if (char === '\n' || char === '\r') {
        column = 0
      } else {
        column++
      }
    }
  }
  
  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'expand',
    description: 'Convert tabs to spaces',
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
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        } else {
          await writelnStderr(process, terminal, `expand: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'expand --help' for more information.")
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
                await writelnStderr(process, terminal, `expand: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `expand: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        for (const line of lines) {
          const expanded = expandTabs(line, tabStops)
          await writer.write(new TextEncoder().encode(expanded + '\n'))
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `expand: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
