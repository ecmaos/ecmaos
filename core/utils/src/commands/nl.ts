import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: nl [OPTION]... [FILE]...
Number lines of files.

  -v, --starting-line=NUMBER  first line number for each section (default: 1)
  -i, --increment=NUMBER      line number increment at each line (default: 1)
  -n, --format=FORMAT         line number format: ln, rn, rz (default: rn)
  -w, --width=NUMBER          use NUMBER columns for line numbers (default: 6)
  -s, --separator=STRING      add STRING after (possible) line number (default: TAB)
  --help                      display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'nl',
    description: 'Number lines of files',
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

      const files: string[] = []
      let startLine = 1
      let increment = 1
      let format = 'rn'
      let width = 6
      let separator = '\t'

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-v' || arg === '--starting-line') {
          if (i + 1 < argv.length) {
            const num = parseInt(argv[++i], 10)
            if (!isNaN(num)) startLine = num
          }
        } else if (arg.startsWith('--starting-line=')) {
          const num = parseInt(arg.slice(16), 10)
          if (!isNaN(num)) startLine = num
        } else if (arg === '-i' || arg === '--increment') {
          if (i + 1 < argv.length) {
            const num = parseInt(argv[++i], 10)
            if (!isNaN(num)) increment = num
          }
        } else if (arg.startsWith('--increment=')) {
          const num = parseInt(arg.slice(12), 10)
          if (!isNaN(num)) increment = num
        } else if (arg === '-n' || arg === '--format') {
          if (i + 1 < argv.length) {
            format = argv[++i] || 'rn'
          }
        } else if (arg.startsWith('--format=')) {
          format = arg.slice(9) || 'rn'
        } else if (arg === '-w' || arg === '--width') {
          if (i + 1 < argv.length) {
            const num = parseInt(argv[++i], 10)
            if (!isNaN(num)) width = num
          }
        } else if (arg.startsWith('--width=')) {
          const num = parseInt(arg.slice(8), 10)
          if (!isNaN(num)) width = num
        } else if (arg === '-s' || arg === '--separator') {
          if (i + 1 < argv.length) {
            separator = argv[++i] || '\t'
          }
        } else if (arg.startsWith('--separator=')) {
          separator = arg.slice(12) || '\t'
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        }
      }

      const writer = process.stdout.getWriter()

      const formatNumber = (num: number): string => {
        const numStr = num.toString()
        if (format === 'rz') {
          return numStr.padStart(width, '0')
        } else if (format === 'ln') {
          return numStr.padEnd(width, ' ')
        } else {
          return numStr.padStart(width, ' ')
        }
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
                await writelnStderr(process, terminal, `nl: ${file}: cannot number device files`)
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
              await writelnStderr(process, terminal, `nl: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        let lineNumber = startLine
        for (const line of lines) {
          const formattedNum = formatNumber(lineNumber)
          await writer.write(new TextEncoder().encode(`${formattedNum}${separator}${line}\n`))
          lineNumber += increment
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
