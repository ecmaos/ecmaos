import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: shuf [OPTION]... [FILE]
Write a random permutation of the input lines to standard output.

  -n, --head-count=COUNT    output at most COUNT lines
  -e, --echo                treat each ARG as an input line
  -i, --input-range=LO-HI   treat each number LO through HI as an input line
  --help                    display this help and exit`
  writelnStderr(process, terminal, usage)
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'shuf',
    description: 'Write a random permutation of the input lines',
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

      let headCount: number | null = null
      let echo = false
      let inputRange: string | undefined
      const files: string[] = []
      const echoArgs: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-n' || arg === '--head-count') {
          if (i + 1 < argv.length) {
            const countStr = argv[++i]
            if (countStr !== undefined) {
              const parsed = parseInt(countStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                headCount = parsed
              } else {
                await writelnStderr(process, terminal, `shuf: invalid line count: ${countStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--head-count=')) {
          const countStr = arg.slice(13)
          const parsed = parseInt(countStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            headCount = parsed
          } else {
            await writelnStderr(process, terminal, `shuf: invalid line count: ${countStr}`)
            return 1
          }
        } else if (arg.startsWith('-n')) {
          const countStr = arg.slice(2)
          if (countStr) {
            const parsed = parseInt(countStr, 10)
            if (!isNaN(parsed) && parsed > 0) {
              headCount = parsed
            } else {
              await writelnStderr(process, terminal, `shuf: invalid line count: ${countStr}`)
              return 1
            }
          }
        } else if (arg === '-e' || arg === '--echo') {
          echo = true
        } else if (arg === '-i' || arg === '--input-range') {
          if (i + 1 < argv.length) {
            inputRange = argv[++i]
          }
        } else if (arg.startsWith('--input-range=')) {
          inputRange = arg.slice(15)
        } else if (arg.startsWith('-i')) {
          inputRange = arg.slice(2)
        } else if (!arg.startsWith('-')) {
          if (echo) {
            echoArgs.push(arg)
          } else {
            files.push(arg)
          }
        } else {
          await writelnStderr(process, terminal, `shuf: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'shuf --help' for more information.")
          return 1
        }
      }

      const writer = process.stdout.getWriter()

      try {
        let lines: string[] = []

        if (inputRange) {
          const [loStr, hiStr] = inputRange.split('-')
          const lo = parseInt(loStr ?? '0', 10)
          const hi = parseInt(hiStr ?? '0', 10)
          if (isNaN(lo) || isNaN(hi) || lo > hi) {
            await writelnStderr(process, terminal, `shuf: invalid input range: ${inputRange}`)
            return 1
          }
          for (let i = lo; i <= hi; i++) {
            lines.push(i.toString())
          }
        } else if (echo && echoArgs.length > 0) {
          lines = echoArgs
        } else if (files.length === 0) {
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
                await writelnStderr(process, terminal, `shuf: ${file}: cannot process device files`)
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
              await writelnStderr(process, terminal, `shuf: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        const shuffled = shuffleArray(lines)
        const output = headCount !== null ? shuffled.slice(0, headCount) : shuffled

        for (const line of output) {
          await writer.write(new TextEncoder().encode(line + '\n'))
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `shuf: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
