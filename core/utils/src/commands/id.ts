import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: id [OPTION]...
Print user and group IDs.

  -u, --user     print only the effective user ID
  -g, --group    print only the effective group ID
  -G, --groups   print all group IDs
  -n, --name     print names instead of numeric IDs
  --help         display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'id',
    description: 'Print user and group IDs',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      let userOnly = false
      let groupOnly = false
      let groupsOnly = false
      let nameOnly = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-u' || arg === '--user') {
          userOnly = true
        } else if (arg === '-g' || arg === '--group') {
          groupOnly = true
        } else if (arg === '-G' || arg === '--groups') {
          groupsOnly = true
        } else if (arg === '-n' || arg === '--name') {
          nameOnly = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('u')) userOnly = true
          if (flags.includes('g')) groupOnly = true
          if (flags.includes('G')) groupsOnly = true
          if (flags.includes('n')) nameOnly = true
          const invalidFlags = flags.filter(f => !['u', 'g', 'G', 'n'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStdout(process, terminal, `id: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        }
      }

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
