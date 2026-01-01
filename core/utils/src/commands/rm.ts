import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'rm',
    description: 'Remove files or directories',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) or directory(ies) to remove' }
    ],
    run: async (argv: CommandLineOptions, process?: Process, rawArgv?: string[]) => {
      let pathArray: string[] = []

      if (rawArgv && rawArgv.length > 0) {
        pathArray = rawArgv
          .map(arg => {
            if (typeof arg === 'string') return arg
            if (typeof arg === 'object' && arg !== null) {
              const obj = arg as Record<string, unknown>
              if ('pattern' in obj && typeof obj.pattern === 'string') return obj.pattern
              if ('path' in obj && typeof obj.path === 'string') return obj.path
              if ('value' in obj && typeof obj.value === 'string') return obj.value
              if ('_unknown' in obj && Array.isArray(obj._unknown)) {
                return obj._unknown.filter((a: unknown) => typeof a === 'string').join(' ')
              }
              const entries = Object.entries(obj).filter(([k, v]) => k !== 'op' && typeof v === 'string' && !v.startsWith('-'))
              if (entries.length > 0 && entries[0]) {
                const value = entries[0][1]
                return typeof value === 'string' ? value : null
              }
              return null
            }
            return null
          })
          .filter((arg): arg is string => typeof arg === 'string' && arg.length > 0 && !arg.startsWith('-'))
      } else {
        const paths = argv.path
        if (paths) {
          pathArray = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : (typeof paths === 'string' ? [paths] : [])
        }
      }

      if (pathArray.length === 0) {
        await writelnStderr(process, terminal, 'rm: missing operand')
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

