import path from 'path'
import type { Kernel, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cd',
    description: 'Change the shell working directory',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to change to' }
    ],
    run: async (argv) => {
      let destination = (argv.path as string) || shell.cwd
      if (destination && destination.startsWith('~')) {
        const home = shell.env.get('HOME')
        if (home) {
          destination = destination.replace(/^~(?=$|\/)/, home)
        }
      }
      
      const fullPath = destination ? path.resolve(shell.cwd, destination) : shell.cwd
      await shell.context.fs.promises.access(fullPath)
      shell.cwd = fullPath
      localStorage.setItem(`cwd:${shell.credentials.uid}`, fullPath)
      return 0
    }
  })
}

