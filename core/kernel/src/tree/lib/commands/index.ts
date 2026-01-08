/**
 * This file represents the commands provided by the terminal itself.
 *
 * @remarks
 * Essential file/shell operation commands (cat, cd, chmod, cp, echo, ls, mkdir, mv, pwd, rm, rmdir, stat, touch)
 * have been moved to @ecmaos/coreutils package. This file now contains only kernel-specific commands.
 *
 */

import ansi from 'ansi-escape-sequences'
import chalk from 'chalk'
import humanFormat from 'human-format'
import type { CommandLineOptions } from 'command-line-args'
import path from 'path'

import { bindContext, createCredentials } from '@zenfs/core'

import {
  KernelEvents
} from '@ecmaos/types'

import type {
  Kernel,
  Process,
  Shell,
  Terminal,
  User
} from '@ecmaos/types'

// Import coreutils commands
import { createAllCommands as createCoreutilsCommands, TerminalCommand, CommandArgs, writelnStdout, writelnStderr } from '@ecmaos/coreutils'

/**
 * The TerminalCommands function creates the set of builtin terminal commands.
 * It merges coreutils commands with kernel-specific commands.
 */
export const TerminalCommands = (kernel: Kernel, shell: Shell, terminal: Terminal): { [key: string]: TerminalCommand } => {
  const HelpOption = { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') }

  // Get coreutils commands
  const coreutilsCommands = createCoreutilsCommands(kernel, shell, terminal)

  // Kernel-specific commands
  const kernelCommands: { [key: string]: TerminalCommand } = {
    chown: new TerminalCommand({
      command: 'chown',
      description: 'Change file ownership',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The user and path to the file or directory' },
        { name: 'group', type: String, description: 'The group to set for the file or directory' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await chown({ kernel, shell, terminal, args: [argv.args[0], argv.args[1], argv.group] })
      }
    }),
    clear: new TerminalCommand({
      command: 'clear',
      description: 'Clear the terminal screen',
      kernel,
      shell,
      terminal,
      options: [],
      run: async () => {
        return await clear({ kernel, shell, terminal, args: [] })
      }
    }),
    df: new TerminalCommand({
      command: 'df',
      description: 'Display disk space usage',
      kernel,
      shell,
      terminal,
      options: [],
      run: async (_argv: CommandLineOptions, process?: Process) => {
        return await df({ kernel, shell, terminal, process, args: [] })
      }
    }),
    download: new TerminalCommand({
      command: 'download',
      description: 'Download a file from the filesystem',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to download' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await download({ kernel, shell, terminal, process, args: argv.path })
      }
    }),
    install: new TerminalCommand({
      command: 'install',
      description: 'Install a package',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'package', type: String, typeLabel: '{underline package}', defaultOption: true, description: 'The package name and optional version (e.g. package@1.0.0)' },
        { name: 'registry', type: String, description: 'The registry to use', defaultValue: 'https://registry.npmjs.org' },
        { name: 'reinstall', type: Boolean, description: 'Reinstall the package if it is already installed' }
      ],
      run: async (argv: CommandLineOptions) => {
        const { default: install } = await import('./install')
        return await install({ kernel, shell, terminal, args: [argv.package, argv.registry, argv.reinstall] })
      }
    }),
    uninstall: new TerminalCommand({
      command: 'uninstall',
      description: 'Uninstall a package',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'package', type: String, typeLabel: '{underline package}', defaultOption: true, description: 'The package name and optional version (e.g. package@1.0.0). If no version is specified, all versions will be uninstalled.' }
      ],
      run: async (argv: CommandLineOptions) => {
        const { default: uninstall } = await import('./uninstall')
        return await uninstall({ kernel, shell, terminal, args: [argv.package] })
      }
    }),
    load: new TerminalCommand({
      command: 'load',
      description: 'Load a JavaScript file',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file to load' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await load({ kernel, shell, terminal, args: [argv.path] })
      }
    }),
    passwd: new TerminalCommand({
      command: 'passwd',
      description: 'Change user password',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'password', type: String, multiple: true, defaultOption: true, description: 'Old and new passwords (optional - will prompt if not provided)' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await passwd({ kernel, shell, terminal, process, args: argv.password })
      }
    }),
    ps: new TerminalCommand({
      command: 'ps',
      description: 'List all running processes',
      kernel,
      shell,
      terminal,
      options: [],
      run: async (_argv: CommandLineOptions, process?: Process) => {
        return await ps({ kernel, shell, terminal, process, args: [] })
      }
    }),
    reboot: new TerminalCommand({
      command: 'reboot',
      description: 'Reboot the system',
      kernel,
      shell,
      terminal,
      options: [],
      run: async () => {
        return await reboot({ kernel, shell, terminal, args: [] })
      }
    }),
    screensaver: new TerminalCommand({
      command: 'screensaver',
      description: 'Start the screensaver',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'screensaver', type: String, typeLabel: '{underline screensaver}', defaultOption: true, description: 'The screensaver to start' },
        { name: 'set', type: Boolean, description: 'Set the default screensaver' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await screensaver({ kernel, shell, terminal, process, args: [argv.screensaver, argv.set] })
      }
    }),
    snake: new TerminalCommand({
      command: 'snake',
      description: 'Play a simple snake game',
      kernel,
      shell,
      terminal,
      options: [],
      run: async () => {
        await snake({ kernel, shell, terminal, args: [] })
      }
    }),
    su: new TerminalCommand({
      command: 'su',
      description: 'Switch user',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'user', type: String, defaultOption: true, description: 'The user to switch to' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await su({ kernel, shell, terminal, process, args: [argv.user] })
      }
    }),
    upload: new TerminalCommand({
      command: 'upload',
      description: 'Upload a file to the filesystem',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to store the file' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await upload({ kernel, shell, terminal, process, args: [argv.path] })
      }
    }),
  }

  // Merge coreutils and kernel commands
  return {
    ...coreutilsCommands,
    ...kernelCommands
  }
}

