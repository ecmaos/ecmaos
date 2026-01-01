import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: wc [OPTION]... [FILE]...
Print newline, word, and byte counts for each FILE.

  -c, --bytes     print the byte counts
  -l, --lines     print the newline counts
  -w, --words     print the word counts
  --help          display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'wc',
    description: 'Print newline, word, and byte counts for each file',
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
      let showBytes = false
      let showLines = false
      let showWords = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-c' || arg === '--bytes') {
          showBytes = true
        } else if (arg === '-l' || arg === '--lines') {
          showLines = true
        } else if (arg === '-w' || arg === '--words') {
          showWords = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('c')) showBytes = true
          if (flags.includes('l')) showLines = true
          if (flags.includes('w')) showWords = true
          const invalidFlags = flags.filter(f => !['c', 'l', 'w'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `wc: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        } else {
          files.push(arg)
        }
      }

      const showAll = !showBytes && !showLines && !showWords

      const writer = process.stdout.getWriter()

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

          const lines = content.split('\n').length - (content.endsWith('\n') ? 0 : 1)
          const words = content.trim().split(/\s+/).filter(w => w.length > 0).length
          const bytes = new TextEncoder().encode(content).length

          let output = ''
          if (showAll || showLines) output += `${lines} `
          if (showAll || showWords) output += `${words} `
          if (showAll || showBytes) output += `${bytes} `
          output = output.trim()

          await writer.write(new TextEncoder().encode(output + '\n'))
          return 0
        }

        let totalLines = 0
        let totalWords = 0
        let totalBytes = 0
        const results: Array<{ lines: number, words: number, bytes: number, file: string }> = []

        for (const file of files) {
          const fullPath = path.resolve(shell.cwd, file)

          let interrupted = false
          const interruptHandler = () => { interrupted = true }
          kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

          try {
            if (fullPath.startsWith('/dev')) {
              await writelnStderr(process, terminal, `wc: ${file}: cannot count device files`)
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

            const lines = content.split('\n').length - (content.endsWith('\n') ? 0 : 1)
            const words = content.trim().split(/\s+/).filter(w => w.length > 0).length
            const bytes = new TextEncoder().encode(content).length

            totalLines += lines
            totalWords += words
            totalBytes += bytes

            results.push({ lines, words, bytes, file })
          } catch (error) {
            await writelnStderr(process, terminal, `wc: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          } finally {
            kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
          }
        }

        for (const result of results) {
          let output = ''
          if (showAll || showLines) output += `${result.lines} `
          if (showAll || showWords) output += `${result.words} `
          if (showAll || showBytes) output += `${result.bytes} `
          output += result.file
          await writer.write(new TextEncoder().encode(output + '\n'))
        }

        if (files.length > 1) {
          let output = ''
          if (showAll || showLines) output += `${totalLines} `
          if (showAll || showWords) output += `${totalWords} `
          if (showAll || showBytes) output += `${totalBytes} `
          output += 'total'
          await writer.write(new TextEncoder().encode(output + '\n'))
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
