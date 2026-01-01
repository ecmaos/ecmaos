import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'which',
    description: 'Locate a command',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'command', type: String, typeLabel: '{underline command}', defaultOption: true, multiple: true, description: 'The command(s) to locate' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const commands = (argv.command as string[]) || []

      if (commands.length === 0) {
        await writelnStderr(process, terminal, 'which: missing command name')
        return 1
      }

      const writer = process.stdout.getWriter()
      let exitCode = 0

      const resolveCommand = async (command: string): Promise<string | undefined> => {
        if (command.startsWith('./')) {
          const cwdCommand = path.join(shell.cwd, command.slice(2))
          if (await shell.context.fs.promises.exists(cwdCommand)) {
            return cwdCommand
          }
          return undefined
        }

        const paths = shell.env.get('PATH')?.split(':') || ['/bin', '/usr/bin', '/usr/local/bin']
        const resolvedCommand = path.resolve(command)

        if (await shell.context.fs.promises.exists(resolvedCommand)) {
          return resolvedCommand
        }

        for (const pathDir of paths) {
          const expandedPath = pathDir.replace(/\$([A-Z_]+)/g, (_, name) => shell.env.get(name) || '')
          const fullPath = `${expandedPath}/${command}`
          if (await shell.context.fs.promises.exists(fullPath)) return fullPath
        }

        return undefined
      }

      try {
        for (const cmd of commands) {
          const commandPath = await resolveCommand(cmd)
          
          if (commandPath) {
            await writer.write(new TextEncoder().encode(commandPath + '\n'))
          } else {
            exitCode = 1
          }
        }

        return exitCode
      } finally {
        writer.releaseLock()
      }
    }
  })
}