// Re-export TerminalCommand and CommandArgs for backward compatibility
export { TerminalCommand, type CommandArgs } from '@ecmaos/coreutils'

// Kernel-specific command implementations (non-essential commands remain here)
export const chown = async ({ shell, args }: CommandArgs) => {
  const [user, target, group] = (args as string[])
  if (!user || !target) return 1
  const fullPath = path.resolve(shell.cwd, target)
  await shell.context.fs.promises.chown(fullPath, parseInt(user), parseInt(group ?? user))
}

export const clear = async ({ terminal }: CommandArgs) => {
  terminal.write('\x1b[2J\x1b[H')
}

export const df = async ({ kernel, terminal, process }: CommandArgs) => {
  const usage = await kernel.storage.usage()
  if (!usage) return 1

  const getData = (usage: StorageEstimate) => {
    const data: Record<string, string | Record<string, string>> = {}
    for (const [key, value] of Object.entries(usage)) {
      if (typeof value === 'object' && value !== null) {
        data[key] = getData(value as StorageEstimate) as Record<string, string>
      } else if (typeof value === 'number') {
        data[key] = humanFormat(value)
      } else {
        data[key] = String(value)
      }
    }
    return data
  }

  const data = getData(usage)
  await writelnStdout(process, terminal, JSON.stringify(data, null, 2))
  return 0
}

export const download = async ({ shell, terminal, process, args }: CommandArgs) => {
  const destination = (args as string[])[0]
  const fullPath = destination ? path.resolve(shell.cwd, destination) : shell.cwd
  if (await shell.context.fs.promises.exists(fullPath)) {
    const data = await shell.context.fs.promises.readFile(fullPath)
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')

    a.href = url
    a.download = path.basename(fullPath)
    a.click()
    window.URL.revokeObjectURL(url)
  } else {
    await writelnStderr(process, terminal, chalk.red(`${fullPath} not found`))
  }
}

export const load = async ({ shell, args }: CommandArgs) => {
  const [target] = (args as string[])
  if (!target) {
    await shell.execute('load --help')
    return 1
  }

  const fullPath = path.resolve(shell.cwd, target)
  const code = await shell.context.fs.promises.readFile(fullPath, 'utf-8')
  const script = new Function(code)
  script()
}

