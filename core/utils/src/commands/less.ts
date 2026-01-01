import path from 'path'
import ansi from 'ansi-escape-sequences'
import type { IDisposable } from '@xterm/xterm'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: less [OPTION]... FILE
View file contents interactively.

  FILE    the file to view (if omitted, reads from stdin)
  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'less',
    description: 'View file contents interactively',
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

      let lines: string[] = []
      let currentLine = 0
      let keyListener: IDisposable | null = null
      let linesRendered = 0

      try {
        const filePath = argv.length > 0 && argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : undefined

        if (filePath) {
          const expandedPath = shell.expandTilde(filePath)
          const fullPath = path.resolve(shell.cwd, expandedPath)

          const exists = await shell.context.fs.promises.exists(fullPath)
          if (!exists) {
            await writelnStderr(process, terminal, `less: ${filePath}: No such file or directory`)
            return 1
          }

          const stats = await shell.context.fs.promises.stat(fullPath)
          if (stats.isDirectory()) {
            await writelnStderr(process, terminal, `less: ${filePath}: Is a directory`)
            return 1
          }

          const content = await shell.context.fs.promises.readFile(fullPath, 'utf-8')
          lines = content.split('\n')
        } else {
          if (!process.stdin) {
            await writelnStderr(process, terminal, 'less: No input provided')
            return 1
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          const chunks: string[] = []

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              chunks.push(decoder.decode(value, { stream: true }))
            }
            chunks.push(decoder.decode(new Uint8Array(), { stream: false }))
          } finally {
            reader.releaseLock()
          }

          const content = chunks.join('')
          lines = content.split('\n')
        }

        if (lines.length === 0) {
          return 0
        }

        terminal.unlisten()
        terminal.write('\n')
        terminal.write(ansi.cursor.hide)

        const rows = terminal.rows
        const displayRows = rows - 1

        const render = () => {
          const maxLine = Math.max(0, lines.length - displayRows)
          if (currentLine > maxLine) {
            currentLine = maxLine
          }
          if (currentLine < 0) {
            currentLine = 0
          }

          if (linesRendered > 0) {
            terminal.write(ansi.cursor.up(linesRendered))
          }

          const endLine = Math.min(currentLine + displayRows, lines.length)
          linesRendered = 0
          
          for (let i = currentLine; i < endLine; i++) {
            terminal.write(ansi.erase.inLine(2))
            const line = lines[i] || ''
            terminal.write(line)
            linesRendered++
            if (i < endLine - 1) {
              terminal.write('\n')
            }
          }

          for (let i = endLine - currentLine; i < displayRows; i++) {
            terminal.write('\n')
            terminal.write(ansi.erase.inLine(2))
            linesRendered++
          }

          const percentage = lines.length > 0 ? Math.round(((endLine / lines.length) * 100)) : 100
          const statusLine = `-- ${currentLine + 1}-${endLine} / ${lines.length} (${percentage}%)`
          terminal.write('\n')
          terminal.write(ansi.erase.inLine(2))
          terminal.write(statusLine)
          linesRendered++
        }

        render()

        await new Promise<void>((resolve) => {
          keyListener = terminal.onKey(async ({ domEvent }) => {
            const keyName = domEvent.key

            switch (keyName) {
              case 'q':
              case 'Q':
              case 'Escape':
                if (keyListener) {
                  keyListener.dispose()
                  keyListener = null
                }
                terminal.write(ansi.cursor.show)
                terminal.write('\n')
                terminal.listen()
                resolve()
                return
              case 'ArrowUp':
                if (currentLine > 0) {
                  currentLine--
                  render()
                }
                break
              case 'ArrowDown':
              case 'Enter':
                currentLine++
                render()
                break
              case 'PageDown':
              case ' ':
                currentLine = Math.min(currentLine + displayRows, Math.max(0, lines.length - displayRows))
                render()
                break
              case 'PageUp':
              case 'b':
              case 'B':
                currentLine = Math.max(0, currentLine - displayRows)
                render()
                break
              case 'Home':
              case 'g':
                currentLine = 0
                render()
                break
              case 'End':
              case 'G':
                currentLine = Math.max(0, lines.length - displayRows)
                render()
                break
            }
          })
        })

        return 0
      } catch (error) {
        if (keyListener) {
          (keyListener as IDisposable).dispose()
        }
        terminal.write(ansi.cursor.show)
        terminal.write('\n')
        terminal.listen()
        await writelnStderr(process, terminal, `less: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      }
    }
  })
}
