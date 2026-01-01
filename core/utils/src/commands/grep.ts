import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: grep [OPTION]... PATTERN [FILE]...
Search for PATTERN in each FILE.

  -i, --ignore-case   ignore case distinctions
  -n, --line-number   print line number with output lines
  --help              display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'grep',
    description: 'Search for patterns in files or standard input',
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

      let ignoreCase = false
      let showLineNumbers = false
      const args: string[] = []

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-i' || arg === '--ignore-case') {
          ignoreCase = true
        } else if (arg === '-n' || arg === '--line-number') {
          showLineNumbers = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('i')) ignoreCase = true
          if (flags.includes('n')) showLineNumbers = true
          const invalidFlags = flags.filter(f => !['i', 'n'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `grep: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        } else {
          args.push(arg)
        }
      }

      if (args.length === 0 || !args[0]) {
        await writelnStderr(process, terminal, 'grep: pattern is required')
        return 1
      }

      const pattern = args[0]
      const files = args.slice(1)

      const flags = ignoreCase ? 'i' : ''
      let regex: RegExp
      try {
        regex = new RegExp(pattern, flags)
      } catch (error) {
        await writelnStderr(process, terminal, `grep: invalid pattern: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      }

      const writer = process.stdout.getWriter()
      let exitCode = 0

      try {
        if (files.length === 0) {
          if (!process.stdin) {
            await writelnStderr(process, terminal, 'grep: No input provided')
            return 1
          }

          const reader = process.stdin.getReader()
          let currentLineNumber = 1
          let buffer = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = new TextDecoder().decode(value, { stream: true })
              buffer += chunk

              const lines = buffer.split('\n')
              buffer = lines.pop() || ''

              for (const line of lines) {
                if (regex.test(line)) {
                  const output = showLineNumbers ? `${currentLineNumber}:${line}\n` : `${line}\n`
                  await writer.write(new TextEncoder().encode(output))
                }
                currentLineNumber++
              }
            }

            if (buffer && regex.test(buffer)) {
              const output = showLineNumbers ? `${currentLineNumber}:${buffer}\n` : `${buffer}\n`
              await writer.write(new TextEncoder().encode(output))
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
                await writelnStderr(process, terminal, `grep: ${file}: cannot search device files`)
                exitCode = 1
                continue
              }

              const handle = await shell.context.fs.promises.open(fullPath, 'r')
              const stat = await shell.context.fs.promises.stat(fullPath)

              let bytesRead = 0
              const chunkSize = 1024
              let buffer = ''
              let currentLineNumber = 1

              while (bytesRead < stat.size) {
                if (interrupted) break
                const data = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - bytesRead)
                await handle.read(data, 0, readSize, bytesRead)
                const chunk = data.subarray(0, readSize)
                const text = new TextDecoder().decode(chunk, { stream: true })
                buffer += text

                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                  if (regex.test(line)) {
                    const prefix = files.length > 1 ? `${file}:` : ''
                    const lineNumPrefix = showLineNumbers ? `${currentLineNumber}:` : ''
                    const output = `${prefix}${lineNumPrefix}${line}\n`
                    await writer.write(new TextEncoder().encode(output))
                  }
                  currentLineNumber++
                }

                bytesRead += readSize
              }

              if (buffer && regex.test(buffer)) {
                const prefix = files.length > 1 ? `${file}:` : ''
                const lineNumPrefix = showLineNumbers ? `${currentLineNumber}:` : ''
                const output = `${prefix}${lineNumPrefix}${buffer}\n`
                await writer.write(new TextEncoder().encode(output))
              }
            } catch (error) {
              await writelnStderr(process, terminal, `grep: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
              exitCode = 1
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        return exitCode
      } finally {
        writer.releaseLock()
      }
    }
  })
}
