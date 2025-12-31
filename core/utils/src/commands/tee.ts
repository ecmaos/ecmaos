import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tee',
    description: 'Read from standard input and write to standard output and files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'append', type: Boolean, alias: 'a', description: 'Append to the given files, do not overwrite' },
      { name: 'ignore-interrupts', type: Boolean, alias: 'i', description: 'Ignore interrupt signals' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'File(s) to write to' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      if (!process.stdin) {
        await writelnStderr(process, terminal, 'tee: No input provided')
        return 1
      }

      const files = (argv.path as string[]) || []
      const append = (argv.append as boolean) || false
      const ignoreInterrupts = (argv['ignore-interrupts'] as boolean) || false

      const writer = process.stdout.getWriter()

      try {
        const filePaths: Array<{ path: string; fullPath: string }> = []
        for (const file of files) {
          const expandedPath = shell.expandTilde(file)
          const fullPath = path.resolve(shell.cwd, expandedPath)

          if (!append) {
            try {
              await shell.context.fs.promises.writeFile(fullPath, '')
            } catch (error) {
              await writelnStderr(process, terminal, `tee: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
              return 1
            }
          }

          filePaths.push({ path: file, fullPath })
        }

        const reader = process.stdin.getReader()
        let interrupted = false

        const interruptHandler = () => { interrupted = true }
        if (!ignoreInterrupts) {
          kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)
        }

        try {
          while (true) {
            if (interrupted) break
            const { done, value } = await reader.read()
            if (done) break

            await writer.write(value)

            for (const fileInfo of filePaths) {
              try {
                await shell.context.fs.promises.appendFile(fileInfo.fullPath, value)
              } catch (error) {
                await writelnStderr(process, terminal, `tee: ${fileInfo.path}: ${error instanceof Error ? error.message : 'Write error'}`)
              }
            }
          }
        } finally {
          reader.releaseLock()
          if (!ignoreInterrupts) {
            kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `tee: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
