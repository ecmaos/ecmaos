import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'id',
    description: 'Print user and group IDs',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'user', type: Boolean, alias: 'u', description: 'Print only the effective user ID' },
      { name: 'group', type: Boolean, alias: 'g', description: 'Print only the effective group ID' },
      { name: 'groups', type: Boolean, alias: 'G', description: 'Print all group IDs' },
      { name: 'name', type: Boolean, alias: 'n', description: 'Print names instead of numeric IDs' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const userOnly = (argv.user as boolean) || false
      const groupOnly = (argv.group as boolean) || false
      const groupsOnly = (argv.groups as boolean) || false
      const nameOnly = (argv.name as boolean) || false

      const user = kernel.users.get(shell.credentials.uid)
      const group = kernel.users.get(shell.credentials.gid)
      const groups = shell.credentials.groups || []

      let output = ''

      if (userOnly) {
        output = nameOnly ? (user?.username || shell.credentials.uid.toString()) : shell.credentials.euid.toString()
      } else if (groupOnly) {
        output = nameOnly ? (group?.username || shell.credentials.gid.toString()) : shell.credentials.egid.toString()
      } else if (groupsOnly) {
        output = groups.map(gid => {
          if (nameOnly) {
            const g = kernel.users.get(gid)
            return g?.username || gid.toString()
          }
          return gid.toString()
        }).join(' ')
      } else {
        const uid = nameOnly ? (user?.username || shell.credentials.uid.toString()) : shell.credentials.uid.toString()
        const gid = nameOnly ? (group?.username || shell.credentials.gid.toString()) : shell.credentials.gid.toString()
        const groupsStr = groups.map(gid => {
          if (nameOnly) {
            const g = kernel.users.get(gid)
            return g?.username || gid.toString()
          }
          return gid.toString()
        }).join(',')
        
        output = `uid=${uid} gid=${gid} groups=${groupsStr}`
      }

      await writelnStdout(process, terminal, output)
      return 0
    }
  })
}
