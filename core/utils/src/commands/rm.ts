import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: rm [OPTION]... FILE...
Remove (unlink) the FILE(s).

  --help  display this help and exit`
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

      const pathArray: string[] = []
      for (const arg of argv) {
        if (arg.startsWith('-') && arg !== '--') {
          if (arg !== '-f' && arg !== '-r' && arg !== '-rf' && arg !== '-fr') {
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
          await writelnStderr(process, terminal, `rm: ${String(target)}: No such file or directory`)
          hasError = true
          continue
        }

        const fullPath = path.resolve(shell.cwd, target)

        try {
          const stat = await shell.context.fs.promises.stat(fullPath)
          if (stat.isDirectory()) {
            await shell.context.fs.promises.rmdir(fullPath)
          } else {
            await shell.context.fs.promises.unlink(fullPath)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          await writelnStderr(process, terminal, `rm: ${target}: ${errorMessage}`)
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
