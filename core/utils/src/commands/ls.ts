import path from 'path'
import chalk from 'chalk'
import humanFormat from 'human-format'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { Stats } from '@zenfs/core'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'ls',
    description: 'List directory contents',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to list' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const target = (argv.path as string) || shell.cwd
      const fullPath = target ? path.resolve(shell.cwd, target === '' ? '.' : target) : shell.cwd
      const stats = await shell.context.fs.promises.stat(fullPath)
      const entries: string[] = stats.isDirectory() ? await shell.context.fs.promises.readdir(fullPath) : [fullPath]
      const descriptions = kernel.filesystem.descriptions(kernel.i18n.t)

      const getModeType = (stats: Stats) => {
        let type = '-'
        if (stats.isDirectory()) type = 'd'
        else if (stats.isSymbolicLink()) type = 'l'
        else if (stats.isBlockDevice()) type = 'b'
        else if (stats.isCharacterDevice()) type = 'c'
        else if (stats.isFIFO()) type = 'p'
        else if (stats.isSocket()) type = 's'
        return type
      }

      const getModeString = (stats: Stats) => {
        return getModeType(stats) + (stats.mode & parseInt('777', 8)).toString(8).padStart(3, '0')
          .replace(/0/g, '---')
          .replace(/1/g, '--' + chalk.red('x'))
          .replace(/2/g, '-' + chalk.yellow('w') + '-')
          .replace(/3/g, '-' + chalk.yellow('w') + chalk.red('x'))
          .replace(/4/g, chalk.green('r') + '--')
          .replace(/5/g, chalk.green('r') + '-' + chalk.red('x'))
          .replace(/6/g, chalk.green('r') + chalk.yellow('w') + '-')
          .replace(/7/g, chalk.green('r') + chalk.yellow('w') + chalk.red('x'))
      }

      const getTimestampString = (timestamp: Date) => {
        const diff = (new Date().getTime() - timestamp.getTime()) / 1000

        if (diff < 24 * 60 * 60) return chalk.green(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else if (diff < 7 * 24 * 60 * 60) return chalk.yellow(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else if (diff < 30 * 24 * 60 * 60) return chalk.blue(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else if (diff < 365 * 24 * 60 * 60) return chalk.magenta(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else return chalk.gray(timestamp.toISOString().slice(0, 19).replace('T', ' '))
      }

      const getOwnerString = (stats: Stats) => {
        const owner = kernel.users.all.get(stats.uid) || kernel.users.all.get(0)

        if (owner?.username === shell.username) return chalk.green(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
        else if (stats.uid === 0) return chalk.red(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
        else return chalk.gray(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
      }

      const filesMap = await Promise.all(entries
        .map(async entry => {
          const target = path.resolve(fullPath, entry)
          try {
            return { target, name: entry, stats: await shell.context.fs.promises.stat(target) }
          } catch {
            return { target, name: entry, stats: null }
          }
        }))

      const files = filesMap
        .filter(entry => entry && entry.stats && !entry.stats.isDirectory())
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

      const directoryMap = await Promise.all(entries
        .map(async entry => {
          const target = path.resolve(fullPath, entry)
          try {
            return { target, name: entry, stats: await shell.context.fs.promises.stat(target) }
          } catch {
            return { target, name: entry, stats: null }
          }
        }))

      const directories = directoryMap
        .filter(entry => entry && entry.stats && entry.stats.isDirectory())
        .filter((entry, index, self) => self.findIndex(e => e?.name === entry?.name) === index)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

      const data = [
        ['Name', 'Size', 'Modified', 'Mode', 'Owner', 'Info'],
        ...directories.sort((a, b) => a.name.localeCompare(b.name)).map(directory => {
          return [
            directory.name,
            '',
            directory.stats ? getTimestampString(directory.stats.mtime) : '',
            directory.stats ? getModeString(directory.stats) : '',
            directory.stats ? getOwnerString(directory.stats) : '',
          ]
        }),
        ...files.sort((a, b) => a.name.localeCompare(b.name)).map(file => {
          return [
            file.name,
            file.stats ? humanFormat(file.stats.size) : '',
            file.stats ? getTimestampString(file.stats.mtime) : '',
            file.stats ? getModeString(file.stats) : '',
            file.stats ? getOwnerString(file.stats) : '',
            (() => {
              if (descriptions.has(path.resolve(fullPath, file.name))) return descriptions.get(path.resolve(fullPath, file.name))
              const ext = file.name.split('.').pop()
              if (ext && descriptions.has('.' + ext)) return descriptions.get('.' + ext)
              if (!file.stats) return ''
              if (file.stats.isBlockDevice() || file.stats.isCharacterDevice()) {
                // TODO: zenfs `fs.mounts` is deprecated - use a better way of getting device info
              }

              return ''
            })()
          ]
        })
      ] as string[][]

      // Special output for certain directories
      if (fullPath.startsWith('/dev')) data.forEach(row => row.splice(1, 2)) // remove size and modified columns

      const columnWidths = data[0]?.map((_, colIndex) => Math.max(...data.map(row => {
        // Remove ANSI escape sequences before calculating length
        const cleanedCell = row[colIndex]?.replace(/\u001b\[.*?m/g, '')
        // count all emojis as two characters
        return cleanedCell?.length || 0
      })))

      for (const [rowIndex, row] of data.entries()) {
        const line = row
          .map((cell, index) => {
            const paddedCell = cell.padEnd(columnWidths?.[index] ?? 0)
            if (index === 0 && rowIndex > 0) {
              return row[3]?.startsWith('d') ? chalk.blue(paddedCell) : chalk.green(paddedCell)
            } else return rowIndex === 0 ? chalk.bold(paddedCell) : chalk.gray(paddedCell)
          })
          .join('  ')

        if (data.length > 1) await writelnStdout(process, terminal, line)
      }

      return 0
    }
  })
}

