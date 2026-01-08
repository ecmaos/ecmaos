import path from 'path'
import chalk from 'chalk'
import { mounts } from '@zenfs/core'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: umount [OPTIONS] TARGET
       umount [-a|--all]

Unmount a filesystem.

Options:
  -a, --all    unmount all filesystems (except root)
  --help       display this help and exit

Examples:
  umount /mnt/tmp        unmount filesystem at /mnt/tmp
  umount -a              unmount all filesystems`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'umount',
    description: 'Unmount a filesystem',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let allMode = false
      const positionalArgs: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '-a' || arg === '--all') {
          allMode = true
        } else if (arg && !arg.startsWith('-')) {
          positionalArgs.push(arg)
        }
      }


      if (allMode) {
        const mountList = Array.from(mounts.keys())
        let unmountedCount = 0
        let errorCount = 0

        for (const target of mountList) {
          if (target === '/') continue

          try {
            kernel.filesystem.fsSync.umount(target)
            unmountedCount++
            await writelnStdout(process, terminal, chalk.green(`Unmounted ${target}`))
          } catch (error) {
            errorCount++
            await writelnStderr(process, terminal, chalk.red(`umount: failed to unmount ${target}: ${error instanceof Error ? error.message : 'Unknown error'}`))
          }
        }

        if (unmountedCount === 0 && errorCount === 0) {
          await writelnStdout(process, terminal, 'No filesystems to unmount.')
        }

        return errorCount > 0 ? 1 : 0
      }

      if (positionalArgs.length === 0) {
        await writelnStderr(process, terminal, chalk.red('umount: missing target argument'))
        await writelnStderr(process, terminal, 'Try \'umount --help\' for more information.')
        return 1
      }

      if (positionalArgs.length > 1) {
        await writelnStderr(process, terminal, chalk.red('umount: too many arguments'))
        await writelnStderr(process, terminal, 'Try \'umount --help\' for more information.')
        return 1
      }

      const targetArg = positionalArgs[0]
      if (!targetArg) {
        await writelnStderr(process, terminal, chalk.red('umount: missing target argument'))
        return 1
      }
      const target = path.resolve(shell.cwd, targetArg)

      if (target === '/') {
        await writelnStderr(process, terminal, chalk.red('umount: cannot unmount root filesystem'))
        return 1
      }

      const mountList = Array.from(mounts.keys())
      if (!mountList.includes(target)) {
        await writelnStderr(process, terminal, chalk.red(`umount: ${target} is not mounted`))
        return 1
      }

      try {
        kernel.filesystem.fsSync.umount(target)
        await writelnStdout(process, terminal, chalk.green(`Unmounted ${target}`))
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`umount: failed to unmount ${target}: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }
  })
}
