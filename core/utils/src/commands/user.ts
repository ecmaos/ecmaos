import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal, User } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: user [COMMAND] [OPTIONS] [USERNAME]
Manage users on the system.

Commands:
  add USERNAME     Add a new user
  del USERNAME     Delete a user
  mod USERNAME     Modify a user
  list             List all users (default)

Options for 'add':
  -m, --create-home    Create home directory
  -s, --shell SHELL    Login shell (default: ecmaos)
  -g, --gid GID        Group ID (default: same as UID)
  -u, --uid UID        User ID (default: auto-assigned)
  -p, --password PASS  Password (will prompt if not provided)

Options for 'del':
  -r, --remove-home    Remove home directory

Options for 'mod':
  -s, --shell SHELL    Change login shell
  -g, --gid GID        Change group ID
  -p, --password       Change password (will prompt)

  --help               Display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'user',
    description: 'Manage users on the system',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      if (shell.credentials.suid !== 0) {
        await writelnStderr(process, terminal, chalk.red('user: permission denied'))
        return 1
      }

      const command = argv.length > 0 && argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : 'list'
      const remainingArgs = command !== 'list' ? argv.slice(1) : argv

      switch (command) {
        case 'list': {
          const users = Array.from(kernel.users.all.values()) as User[]
          
          if (users.length === 0) {
            await writelnStdout(process, terminal, 'No users found')
            return 0
          }

          const uidWidth = Math.max(3, ...users.map(u => u.uid.toString().length))
          const usernameWidth = Math.max(8, ...users.map(u => u.username.length))
          const gidWidth = Math.max(3, ...users.map(u => u.gid.toString().length))

          await writelnStdout(process, terminal, chalk.bold(
            'UID'.padEnd(uidWidth) + '\t' +
            'Username'.padEnd(usernameWidth) + '\t' +
            'GID'.padEnd(gidWidth) + '\t' +
            'Groups'
          ))

          for (const usr of users) {
            await writelnStdout(process, terminal,
              chalk.yellow(usr.uid.toString().padEnd(uidWidth)) + '\t' +
              chalk.green(usr.username.padEnd(usernameWidth)) + '\t' +
              chalk.cyan(usr.gid.toString().padEnd(gidWidth)) + '\t' +
              chalk.blue(usr.groups.join(', ') || '-')
            )
          }

          return 0
        }

        case 'add': {
          let username = ''
          let createHome = false
          let shellValue = 'ecmaos'
          let gid: number | undefined
          let uid: number | undefined
          let password: string | undefined

          for (let i = 0; i < remainingArgs.length; i++) {
            const arg = remainingArgs[i]
            if (!arg || typeof arg !== 'string') continue
            if (arg.startsWith('-')) {
              if (arg === '-m' || arg === '--create-home') {
                createHome = true
              } else if (arg === '-s' || arg === '--shell') {
                if (i + 1 < remainingArgs.length) {
                  const nextArg = remainingArgs[++i]
                  if (nextArg) {
                    shellValue = nextArg
                  } else {
                    await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'s\''))
                    return 1
                  }
                } else {
                  await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'s\''))
                  return 1
                }
              } else if (arg === '-g' || arg === '--gid') {
                if (i + 1 < remainingArgs.length) {
                  const gidStr = remainingArgs[++i]
                  if (gidStr) {
                    gid = parseInt(gidStr, 10)
                    if (isNaN(gid)) {
                      await writelnStderr(process, terminal, chalk.red(`user add: invalid GID '${gidStr}'`))
                      return 1
                    }
                  } else {
                    await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'g\''))
                    return 1
                  }
                } else {
                  await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'g\''))
                  return 1
                }
              } else if (arg === '-u' || arg === '--uid') {
                if (i + 1 < remainingArgs.length) {
                  const uidStr = remainingArgs[++i]
                  if (uidStr) {
                    uid = parseInt(uidStr, 10)
                    if (isNaN(uid)) {
                      await writelnStderr(process, terminal, chalk.red(`user add: invalid UID '${uidStr}'`))
                      return 1
                    }
                  } else {
                    await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'u\''))
                    return 1
                  }
                } else {
                  await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'u\''))
                  return 1
                }
              } else if (arg === '-p' || arg === '--password') {
                if (i + 1 < remainingArgs.length) {
                  const nextArg = remainingArgs[++i]
                  if (nextArg) {
                    password = nextArg
                  } else {
                    await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'p\''))
                    return 1
                  }
                } else {
                  await writelnStderr(process, terminal, chalk.red('user add: option requires an argument -- \'p\''))
                  return 1
                }
              } else if (arg === '--help' || arg === '-h') {
                printUsage(process, terminal)
                return 0
              } else {
                await writelnStderr(process, terminal, chalk.red(`user add: invalid option -- '${arg.replace(/^-+/, '')}'`))
                return 1
              }
            } else {
              if (!username) {
                username = arg
              } else {
                await writelnStderr(process, terminal, chalk.red(`user add: unexpected argument '${arg}'`))
                return 1
              }
            }
          }

          if (!username) {
            await writelnStderr(process, terminal, chalk.red('user add: username required'))
            await writelnStdout(process, terminal, 'Try \'user add --help\' for more information.')
            return 1
          }

          const allUsers = Array.from(kernel.users.all.values()) as User[]
          if (allUsers.some((u: User) => u.username === username)) {
            await writelnStderr(process, terminal, chalk.red(`user add: user '${username}' already exists`))
            return 1
          }

          if (uid !== undefined && kernel.users.all.has(uid)) {
            await writelnStderr(process, terminal, chalk.red(`user add: UID ${uid} already in use`))
            return 1
          }

          if (!password) {
            password = await terminal.readline(chalk.cyan(`New password: `), true)
            const confirm = await terminal.readline(chalk.cyan('Retype new password: '), true)
            if (password !== confirm) {
              await writelnStderr(process, terminal, chalk.red('user add: password mismatch'))
              return 1
            }
          }

          try {
            await kernel.users.add({
              username,
              password,
              uid,
              gid,
              shell: shellValue,
              home: `/home/${username}`
            }, { noHome: !createHome })
            await writelnStdout(process, terminal, chalk.green(`user add: user '${username}' created successfully`))
            return 0
          } catch (error) {
            await writelnStderr(process, terminal, chalk.red(`user add: ${error instanceof Error ? error.message : 'Unknown error'}`))
            return 1
          }
        }

        case 'del': {
          let username = ''
          let removeHome = false

          for (let i = 0; i < remainingArgs.length; i++) {
            const arg = remainingArgs[i]
            if (!arg || typeof arg !== 'string') continue
            if (arg.startsWith('-')) {
              if (arg === '-r' || arg === '--remove-home') {
                removeHome = true
              } else if (arg === '--help' || arg === '-h') {
                printUsage(process, terminal)
                return 0
              } else {
                await writelnStderr(process, terminal, chalk.red(`user del: invalid option -- '${arg.replace(/^-+/, '')}'`))
                return 1
              }
            } else {
              if (!username) {
                username = arg
              } else {
                await writelnStderr(process, terminal, chalk.red(`user del: unexpected argument '${arg}'`))
                return 1
              }
            }
          }

          if (!username) {
            await writelnStderr(process, terminal, chalk.red('user del: username required'))
            await writelnStdout(process, terminal, 'Try \'user del --help\' for more information.')
            return 1
          }

          const allUsers = Array.from(kernel.users.all.values()) as User[]
          const usr = allUsers.find((u: User) => u.username === username)
          if (!usr) {
            await writelnStderr(process, terminal, chalk.red(`user del: user '${username}' does not exist`))
            return 1
          }

          if (usr.uid === 0) {
            await writelnStderr(process, terminal, chalk.red('user del: cannot delete root user'))
            return 1
          }

          try {
            await kernel.users.remove(usr.uid)
            
            if (removeHome && usr.home) {
              try {
                const removeDirRecursive = async (dirPath: string): Promise<void> => {
                  const entries = await shell.context.fs.promises.readdir(dirPath)
                  for (const entry of entries) {
                    const entryPath = `${dirPath}/${entry}`
                    const stat = await shell.context.fs.promises.stat(entryPath)
                    if (stat.isDirectory()) {
                      await removeDirRecursive(entryPath)
                    } else {
                      await shell.context.fs.promises.unlink(entryPath)
                    }
                  }
                  await shell.context.fs.promises.rmdir(dirPath)
                }
                await removeDirRecursive(usr.home)
              } catch {
                await writelnStderr(process, terminal, chalk.yellow(`user del: warning: could not remove home directory '${usr.home}'`))
              }
            }

            await shell.context.fs.promises.writeFile(
              '/etc/passwd',
              (await shell.context.fs.promises.readFile('/etc/passwd', 'utf8'))
                .split('\n')
                .filter((line: string) => !line.startsWith(`${username}:`))
                .join('\n')
            )
            await shell.context.fs.promises.writeFile(
              '/etc/shadow',
              (await shell.context.fs.promises.readFile('/etc/shadow', 'utf8'))
                .split('\n')
                .filter((line: string) => !line.startsWith(`${username}:`))
                .join('\n')
            )
            
            await writelnStdout(process, terminal, chalk.green(`user del: user '${username}' deleted successfully`))
            return 0
          } catch (error) {
            await writelnStderr(process, terminal, chalk.red(`user del: ${error instanceof Error ? error.message : 'Unknown error'}`))
            return 1
          }
        }

        case 'mod': {
          let username = ''
          let shellValue: string | undefined
          let gid: number | undefined
          let changePassword = false

          for (let i = 0; i < remainingArgs.length; i++) {
            const arg = remainingArgs[i]
            if (!arg || typeof arg !== 'string') continue
            if (arg.startsWith('-')) {
              if (arg === '-s' || arg === '--shell') {
                if (i + 1 < remainingArgs.length) {
                  const nextArg = remainingArgs[++i]
                  if (nextArg) {
                    shellValue = nextArg
                  } else {
                    await writelnStderr(process, terminal, chalk.red('user mod: option requires an argument -- \'s\''))
                    return 1
                  }
                } else {
                  await writelnStderr(process, terminal, chalk.red('user mod: option requires an argument -- \'s\''))
                  return 1
                }
              } else if (arg === '-g' || arg === '--gid') {
                if (i + 1 < remainingArgs.length) {
                  const gidStr = remainingArgs[++i]
                  if (gidStr) {
                    gid = parseInt(gidStr, 10)
                    if (isNaN(gid)) {
                      await writelnStderr(process, terminal, chalk.red(`user mod: invalid GID '${gidStr}'`))
                      return 1
                    }
                  } else {
                    await writelnStderr(process, terminal, chalk.red('user mod: option requires an argument -- \'g\''))
                    return 1
                  }
                } else {
                  await writelnStderr(process, terminal, chalk.red('user mod: option requires an argument -- \'g\''))
                  return 1
                }
              } else if (arg === '-p' || arg === '--password') {
                changePassword = true
              } else if (arg === '--help' || arg === '-h') {
                printUsage(process, terminal)
                return 0
              } else {
                await writelnStderr(process, terminal, chalk.red(`user mod: invalid option -- '${arg.replace(/^-+/, '')}'`))
                return 1
              }
            } else {
              if (!username) {
                username = arg
              } else {
                await writelnStderr(process, terminal, chalk.red(`user mod: unexpected argument '${arg}'`))
                return 1
              }
            }
          }

          if (!username) {
            await writelnStderr(process, terminal, chalk.red('user mod: username required'))
            await writelnStdout(process, terminal, 'Try \'user mod --help\' for more information.')
            return 1
          }

          const allUsers = Array.from(kernel.users.all.values()) as User[]
          const usr = allUsers.find((u: User) => u.username === username)
          if (!usr) {
            await writelnStderr(process, terminal, chalk.red(`user mod: user '${username}' does not exist`))
            return 1
          }

          const updates: Partial<User> = {}
          if (shellValue !== undefined) {
            updates.shell = shellValue
          }
          if (gid !== undefined) {
            updates.gid = gid
          }

          if (changePassword) {
            const newPassword = await terminal.readline(chalk.cyan('New password: '), true)
            const confirm = await terminal.readline(chalk.cyan('Retype new password: '), true)
            
            if (newPassword !== confirm) {
              await writelnStderr(process, terminal, chalk.red('user mod: password mismatch'))
              return 1
            }

            try {
              const hashedPassword = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newPassword.trim()))
              updates.password = Array.from(new Uint8Array(hashedPassword)).map(b => b.toString(16).padStart(2, '0')).join('')
            } catch (error) {
              await writelnStderr(process, terminal, chalk.red(`user mod: failed to hash password: ${error instanceof Error ? error.message : 'Unknown error'}`))
              return 1
            }
          }

          if (Object.keys(updates).length === 0 && !changePassword) {
            await writelnStderr(process, terminal, chalk.red('user mod: no changes specified'))
            return 1
          }

          try {
            await kernel.users.update(usr.uid, updates)
            await writelnStdout(process, terminal, chalk.green(`user mod: user '${username}' modified successfully`))
            return 0
          } catch (error) {
            await writelnStderr(process, terminal, chalk.red(`user mod: ${error instanceof Error ? error.message : 'Unknown error'}`))
            return 1
          }
        }

        default:
          await writelnStderr(process, terminal, chalk.red(`user: invalid command '${command}'`))
          await writelnStdout(process, terminal, 'Try \'user --help\' for more information.')
          return 1
      }
    }
  })
}
