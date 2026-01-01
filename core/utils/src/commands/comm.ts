import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'comm',
    description: 'Compare two sorted files line by line',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'check', type: Boolean, description: 'Check that the input is correctly sorted' },
      { name: 'suppress-1', type: Boolean, description: 'Suppress lines unique to FILE1' },
      { name: 'suppress-2', type: Boolean, description: 'Suppress lines unique to FILE2' },
      { name: 'suppress-3', type: Boolean, description: 'Suppress lines that appear in both files' },
      { name: 'files', type: String, defaultOption: true, multiple: true, description: 'FILE1 FILE2' }
    ],
    run: async (argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => {
      if (!process) return 1

      let files = (argv.files as string[]) || []
      let suppress1 = (argv['suppress-1'] as boolean) || false
      let suppress2 = (argv['suppress-2'] as boolean) || false
      let suppress3 = (argv['suppress-3'] as boolean) || false

      if (rawArgv) {
        for (let i = 0; i < rawArgv.length; i++) {
          const arg = rawArgv[i]
          if (!arg) continue
          
          if (arg === '-1') {
            suppress1 = true
          } else if (arg === '-2') {
            suppress2 = true
          } else if (arg === '-3') {
            suppress3 = true
          } else if (!arg.startsWith('-')) {
            if (files.length < 2) {
              files.push(arg)
            }
          }
        }
      }

      if (files.length !== 2) {
        await writelnStderr(process, terminal, 'comm: exactly two files must be specified')
        return 1
      }

      const file1 = files[0]
      const file2 = files[1]

      const writer = process.stdout.getWriter()

      const readFileLines = async (filePath: string): Promise<string[]> => {
        if (filePath.startsWith('/dev')) {
          throw new Error('cannot comm device files')
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
        const fullPath1 = path.resolve(shell.cwd, file1)
        const fullPath2 = path.resolve(shell.cwd, file2)

        const lines1 = await readFileLines(fullPath1)
        const lines2 = await readFileLines(fullPath2)

        let i = 0
        let j = 0

        while (i < lines1.length || j < lines2.length) {
          if (i >= lines1.length) {
            if (!suppress2) {
              const prefix = suppress1 ? '' : '\t'
              await writer.write(new TextEncoder().encode(prefix + lines2[j] + '\n'))
            }
            j++
          } else if (j >= lines2.length) {
            if (!suppress1) {
              await writer.write(new TextEncoder().encode(lines1[i] + '\n'))
            }
            i++
          } else {
            const cmp = lines1[i].localeCompare(lines2[j])
            if (cmp < 0) {
              if (!suppress1) {
                await writer.write(new TextEncoder().encode(lines1[i] + '\n'))
              }
              i++
            } else if (cmp > 0) {
              if (!suppress2) {
                const prefix = suppress1 ? '' : '\t'
                await writer.write(new TextEncoder().encode(prefix + lines2[j] + '\n'))
              }
              j++
            } else {
              if (!suppress3) {
                const prefix = suppress1 && suppress2 ? '' : suppress1 ? '\t' : suppress2 ? '' : '\t\t'
                await writer.write(new TextEncoder().encode(prefix + lines1[i] + '\n'))
              }
              i++
              j++
            }
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `comm: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
