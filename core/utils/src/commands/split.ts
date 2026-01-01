import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'split',
    description: 'Split a file into pieces',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'lines', type: Number, alias: 'l', description: 'Put NUMBER lines per output file' },
      { name: 'bytes', type: Number, alias: 'b', description: 'Put NUMBER bytes per output file' },
      { name: 'prefix', type: String, description: 'Use PREFIX for output file names', defaultValue: 'x' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file to split' }
    ],
    run: async (argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => {
      if (!process) return 1

      let file = (argv.path as string) || ''
      let lines = argv.lines as number | undefined
      let bytes = argv.bytes as number | undefined
      let prefix = (argv.prefix as string) || 'x'

      if (rawArgv) {
        for (let i = 0; i < rawArgv.length; i++) {
          const arg = rawArgv[i]
          if (!arg) continue
          
          if (arg === '-l' && i + 1 < rawArgv.length) {
            const nextArg = rawArgv[++i]
            if (nextArg !== undefined) {
              lines = parseInt(nextArg, 10)
            }
          } else if (arg.startsWith('-l')) {
            lines = parseInt(arg.slice(2), 10)
          } else if (arg === '-b' && i + 1 < rawArgv.length) {
            const nextArg = rawArgv[++i]
            if (nextArg !== undefined) {
              bytes = parseInt(nextArg, 10)
            }
          } else if (arg.startsWith('-b')) {
            bytes = parseInt(arg.slice(2), 10)
          } else if (!arg.startsWith('-')) {
            if (!file) {
              file = arg
            }
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
