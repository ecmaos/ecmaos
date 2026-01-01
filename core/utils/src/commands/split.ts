import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: split [OPTION]... [INPUT [PREFIX]]
Split INPUT into fixed-size pieces.

  -l, -lNUMBER        put NUMBER lines per output file
  -b, -bSIZE            put SIZE bytes per output file
  --help                 display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'split',
    description: 'Split a file into pieces',
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

      let file = ''
      let lines: number | undefined
      let bytes: number | undefined
      let prefix = 'x'

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-l' || arg.startsWith('-l')) {
          if (arg === '-l' && i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined) {
              lines = parseInt(nextArg, 10)
            }
          } else if (arg.startsWith('-l') && arg.length > 2) {
            lines = parseInt(arg.slice(2), 10)
          }
        } else if (arg === '-b' || arg.startsWith('-b')) {
          if (arg === '-b' && i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined) {
              bytes = parseInt(nextArg, 10)
            }
          } else if (arg.startsWith('-b') && arg.length > 2) {
            bytes = parseInt(arg.slice(2), 10)
          }
        } else if (!arg.startsWith('-')) {
          if (!file) {
            file = arg
          } else if (prefix === 'x') {
            prefix = arg
          }
        }
      }

      if (!file) {
        await writelnStderr(process, terminal, 'split: missing file operand')
        return 1
      }

      if (!lines && !bytes) {
        await writelnStderr(process, terminal, 'split: you must specify -l or -b')
        return 1
      }

      const fullPath = path.resolve(shell.cwd, file)

      let interrupted = false
      const interruptHandler = () => { interrupted = true }
      kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

      try {
        if (fullPath.startsWith('/dev')) {
          await writelnStderr(process, terminal, `split: ${file}: cannot split device files`)
          return 1
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

        const dir = path.dirname(fullPath)
        let fileIndex = 0

        const getSuffix = (index: number): string => {
          const first = Math.floor(index / 26)
          const second = index % 26
          return String.fromCharCode(97 + first) + String.fromCharCode(97 + second)
        }

        if (lines) {
          const allLines = content.split('\n')
          for (let i = 0; i < allLines.length; i += lines) {
            const chunk = allLines.slice(i, i + lines).join('\n')
            const suffix = getSuffix(fileIndex)
            const outputPath = path.join(dir, `${prefix}${suffix}`)
            await shell.context.fs.promises.writeFile(outputPath, chunk, 'utf-8')
            fileIndex++
          }
        } else if (bytes) {
          const encoder = new TextEncoder()
          const contentBytes = encoder.encode(content)
          for (let i = 0; i < contentBytes.length; i += bytes) {
            const chunk = contentBytes.slice(i, i + bytes)
            const suffix = getSuffix(fileIndex)
            const outputPath = path.join(dir, `${prefix}${suffix}`)
            await shell.context.fs.promises.writeFile(outputPath, chunk)
            fileIndex++
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `split: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      }
    }
  })
}
