// TODO: Custom usage output after arg parsing is less rigid for coreutils

import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'find',
    description: 'Search for files in a directory hierarchy',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, alias: 'h', description: kernel.i18n.t('Display help') }
    ],
    run: async (_argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => {
      if (!process) return 1

      if (!rawArgv || rawArgv.length === 0) {
        await writelnStderr(process, terminal, 'find: missing path argument')
        return 1
      }

      let startPaths: string[] = []
      let namePattern: string | undefined
      let fileType: string | undefined

      for (let i = 0; i < rawArgv.length; i++) {
        const arg = rawArgv[i]
        if (arg === undefined) continue
        
        if (arg === '-name' && i + 1 < rawArgv.length) {
          const nextArg = rawArgv[++i]
          if (nextArg !== undefined) {
            namePattern = nextArg
          }
        } else if (arg === '-type' && i + 1 < rawArgv.length) {
          const nextArg = rawArgv[++i]
          if (nextArg !== undefined) {
            fileType = nextArg
          }
        } else if (!arg.startsWith('-')) {
          startPaths.push(arg)
        }
      }

      if (startPaths.length === 0) {
        startPaths = [shell.cwd]
      }

      const writer = process.stdout.getWriter()

      const matchesPattern = (filename: string, pattern: string): boolean => {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
        const regex = new RegExp(`^${regexPattern}$`)
        return regex.test(filename)
      }

      const searchDirectory = async (dirPath: string): Promise<void> => {
        let interrupted = false
        const interruptHandler = () => { interrupted = true }
        kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

        try {
          if (interrupted) return

          const entries = await shell.context.fs.promises.readdir(dirPath)

          for (const entry of entries) {
            if (interrupted) break

            const fullPath = path.join(dirPath, entry)

            try {
              const stat = await shell.context.fs.promises.stat(fullPath)

              let matches = true

              if (namePattern) {
                const matchesName = matchesPattern(entry, namePattern)
                if (!matchesName) {
                  matches = false
                }
              }

              if (fileType && matches) {
                if (fileType === 'f' && !stat.isFile()) matches = false
                else if (fileType === 'd' && !stat.isDirectory()) matches = false
                else if (fileType === 'l' && !stat.isSymbolicLink()) matches = false
              }

              if (matches) {
                await writer.write(new TextEncoder().encode(fullPath + '\n'))
              }

              if (stat.isDirectory() && !stat.isSymbolicLink()) {
                await searchDirectory(fullPath)
              }
            } catch {
            }
          }
        } catch {
        } finally {
          kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
        }
      }

      try {
        for (const startPath of startPaths) {
          const fullPath = path.resolve(shell.cwd, startPath)

          try {
            const stat = await shell.context.fs.promises.stat(fullPath)
            if (!stat.isDirectory()) {
              await writelnStderr(process, terminal, `find: ${startPath}: not a directory`)
              continue
            }

            await searchDirectory(fullPath)
          } catch (error) {
            await writelnStderr(process, terminal, `find: ${startPath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
