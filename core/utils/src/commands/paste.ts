import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: paste [OPTION]... [FILE]...
Merge lines of files.

  -d, --delimiters=LIST  reuse characters from LIST instead of TABs
  -s, --serial           paste one file at a time instead of in parallel
  --help                 display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'paste',
    description: 'Merge lines of files',
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
      let delimiters = '\t'
      let serial = false

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-d' || arg === '--delimiters') {
          if (i + 1 < argv.length) {
            delimiters = argv[++i] || '\t'
          }
        } else if (arg.startsWith('--delimiters=')) {
          delimiters = arg.slice(13)
        } else if (arg.startsWith('-d')) {
          delimiters = arg.slice(2) || '\t'
        } else if (arg === '-s' || arg === '--serial') {
          serial = true
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        }
      }

      const writer = process.stdout.getWriter()

      const readFileLines = async (filePath: string): Promise<string[]> => {
        if (filePath.startsWith('/dev')) {
          throw new Error('cannot paste device files')
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
        if (files.length === 0) {
          if (!process.stdin) {
            return 0
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          let content = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) {
                content += decoder.decode(value, { stream: true })
              }
            }
          } finally {
            reader.releaseLock()
          }

          const lines = content.split('\n')
          if (lines[lines.length - 1] === '') {
            lines.pop()
          }

          for (const line of lines) {
            await writer.write(new TextEncoder().encode(line + '\n'))
          }

          return 0
        }

        const fileLines: string[][] = []

        for (const file of files) {
          const fullPath = path.resolve(shell.cwd, file)
          try {
            const lines = await readFileLines(fullPath)
            fileLines.push(lines)
          } catch (error) {
            await writelnStderr(process, terminal, `paste: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            return 1
          }
        }

        if (serial) {
          for (const file of fileLines) {
            for (const line of file) {
              await writer.write(new TextEncoder().encode(line + '\n'))
            }
          }
        } else {
          const maxLines = Math.max(...fileLines.map(f => f.length))
          const delimiter = delimiters[0] || '\t'

          for (let i = 0; i < maxLines; i++) {
            const parts: string[] = []
            for (const file of fileLines) {
              parts.push(file[i] || '')
            }
            await writer.write(new TextEncoder().encode(parts.join(delimiter) + '\n'))
          }
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
