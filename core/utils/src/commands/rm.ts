import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: rm [OPTION]... FILE...
Remove (unlink) the FILE(s).

  -f, --force     ignore nonexistent files and arguments, never prompt
  -r, -R, --recursive   remove directories and their contents recursively
  --help          display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'rm',
    description: 'Remove files or directories',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length === 0) {
        await writelnStderr(process, terminal, 'rm: missing operand')
        await writelnStderr(process, terminal, "Try 'rm --help' for more information.")
        return 1
      }

      if (argv[0] === '--help' || argv[0] === '-h') {
        printUsage(process, terminal)
        return 0
      }

      let recursive = false
      let force = false
      const pathArray: string[] = []
      
      for (const arg of argv) {
        if (arg.startsWith('-') && arg !== '--') {
          // Handle combined flags like -rf, -fr, -rR, etc.
          if (arg === '--recursive' || arg === '-R') {
            recursive = true
          } else if (arg === '--force') {
            force = true
          } else if (arg.length > 1) {
            // Parse individual flags in combined options like -rf
            for (let i = 1; i < arg.length; i++) {
              const flag = arg[i]
              if (flag === 'r' || flag === 'R') {
                recursive = true
              } else if (flag === 'f') {
                force = true
              } else {
                await writelnStderr(process, terminal, `rm: invalid option -- '${flag}'`)
                await writelnStderr(process, terminal, "Try 'rm --help' for more information.")
                return 1
              }
            }
          } else {
            await writelnStderr(process, terminal, `rm: invalid option -- '${arg.slice(1)}'`)
            await writelnStderr(process, terminal, "Try 'rm --help' for more information.")
            return 1
          }
        } else {
          pathArray.push(arg)
        }
      }

      if (pathArray.length === 0) {
        await writelnStderr(process, terminal, 'rm: missing operand')
        await writelnStderr(process, terminal, "Try 'rm --help' for more information.")
        return 1
      }

      const expandGlob = async (pattern: string): Promise<string[]> => {
        if (!pattern.includes('*') && !pattern.includes('?')) {
          return [pattern]
        }

        const lastSlashIndex = pattern.lastIndexOf('/')
        const searchDir = lastSlashIndex !== -1
          ? path.resolve(shell.cwd, pattern.substring(0, lastSlashIndex + 1))
          : shell.cwd
        const globPattern = lastSlashIndex !== -1
          ? pattern.substring(lastSlashIndex + 1)
          : pattern

        try {
          const entries = await shell.context.fs.promises.readdir(searchDir)
          const regexPattern = globPattern
            .replace(/\./g, '\\.')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.')
          const regex = new RegExp(`^${regexPattern}$`)
          
          const matches = entries.filter(entry => regex.test(entry))
          
          if (lastSlashIndex !== -1) {
            const dirPart = pattern.substring(0, lastSlashIndex + 1)
            return matches.map(match => dirPart + match)
          }
          return matches
        } catch (error) {
          return []
        }
      }

      const expandedPaths: string[] = []
      for (const pattern of pathArray) {
        const expanded = await expandGlob(pattern)
        if (expanded.length === 0) {
          expandedPaths.push(pattern)
        } else {
          expandedPaths.push(...expanded)
        }
      }

      if (expandedPaths.length === 0) {
        await writelnStderr(process, terminal, 'rm: missing operand')
        await writelnStderr(process, terminal, "Try 'rm --help' for more information.")
        return 1
      }

      let hasError = false

      for (const target of expandedPaths) {
        if (!target || typeof target !== 'string') {
          if (!force) {
            await writelnStderr(process, terminal, `rm: ${String(target)}: No such file or directory`)
            hasError = true
          }
          continue
        }

        const fullPath = path.resolve(shell.cwd, target)

        try {
          // Check if it's a directory to validate recursive flag requirement
          try {
            const stat = await shell.context.fs.promises.stat(fullPath)
            if (stat.isDirectory() && !recursive) {
              await writelnStderr(process, terminal, `rm: ${target}: is a directory`)
              hasError = true
              continue
            }
          } catch (statError) {
            // If stat fails, the file might not exist
            // If force is enabled, we'll try to remove it anyway (rm will handle it)
            // If force is not enabled, we'll let rm handle the error
          }

          // Use fs.promises.rm with appropriate options
          await shell.context.fs.promises.rm(fullPath, {
            recursive: recursive,
            force: force
          })
        } catch (error) {
          // If force is enabled, ignore errors
          if (!force) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            await writelnStderr(process, terminal, `rm: ${target}: ${errorMessage}`)
            hasError = true
          }
        }
      }

      return hasError ? 1 : 0
    }
  })
}