export const passwd = async ({ kernel, terminal, process, args }: CommandArgs) => {
  let oldPass, newPass

  if (!args || !Array.isArray(args) || args.length < 2) {
    oldPass = await terminal.readline(chalk.cyan('Enter current password: '), true)
    if (!oldPass) {
      await writelnStderr(process, terminal, chalk.red('Current password required'))
      return 1
    }

    newPass = await terminal.readline(chalk.cyan('Enter new password: '), true)
    if (!newPass) {
      await writelnStderr(process, terminal, chalk.red('New password required'))
      return 1
    }

    const confirmPass = await terminal.readline(chalk.cyan('Confirm new password: '), true)
    if (newPass !== confirmPass) {
      await writelnStderr(process, terminal, chalk.red('Passwords do not match'))
      return 1
    }
  } else {
    [oldPass, newPass] = args as string[]
  }

  try {
    if (!oldPass || !newPass) throw new Error('Missing password')
    await kernel.users.password(oldPass, newPass)
    await writelnStdout(process, terminal, chalk.green('Password updated successfully'))
    return 0
  } catch (error) {
    await writelnStderr(process, terminal, chalk.red(`Failed to update password: ${error instanceof Error ? error.message : 'Unknown error'}`))
    return 1
  }
}

export const ps = async ({ kernel, terminal, process }: CommandArgs) => {
  await writelnStdout(process, terminal, 'PID\tCOMMAND\t\t\tSTATUS')
  for (const [pid, proc] of kernel.processes.all.entries()) {
    await writelnStdout(process, terminal, `${chalk.yellow(pid)}\t${chalk.green(proc.command)}\t\t\t${chalk.blue(proc.status)}`)
  }
}

export const reboot = async ({ kernel }: CommandArgs) => {
  kernel.reboot()
}

export const screensaver = async ({ kernel, terminal, process, args }: CommandArgs) => {
  const [screensaverName, set] = (args as string[])

  if (screensaverName === 'off') {
    kernel.storage.local.removeItem('screensaver')
    return 0
  }

  let saverName = screensaverName
  if (!saverName) saverName = kernel.storage.local.getItem('screensaver') || 'matrix'

  const saver = kernel.screensavers.get(saverName)
  if (!saver) {
    await writelnStderr(process, terminal, chalk.red('Invalid screensaver'))
    return 1
  }

  terminal.blur()
  saver.default({ terminal })

  if (set) kernel.storage.local.setItem('screensaver', saverName)
}

