import path from 'path'
import chalk from 'chalk'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'ln',
    description: 'Create links between files',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'symbolic', type: Boolean, alias: 's', description: 'Create symbolic links instead of hard links' },
      { name: 'force', type: Boolean, alias: 'f', description: 'Remove existing destination files' },
      { name: 'verbose', type: Boolean, alias: 'v', description: 'Print name of each linked file' },
      { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The target and optional link name' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const args = (argv.args as string[]) || []
      const symbolic = argv.symbolic as boolean || false
      const force = argv.force as boolean || false
      const verbose = argv.verbose as boolean || false

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
