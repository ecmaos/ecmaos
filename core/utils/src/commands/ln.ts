import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: ln [OPTION]... [-T] TARGET LINK_NAME
   or:  ln [OPTION]... TARGET
   or:  ln [OPTION]... TARGET... DIRECTORY
Create links between files.

  -s, --symbolic  make symbolic links instead of hard links
  -f, --force     remove existing destination files
  -v, --verbose   print name of each linked file
  --help          display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'ln',
    description: 'Create links between files',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const args: string[] = []
      let symbolic = false
      let force = false
      let verbose = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-s' || arg === '--symbolic') {
          symbolic = true
        } else if (arg === '-f' || arg === '--force') {
          force = true
        } else if (arg === '-v' || arg === '--verbose') {
          verbose = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('s')) symbolic = true
          if (flags.includes('f')) force = true
          if (flags.includes('v')) verbose = true
          const invalidFlags = flags.filter(f => !['s', 'f', 'v'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `ln: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        } else {
          args.push(arg)
        }
      }

      if (args.length === 0) {
        await writelnStderr(process, terminal, chalk.red('ln: missing file operand'))
        await writelnStderr(process, terminal, 'Try \'ln --help\' for more information.')
        return 1
      }

      const target = args[0]
      if (!target) {
        await writelnStderr(process, terminal, chalk.red('ln: missing file operand'))
        return 1
      }

      const targetPath = path.resolve(shell.cwd, target)

      let targetStats
      try {
        targetStats = await shell.context.fs.promises.stat(targetPath)
        if (!targetStats.isFile() && !targetStats.isDirectory()) {
          await writelnStderr(process, terminal, chalk.red(`ln: ${target}: invalid target`))
          return 1
        }
        if (!symbolic && targetStats.isDirectory()) {
          await writelnStderr(process, terminal, chalk.red(`ln: ${target}: hard link not allowed for directory`))
          return 1
        }
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`ln: ${target}: No such file or directory`))
        return 1
      }

      let linkName: string
      if (args.length === 1) {
        linkName = path.join(shell.cwd, path.basename(target))
      } else {
        const linkNameInput = args[1]
        if (!linkNameInput) {
          await writelnStderr(process, terminal, chalk.red('ln: missing link name'))
          return 1
        }
        const linkNamePath = path.resolve(shell.cwd, linkNameInput)
        const linkNameStats = await shell.context.fs.promises.stat(linkNamePath).catch(() => null)
        if (linkNameStats?.isDirectory()) {
          linkName = path.join(linkNamePath, path.basename(target))
        } else {
          linkName = linkNamePath
        }
      }

      try {
        const linkExists = await shell.context.fs.promises.stat(linkName).catch(() => null)
        if (linkExists) {
          if (force) {
            if (linkExists.isDirectory()) {
              await shell.context.fs.promises.rmdir(linkName)
            } else {
              await shell.context.fs.promises.unlink(linkName)
            }
          } else {
            await writelnStderr(process, terminal, chalk.red(`ln: ${linkName}: File exists`))
            return 1
          }
        }

        if (symbolic) {
          await shell.context.fs.promises.symlink(targetPath, linkName)
        } else {
          await shell.context.fs.promises.link(targetPath, linkName)
        }

        if (verbose) {
          await writelnStdout(process, terminal, linkName)
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`ln: ${(error as Error).message}`))
        return 1
      }
    }
  })
}
