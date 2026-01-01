import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: find [PATH]... [OPTION]...
Search for files in a directory hierarchy.

  -name PATTERN  file name matches shell pattern PATTERN
  -type TYPE     file is of type TYPE (f=file, d=directory, l=symlink)
  --help         display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'find',
    description: 'Search for files in a directory hierarchy',
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

      if (argv.length === 0) {
        await writelnStderr(process, terminal, 'find: missing path argument')
        return 1
      }

      let startPaths: string[] = []
      let namePattern: string | undefined
      let fileType: string | undefined

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) continue
        
        if (arg === '-name') {
          if (i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined && typeof nextArg === 'string' && !nextArg.startsWith('-')) {
              namePattern = nextArg
            } else {
              await writelnStderr(process, terminal, 'find: missing argument to -name')
              return 1
            }
          } else {
            await writelnStderr(process, terminal, 'find: missing argument to -name')
            return 1
          }
        } else if (arg === '-type') {
          if (i + 1 < argv.length) {
            i++
            const nextArg = argv[i]
            if (nextArg !== undefined && typeof nextArg === 'string' && !nextArg.startsWith('-')) {
              fileType = nextArg
            } else {
              await writelnStderr(process, terminal, 'find: missing argument to -type')
              return 1
            }
          } else {
            await writelnStderr(process, terminal, 'find: missing argument to -type')
            return 1
          }
        } else if (typeof arg === 'string' && !arg.startsWith('-')) {
          startPaths.push(arg)
        }
      }

      if (startPaths.length === 0) {
        startPaths = [shell.cwd]
      }

      const writer = process.stdout.getWriter()

      const matchesPattern = (filename: string, pattern: string): boolean => {
        if (!pattern) return false
        
        let regexPattern = ''
        for (let i = 0; i < pattern.length; i++) {
          const char = pattern[i]
          if (char === undefined) continue
          if (char === '*') {
            regexPattern += '.*'
          } else if (char === '?') {
            regexPattern += '.'
          } else if (char === '.') {
            regexPattern += '\\.'
          } else {
            const needsEscaping = /[+^${}()|[\]\\]/.test(char)
            regexPattern += needsEscaping ? '\\' + char : char
          }
        }
        try {
          const regex = new RegExp(`^${regexPattern}$`)
          return regex.test(filename)
        } catch {
          return false
        }
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
