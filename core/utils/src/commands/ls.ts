import path from 'path'
import chalk from 'chalk'
import columnify from 'columnify'
import humanFormat from 'human-format'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: ls [OPTION]... [FILE]...
List information about the FILEs (the current directory by default).

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'ls',
    description: 'List directory contents',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const target = argv.length > 0 && argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : shell.cwd
      const fullPath = target ? path.resolve(shell.cwd, target === '' ? '.' : target) : shell.cwd
      const stats = await shell.context.fs.promises.stat(fullPath)
      const entries: string[] = stats.isDirectory() ? await shell.context.fs.promises.readdir(fullPath) : [fullPath]
      const descriptions = kernel.filesystem.descriptions(kernel.i18n.t)

      const getModeType = (stats: Awaited<ReturnType<typeof shell.context.fs.promises.stat>>) => {
        let type = '-'
        if (stats.isDirectory()) type = 'd'
        else if (stats.isSymbolicLink()) type = 'l'
        else if (stats.isBlockDevice()) type = 'b'
        else if (stats.isCharacterDevice()) type = 'c'
        else if (stats.isFIFO()) type = 'p'
        else if (stats.isSocket()) type = 's'
        return type
      }

      const getModeString = (stats: Awaited<ReturnType<typeof shell.context.fs.promises.stat>>, targetStats?: Awaited<ReturnType<typeof shell.context.fs.promises.stat>>) => {
        const type = getModeType(stats)
        const modeStats = targetStats || stats
        const permissions = (Number(modeStats.mode) & parseInt('777', 8)).toString(8).padStart(3, '0')
          .replace(/0/g, '---')
          .replace(/1/g, '--' + chalk.red('x'))
          .replace(/2/g, '-' + chalk.yellow('w') + '-')
          .replace(/3/g, '-' + chalk.yellow('w') + chalk.red('x'))
          .replace(/4/g, chalk.green('r') + '--')
          .replace(/5/g, chalk.green('r') + '-' + chalk.red('x'))
          .replace(/6/g, chalk.green('r') + chalk.yellow('w') + '-')
          .replace(/7/g, chalk.green('r') + chalk.yellow('w') + chalk.red('x'))
        return type + permissions
      }

      const getTimestampString = (timestamp: Date) => {
        const diff = (new Date().getTime() - timestamp.getTime()) / 1000

        if (diff < 24 * 60 * 60) return chalk.green(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else if (diff < 7 * 24 * 60 * 60) return chalk.yellow(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else if (diff < 30 * 24 * 60 * 60) return chalk.blue(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else if (diff < 365 * 24 * 60 * 60) return chalk.magenta(timestamp.toISOString().slice(0, 19).replace('T', ' '))
        else return chalk.gray(timestamp.toISOString().slice(0, 19).replace('T', ' '))
      }

      const getOwnerString = (stats: Awaited<ReturnType<typeof shell.context.fs.promises.stat>>) => {
        const owner = kernel.users.all.get(Number(stats.uid)) || kernel.users.all.get(0)

        if (owner?.username === shell.username) return chalk.green(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
        else if (stats.uid === 0) return chalk.red(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
        else return chalk.gray(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
      }

      const getLinkInfo = (linkTarget: string | null, linkStats: Awaited<ReturnType<typeof shell.context.fs.promises.stat>> | null, stats: Awaited<ReturnType<typeof shell.context.fs.promises.stat>> | null) => {
        if (linkTarget || (linkStats && linkStats.isSymbolicLink())) return kernel.i18n.t('Symbolic Link')
        if (stats && stats.nlink > 1) return kernel.i18n.t('Hard Link')
        return ''
      }

      const filesMap = await Promise.all(entries
        .map(async entry => {
          const target = path.resolve(fullPath, entry)
          try {
            let linkTarget: string | null = null
            let linkStats = null
            let stats = null
            
            try {
              linkStats = await shell.context.fs.promises.lstat(target)
              if (linkStats.isSymbolicLink()) {
                try {
                  linkTarget = await shell.context.fs.promises.readlink(target)
                  stats = await shell.context.fs.promises.stat(target)
                } catch {
                  stats = linkStats
                }
              } else {
                stats = linkStats
              }
            } catch {
              stats = await shell.context.fs.promises.stat(target)
            }
            
            return { target, name: entry, stats, linkStats, linkTarget }
          } catch {
            return { target, name: entry, stats: null, linkStats: null, linkTarget: null }
          }
        }))

      const files = filesMap
        .filter(entry => entry && entry.stats && !entry.stats.isDirectory())
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

      const directoryMap = await Promise.all(entries
        .map(async entry => {
          const target = path.resolve(fullPath, entry)
          try {
            let linkTarget: string | null = null
            let linkStats = null
            let stats = null
            
            try {
              linkStats = await shell.context.fs.promises.lstat(target)
              if (linkStats.isSymbolicLink()) {
                try {
                  linkTarget = await shell.context.fs.promises.readlink(target)
                  stats = await shell.context.fs.promises.stat(target)
                } catch {
                  stats = linkStats
                }
              } else {
                stats = linkStats
              }
            } catch {
              stats = await shell.context.fs.promises.stat(target)
            }
            
            return { target, name: entry, stats, linkStats, linkTarget }
          } catch {
            return { target, name: entry, stats: null, linkStats: null, linkTarget: null }
          }
        }))

      const directories = directoryMap
        .filter(entry => entry && entry.stats && entry.stats.isDirectory())
        .filter((entry, index, self) => self.findIndex(e => e?.name === entry?.name) === index)
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

      const isDevDirectory = fullPath.startsWith('/dev')
      const columns = isDevDirectory ? ['Name', 'Mode', 'Owner', 'Info'] : ['Name', 'Size', 'Modified', 'Mode', 'Owner', 'Info']

      const directoryRows = directories.sort((a, b) => a.name.localeCompare(b.name)).map(directory => {
        const displayName = directory.linkTarget
          ? `${directory.name} ${chalk.cyan('⟶')} ${directory.linkTarget}`
          : directory.name
        const modeStats = directory.linkStats && directory.linkStats.isSymbolicLink() 
          ? directory.linkStats 
          : directory.stats
        const modeString = modeStats 
          ? getModeString(modeStats, directory.linkStats?.isSymbolicLink() ? directory.stats : undefined)
          : ''
        const linkInfo = getLinkInfo(directory.linkTarget, directory.linkStats, directory.stats)
        
        const modeType = modeString?.charAt(0) || ''
        const coloredName = modeType === 'd' ? chalk.blue(displayName) 
          : modeType === 'l' ? chalk.cyan(displayName) 
          : chalk.green(displayName)

        const row: Record<string, string> = {
          Name: coloredName,
          Mode: chalk.gray(modeString),
          Owner: directory.stats ? chalk.gray(getOwnerString(directory.stats)) : '',
          Info: chalk.gray(linkInfo)
        }

        if (!isDevDirectory) {
          row.Size = ''
          row.Modified = directory.stats ? chalk.gray(getTimestampString(directory.stats.mtime)) : ''
        }

        return row
      })

      const fileRows = files.sort((a, b) => a.name.localeCompare(b.name)).map(file => {
        const displayName = file.linkTarget
          ? `${file.name} ${chalk.cyan('⟶')} ${file.linkTarget}`
          : file.name
        const modeStats = file.linkStats && file.linkStats.isSymbolicLink() 
          ? file.linkStats 
          : file.stats
        const modeString = modeStats 
          ? getModeString(modeStats, file.linkStats?.isSymbolicLink() ? file.stats : undefined)
          : ''
        
        const modeType = modeString?.charAt(0) || ''
        const coloredName = modeType === 'd' ? chalk.blue(displayName) 
          : modeType === 'l' ? chalk.cyan(displayName) 
          : chalk.green(displayName)

        const info = (() => {
          const linkInfo = getLinkInfo(file.linkTarget, file.linkStats, file.stats)
          if (linkInfo) return linkInfo
          
          if (descriptions.has(path.resolve(fullPath, file.name))) return descriptions.get(path.resolve(fullPath, file.name)) || ''
          if (file.name.includes('.')) {
            const ext = file.name.split('.').pop()
            if (ext && descriptions.has('.' + ext)) return descriptions.get('.' + ext) || ''
          }
          if (!file.stats) return ''
          if (file.stats.isBlockDevice() || file.stats.isCharacterDevice()) {
            // TODO: zenfs `fs.mounts` is deprecated - use a better way of getting device info
          }

          return ''
        })()

        const row: Record<string, string> = {
          Name: coloredName,
          Mode: chalk.gray(modeString),
          Owner: file.stats ? chalk.gray(getOwnerString(file.stats)) : '',
          Info: chalk.gray(info)
        }

        if (!isDevDirectory) {
          row.Size = file.stats ? chalk.gray(humanFormat(file.stats.size)) : ''
          row.Modified = file.stats ? chalk.gray(getTimestampString(file.stats.mtime)) : ''
        }

        return row
      })

      const data = [...directoryRows, ...fileRows]

      if (data.length > 0) {
        const table = columnify(data, {
          columns,
          columnSplitter: '  ',
          showHeaders: true,
          headingTransform: (heading: string) => chalk.bold(heading)
        })

        await writelnStdout(process, terminal, table)
      }

      return 0
    }
  })
}
