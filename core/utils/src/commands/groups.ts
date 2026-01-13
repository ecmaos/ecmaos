import type { Kernel, Process, Shell, Terminal, User } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: groups [USERNAME]...
Print the groups a user belongs to.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'groups',
    description: 'Print the groups a user belongs to',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (!process) return 1

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const usernames: string[] = []

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (!arg.startsWith('-')) {
          usernames.push(arg)
        } else {
          await writelnStderr(process, terminal, `groups: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'groups --help' for more information.")
          return 1
        }
      }

      const targets = usernames.length > 0 ? usernames : [shell.username]

      for (const username of targets) {
        const user = Array.from(kernel.users.all.values()).find(
          (u): u is User => (u as User).username === username
        )

        if (!user) {
          await writelnStderr(process, terminal, `groups: '${username}': no such user`)
          continue
        }

        const groups = shell.credentials.groups || []
        const groupNames = groups.map(gid => {
          const groupUser = kernel.users.get(gid)
          return groupUser?.username || gid.toString()
        })

        const output = `${username} : ${groupNames.join(' ')}`
        await writelnStdout(process, terminal, output)
      }

      return 0
    }
  })
}
