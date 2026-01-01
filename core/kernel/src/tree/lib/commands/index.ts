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
import * as zipjs from '@zip.js/zip.js'

import { bindContext, createCredentials, Fetch, InMemory, resolveMountConfig } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'

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
    env: new TerminalCommand({
      command: 'env',
      description: 'Print or set an environment variable',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'variables', type: String, multiple: true, defaultOption: true, typeLabel: '{underline variables}', description: 'The environment variable(s) to print' },
        { name: 'set', type: String, description: 'Set the environment variable' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await env({ kernel, shell, terminal, process, args: [argv.variables, argv.set] })
      }
    }),
    fetch: new TerminalCommand({
      command: 'fetch',
      description: 'Fetch a resource from the network',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'url', type: String, typeLabel: '{underline url}', defaultOption: true, description: 'The URL to fetch' },
        { name: 'filename', type: String, description: 'Output the response to a file' },
        { name: 'method', type: String, description: 'The HTTP method to use', defaultValue: 'GET' },
        { name: 'body', type: String, description: 'The body to send with the request' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await fetch({ kernel, shell, terminal, process, args: [argv.url, argv.filename, argv.method, argv.body] })
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
    mount: new TerminalCommand({
      command: 'mount',
      description: 'Mount a filesystem',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The source and target of the filesystem to mount' },
        { name: 'type', type: String, description: 'The filesystem type', alias: 't' },
        { name: 'options', type: String, description: 'The options to pass to the filesystem type', alias: 'o' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await mount({ kernel, shell, terminal, process, args: [argv.args, argv.type, argv.options] })
      }
    }),
    observe: new TerminalCommand({
      command: 'observe',
      description: 'Observe piped streams',
      kernel,
      shell,
      terminal,
      options: [HelpOption],
      run: async (_: CommandLineOptions, process?: Process) => {
        return await observe({ kernel, shell, terminal, process, args: [] })
      }
    }),
    open: new TerminalCommand({
      command: 'open',
      description: 'Open a file or URL',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file or URL to open' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await open({ kernel, shell, terminal, process, args: [argv.path] })
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
    play: new TerminalCommand({
      command: 'play',
      description: 'Play a media file',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'file', type: String, typeLabel: '{underline file}', defaultOption: true, description: 'The path to the media file to play' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await play({ kernel, shell, terminal, process, args: [argv.file] })
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
    umount: new TerminalCommand({
      command: 'umount',
      description: 'Unmount a filesystem',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to unmount' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await umount({ kernel, shell, terminal, process, args: [argv.path] })
      }
    }),
    unzip: new TerminalCommand({
      command: 'unzip',
      description: 'Unzip a file',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file to unzip' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await unzip({ kernel, shell, terminal, process, args: [argv.path] })
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
    user: new TerminalCommand({
      command: 'user',
      description: 'Manage users',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { 
          name: 'command', 
          type: String, 
          defaultOption: true, 
          description: 'Command to run (list, add, del, mod)' 
        },
        { 
          name: 'username', 
          alias: 'u',
          type: String, 
          description: 'Username for the operation',
          typeLabel: '{underline username}'
        },
        { 
          name: 'password', 
          alias: 'p',
          type: String, 
          description: 'Password for add/mod operations',
          typeLabel: '{underline password}'
        }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await user({ kernel, shell, terminal, process, args: [argv.command, argv.username, argv.password] })
      }
    }),
    video: new TerminalCommand({
      command: 'video',
      description: 'Play a video file',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'file', type: String, typeLabel: '{underline file}', defaultOption: true, description: 'The path to the video file to play' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await video({ kernel, shell, terminal, args: [argv.file] })
      }
    }),
    zip: new TerminalCommand({
      command: 'zip',
      description: 'Zip a directory',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'output', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the zip file to create' },
        { name: 'path', type: String, typeLabel: '{underline path}', multiple: true, description: 'The paths to the files or directories to zip' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await zip({ kernel, shell, terminal, process, args: [argv.output, argv.path] })
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

export const env = async ({ shell, terminal, process, args }: CommandArgs) => {
  const [variables, value] = (args as string[])
  if (!variables) {
    for (const [key, value] of shell.env.entries()) {
      await writelnStdout(process, terminal, `${chalk.bold(key)}=${chalk.green(value)}`)
    }
  } else {
    for (const variable of variables) {
      if (!value) {
        await writelnStdout(process, terminal, `${chalk.bold(variable)}=${chalk.green(shell.env.get(variable) || '')}`)
      } else {
        shell.env.set(variable, value)
        globalThis.process.env[variable] = value
      }
    }
  }
}

export const fetch = async ({ shell, terminal, process, args }: CommandArgs) => {
  const [url, filename, method, body] = (args as string[])
  if (!url) {
    await shell.execute('fetch --help')
    return 1
  }

  try {
    const fetchOptions: RequestInit = { method: method || 'GET' }
    if (body) fetchOptions.body = body

    const response = await globalThis.fetch(url, fetchOptions)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    let writer
    if (filename) {
      const fullPath = path.resolve(shell.cwd, filename)
      const fileHandle = await shell.context.fs.promises.open(fullPath, 'w')
      writer = {
        write: async (chunk: Uint8Array) => {
          await fileHandle.write(chunk)
        },
        releaseLock: async () => {
          await fileHandle.close()
        }
      }
    } else writer = process?.stdout?.getWriter()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writer?.write(value)
      }
    } finally {
      reader.releaseLock()
      writer?.releaseLock()
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`))
    return 1
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

export const mount = async ({ kernel, shell, terminal, process, args }: CommandArgs) => {
  const [points, type, config] = (args as string[])
  if (!points || !type || points.length !== 2) {
    await writelnStderr(process, terminal, chalk.red('Usage: mount -t <type> <source> <target>'))

    // TODO: store does not exist on FileSystem (but we can access it here)
    // @ts-ignore
    const currentMounts: string[] = Array.from(kernel.filesystem.fsSync.mounts.entries()).map(([target, mount]) => `${chalk.blue(target)} (${mount.store?.constructor.name || mount.constructor.name}/${mount.metadata().name})`)
    const maxTargetLength = Math.max(...currentMounts.map(mount => mount.split(' ')[0]?.length ?? 0))
    for (const mount of currentMounts) {
      const [target, name] = mount.split(' ')
      if (!target || !name) continue
      await writelnStdout(process, terminal, chalk.gray(`${target.padEnd(maxTargetLength + 2)}${name}`))
    }

    return 1
  }

  const options = config?.split(',').map(option => option.split('='))
    .reduce((acc, [key, value]) => ({ ...acc, [key!]: value }), {})

  const [source, target] = points
  if (!source || !target) {
    await writelnStderr(process, terminal, chalk.red('Usage: mount -t <type> <source> <target>'))
    return 1
  }

  const fullSourcePath = path.resolve(shell.cwd, source)
  const fullTargetPath = path.resolve(shell.cwd, target)

  switch (type.toLowerCase()) {
    case 'fetch':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: Fetch, index: fullSourcePath, baseUrl: (options as { baseUrl?: string })?.baseUrl || '' })); break
    case 'indexeddb':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: IndexedDB, storeName: fullSourcePath })); break
    case 'memory':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: InMemory })); break
    // case 'zip': // TODO: fix issue with @zenfs/archives (bundler renaming Function.name?)
    //   kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: Zip, name: fullSourcePath, data: new Uint8Array(await shell.context.fs.promises.readFile(fullSourcePath)).buffer })); break
  }

  return 0
}

export const observe = async ({ process, terminal }: CommandArgs) => {
  if (!process) throw new Error('Missing process')
  const { stdin, stdout, stderr } = process

  if (!stdin) {
    await writelnStderr(process, terminal, chalk.red('No stdin available'))
    return 1
  }

  const reader = stdin.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Log the incoming data to stderr (observation log)
      const text = decoder.decode(value)
      if (stderr) {
        const errWriter = stderr.getWriter()
        try {
          await errWriter.write(new TextEncoder().encode(chalk.green(`[stdin] ${text.trim()}\n`)))
        } finally {
          errWriter.releaseLock()
        }
      }

      // Pass through to stdout if available
      if (stdout) {
        const writer = stdout.getWriter()
        try {
          await writer.write(value)
        } finally {
          writer.releaseLock()
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return 0
}

export const open = async ({ terminal, process, args }: CommandArgs) => {
  const [filePath] = (args as string[])
  if (!filePath) return 1
  const isURL = !filePath.startsWith('/') || !filePath.startsWith('.')
  if (isURL) window.open(filePath, '_blank')
  else {
    // TODO: handle files
    await writelnStderr(process, terminal, chalk.red('Unsupported path'))
  }
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

export const play = async ({ shell, terminal, process, args }: CommandArgs) => {
  const [file] = (args as string[])
  if (!file || file === '') {
    await writelnStderr(process, terminal, chalk.red('Usage: play <file>'))
    return 1
  }

  const fullPath = path.resolve(shell.cwd, file)
  const blob = new Blob([new Uint8Array(await shell.context.fs.promises.readFile(fullPath))])
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.play()
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

export const umount = async ({ kernel, shell, terminal, process, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  await writelnStdout(process, terminal, `umount ${fullPath}`)
  kernel.filesystem.fsSync.umount(fullPath)
}

export const unzip = async ({ shell, terminal, process, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  const blob = new Blob([new Uint8Array(await shell.context.fs.promises.readFile(fullPath))])
  const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(blob))

  for (const entry of await zipReader.getEntries()) {
    const entryPath = path.resolve(shell.cwd, entry.filename)
    if (entry.directory) {
      await shell.context.fs.promises.mkdir(entryPath)
    } else {
      const writer = new zipjs.Uint8ArrayWriter()
      const data = await entry.getData?.(writer)
      if (!data) {
        await writelnStderr(process, terminal, chalk.red(`Failed to read ${entryPath}`))
        return 1
      }
      await shell.context.fs.promises.writeFile(entryPath, data)
    }
  }

  return 0
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

export const user = async ({ kernel, shell, terminal, process, args }: CommandArgs) => {
  if (shell.credentials.suid !== 0) {
    await writelnStderr(process, terminal, chalk.red('Unauthorized'))
    return 1
  }

  const command = (args as string[])[0]?.toLowerCase()
  const [username, password] = (args as string[]).slice(1)

  if (!command || command.trim() === '') {
    await writelnStderr(process, terminal, chalk.red('Usage: user <command> [options]'))
    await writelnStdout(process, terminal, 'Commands:')
    await writelnStdout(process, terminal, '  list                    List all users')
    await writelnStdout(process, terminal, '  add --username <user>   Add a new user')
    await writelnStdout(process, terminal, '  del --username <user>   Delete a user')
    await writelnStdout(process, terminal, '  mod --username <user>   Modify a user')
    await writelnStdout(process, terminal, '\nYou may specify --password or you will be prompted for it.')
    return 1
  }

  switch (command) {
    case 'list': {
      const users = Array.from(kernel.users.all.values()) as User[]
      
      // Calculate column widths
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
          chalk.blue(usr.groups.join(', '))
        )
      }

      return 0
    }

    case 'add': {
      if (!username) {
        await writelnStderr(process, terminal, chalk.red('Username required'))
        return 1
      }

      const allUsers = Array.from(kernel.users.all.values()) as User[]
      if (allUsers.some((u: User) => u.username === username)) {
        await writelnStderr(process, terminal, chalk.red(`User ${username} already exists`))
        return 1
      }

      let userPassword = password
      if (!userPassword) {
        userPassword = await terminal.readline(chalk.cyan(`Enter password for ${username}: `), true)
        const confirm = await terminal.readline(chalk.cyan('Confirm password: '), true)
        if (userPassword !== confirm) {
          await writelnStderr(process, terminal, chalk.red('Passwords do not match'))
          return 1
        }
      }

      try {
        await kernel.users.add({ username, password: userPassword })
        await writelnStdout(process, terminal, chalk.green(`User ${username} created successfully`))
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    case 'del': {
      if (!username) {
        await writelnStderr(process, terminal, chalk.red('Username required'))
        return 1
      }

      const allUsers = Array.from(kernel.users.all.values()) as User[]
      const usr = allUsers.find((u: User) => u.username === username)
      if (!usr) {
        await writelnStderr(process, terminal, chalk.red(`User ${username} not found`))
        return 1
      }

      // Don't allow deleting root
      if (usr.uid === 0) {
        await writelnStderr(process, terminal, chalk.red('Cannot delete root user'))
        return 1
      }

      try {
        await kernel.users.remove(usr.uid)
        await shell.context.fs.promises.writeFile('/etc/passwd', (await shell.context.fs.promises.readFile('/etc/passwd', 'utf8')).split('\n').filter((line: string) => !line.startsWith(`${username}:`)).join('\n'))
        await shell.context.fs.promises.writeFile('/etc/shadow', (await shell.context.fs.promises.readFile('/etc/shadow', 'utf8')).split('\n').filter((line: string) => !line.startsWith(`${username}:`)).join('\n'))
        await writelnStdout(process, terminal, chalk.green(`User ${username} deleted successfully`))
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    case 'mod': {
      if (!username) {
        await writelnStderr(process, terminal, chalk.red('Username required'))
        return 1
      }

      const allUsers = Array.from(kernel.users.all.values()) as User[]
      const usr = allUsers.find((u: User) => u.username === username)
      if (!usr) {
        await writelnStderr(process, terminal, chalk.red(`User ${username} not found`))
        return 1
      }

      // For now, just allow password changes
      const newPassword = await terminal.readline(chalk.cyan('Enter new password: '), true)
      const confirm = await terminal.readline(chalk.cyan('Confirm new password: '), true)
      
      if (newPassword !== confirm) {
        await writelnStderr(process, terminal, chalk.red('Passwords do not match'))
        return 1
      }

      try {
        await kernel.users.update(usr.uid, { password: newPassword })
        await writelnStdout(process, terminal, chalk.green(`Password updated for ${username}`))
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    default:
      await writelnStderr(process, terminal, chalk.red(`Unknown command: ${command}`))
      return 1
  }
}

export const video = async ({ kernel, shell, args }: CommandArgs) => {
  const file = (args as string[])[0]
  const fullPath = file ? path.resolve(shell.cwd, file) : shell.cwd

  const blob = new Blob([new Uint8Array(await shell.context.fs.promises.readFile(fullPath))])
  const url = URL.createObjectURL(blob)

  // Load video metadata to get dimensions
  const video = document.createElement('video')
  video.src = url
  await new Promise(resolve => { video.onloadedmetadata = resolve })

  const { videoWidth, videoHeight } = video
  const { innerWidth, innerHeight } = window
  const shouldMaximize = videoWidth > innerWidth || videoHeight > innerHeight

  kernel.windows.create({
    title: file,
    html: `<video src="${url}" autoplay controls style="width:100%;height:100%"></video>`,
    width: shouldMaximize ? innerWidth : videoWidth,
    height: shouldMaximize ? innerHeight : videoHeight,
    max: shouldMaximize
  })
}

export const zip = async ({ shell, terminal, process, args }: CommandArgs) => {
  const [output, paths = []] = args as [string, string[]]
  if (!output || paths.length === 0) {
    await writelnStdout(process, terminal, 'Usage: zip <output> <paths...>')
    return 1
  }

  const outputPath = path.resolve(shell.cwd, output)
  let zipWriter: zipjs.ZipWriter<Blob> | null = null

  try {
    zipWriter = new zipjs.ZipWriter(new zipjs.BlobWriter())

    for (const inputPath of paths) {
      const fullPath = path.resolve(shell.cwd, inputPath)
      
      try {
        const fileStat = await shell.context.fs.promises.stat(fullPath)

        if (fileStat.isFile()) {
          // Add single file
          const relativePath = path.relative(shell.cwd, fullPath)
          const fileData = await shell.context.fs.promises.readFile(fullPath)
          const reader = new zipjs.Uint8ArrayReader(fileData)
          await zipWriter.add(relativePath, reader)
          await writelnStdout(process, terminal, `Added file: ${relativePath}`)
        } else if (fileStat.isDirectory()) {
          // Add directory and contents recursively
          async function addDirectory(dirPath: string) {
            const entries = await shell.context.fs.promises.readdir(dirPath)
            
            for (const entry of entries) {
              const entryPath = path.join(dirPath, entry)
              const relativePath = path.relative(shell.cwd, entryPath)
              const entryStat = await shell.context.fs.promises.stat(entryPath)
              
              if (entryStat.isFile()) {
                const fileData = await shell.context.fs.promises.readFile(entryPath)
                const reader = new zipjs.Uint8ArrayReader(fileData)
                await zipWriter?.add(relativePath, reader)
                await writelnStdout(process, terminal, `Added file: ${relativePath}`)
              } else if (entryStat.isDirectory()) {
                await addDirectory(entryPath)
              }
            }
          }

          await addDirectory(fullPath)
          await writelnStdout(process, terminal, `Added directory: ${path.relative(shell.cwd, fullPath)}`)
        } else {
          await writelnStdout(process, terminal, `Skipping ${inputPath}: Not a file or directory`)
        }
      } catch (err: unknown) {
        await writelnStderr(process, terminal, `Error processing ${inputPath}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Write the zip file
    const blob = await zipWriter.close()
    zipWriter = null // Clear reference after closing
    await shell.context.fs.promises.writeFile(outputPath, new Uint8Array(await blob.arrayBuffer()))
    await writelnStdout(process, terminal, `Created zip file: ${output}`)

    return 0
  } catch (err: unknown) {
    await writelnStderr(process, terminal, `Failed to create zip file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    return 1
  } finally {
    if (zipWriter) {
      await zipWriter.close()
    }
  }
}