export const snake = ({ kernel, terminal }: CommandArgs) => {
  const width = 20
  const height = 10
  const snake = [{ x: 10, y: 5 }]
  let food = { x: 15, y: 5 }
  let direction = { x: 1, y: 0 }
  let score = 0
  let gameOver = false
  let gameStarted = false

  const renderGame = () => {
    const gameBoard = Array(height).fill(null).map(() => Array(width).fill(' '))
    snake.forEach(segment => gameBoard[segment.y]![segment.x] = segment.y === snake[0]!.y && segment.x === snake[0]!.x ? chalk.yellow('█') : chalk.gray('█'))
    gameBoard[food.y]![food.x] = chalk.green('●')

    terminal.write(ansi.erase.display(2) + ansi.cursor.position(2, 1))
    terminal.writeln(chalk.blue('┌' + '─'.repeat(width) + '┐'))
    gameBoard.forEach(row => terminal.writeln(chalk.blue('│' + row.join('') + '│')))
    terminal.writeln(chalk.blue(`└${'─'.repeat(width)}┘`))
    terminal.writeln(`Score: ${score}  High Score: ${kernel.storage.local.getItem('snake-high-score') || 0}`)
    if (!gameStarted) terminal.writeln('\nPress any key to start...')
  }

  const moveSnake = () => {
    const head = { x: snake[0]!.x + direction.x, y: snake[0]!.y + direction.y }
    if (head.x < 0 || head.x >= width || head.y < 0 || head.y >= height) return gameOver = true
    if (snake.some(segment => segment.x === head.x && segment.y === head.y)) return gameOver = true

    snake.unshift(head)

    if (head.x === food.x && head.y === food.y) {
      score++
      food = { x: Math.floor(Math.random() * width), y: Math.floor(Math.random() * height) }
      if (!kernel.storage.local.getItem('snake-high-score') || Number(kernel.storage.local.getItem('snake-high-score')) < score)
        kernel.storage.local.setItem('snake-high-score', score.toString())
    } else snake.pop()

    return
  }

  terminal.write(ansi.cursor.hide)
  terminal.unlisten()
  renderGame()

  const keyListener = terminal.onKey(({ domEvent }: { domEvent: KeyboardEvent }) => {
    const newDirection = (() => {
      switch (domEvent.key) {
        case 'ArrowUp': return { x: 0, y: -1 }
        case 'ArrowDown': return { x: 0, y: 1 }
        case 'ArrowRight': return { x: 1, y: 0 }
        case 'ArrowLeft': return { x: -1, y: 0 }
        default: return null
      }
    })()

    if (newDirection && !(newDirection.x + direction.x === 0 && newDirection.y + direction.y === 0)) direction = newDirection
    if (domEvent.key === 'Escape') gameOver = true

    if (!gameStarted) {
      gameStarted = true
      switch (domEvent.key) {
        case 'ArrowUp': return direction = { x: 0, y: -1 }
        case 'ArrowDown': return direction = { x: 0, y: 1 }
        case 'ArrowRight': return direction = { x: 1, y: 0 }
        case 'ArrowLeft': return direction = { x: -1, y: 0 }
      }
    }
  })

  const gameLoop = setInterval(() => {
    if (gameOver) {
      keyListener.dispose()
      terminal.listen()
      clearInterval(gameLoop)
      terminal.writeln('Game Over!')
      terminal.write(ansi.cursor.show + terminal.prompt())
      return
    }

    if (!gameStarted) return

    moveSnake()
    renderGame()
  }, 150)

  return new Promise(resolve => {
    const checkGameOver = setInterval(() => {
      if (gameOver) { clearInterval(checkGameOver); resolve(0) }
    }, 100)
  })
}

export const su = async ({ kernel, shell, terminal, process, args }: CommandArgs) => {
  const username = (args as string[])[0]
  const currentUser = kernel.users.get(shell.credentials.suid) as User
  if (!currentUser || shell.credentials.suid !== 0) {
    await writelnStderr(process, terminal, chalk.red(kernel.i18n.t('Unauthorized')))
    return 1
  }

  const user = Array.from(kernel.users.all.values()).find((u): u is User => (u as User).username === username)
  if (!user) {
    await writelnStderr(process, terminal, chalk.red(kernel.i18n.t('User not found', { username })))
    return 1
  }

  shell.context = bindContext({ root: '/', pwd: '/', credentials: user })
  shell.credentials = createCredentials({ uid: user.uid, gid: user.gid, suid: currentUser.uid, sgid: currentUser.gid, euid: user.uid, egid: user.gid, groups: user.groups })
  terminal.promptTemplate = `{user}:{cwd}${user.uid === 0 ? '#' : '$'} `
}

export const upload = async ({ kernel, shell, terminal, process, args }: CommandArgs) => {
  const destination = path.resolve((args as string[])[0] || shell.cwd)
  if (!destination) {
    await writelnStderr(process, terminal, chalk.red('File path is required'))
    return 1
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '*'
  input.onchange = async (event) => {
    if (!event.target) {
      await writelnStderr(process, terminal, chalk.red('No file selected'))
      return
    }
    const files = (event.target as HTMLInputElement).files
    if (!files) {
      await writelnStderr(process, terminal, chalk.red('No file selected'))
      return
    }
    for (const file of files) {
      const fileReader = new FileReader()
      fileReader.onload = async (event) => {
        if (!event.target) {
          await writelnStderr(process, terminal, chalk.red('No file selected'))
          return
        }
        const data = new Uint8Array(event.target.result as ArrayBuffer)
        await shell.context.fs.promises.writeFile(path.resolve(destination, file.name), data)
        kernel.events.dispatch(KernelEvents.UPLOAD, { file: file.name, path: path.resolve(destination, file.name) })
      }

      fileReader.readAsArrayBuffer(file)
    }
  }

  input.click()
  return 0
}
