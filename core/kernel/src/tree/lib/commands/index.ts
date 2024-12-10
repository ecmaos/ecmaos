/**
 * This file represents the commands provided by the terminal itself.
 * 
 * @remarks
 * TODO: Eventually this will be refactored to have a more consistent (and familiar) CLI interface.
 * This file is getting large and many larger commands are being moved to their own files or packages.
 * I think simple commands should still be bundled together though, to reduce the need for file jumping.
 * Although it looks unweildy, if your editor supports code folding, a simple Fold All makes it much easier to navigate.
 * Looking for a command definition in two places might be annoying, but just use this trick:
 * Ctrl-F "command:" (colon) for the TerminalCommand definition and Ctrl-F "command =" (equals) for the command implementation.
 *
 */

import ansi from 'ansi-escape-sequences'
import chalk from 'chalk'
import humanFormat from 'human-format'
import parseArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args'
import parseUsage from 'command-line-usage'
import { openai, streamText } from 'modelfusion' // modelfusion is a little heavy - all ai features will be moved to an app; here for demo
import path from 'path'
// import * as textCanvas from '@thi.ng/text-canvas'
// import * as textFormat from '@thi.ng/text-format'
// import * as jose from 'jose'
import * as zipjs from '@zip.js/zip.js'

import { createCredentials, Fetch, InMemory, resolveMountConfig, useCredentials, Stats } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'
import { Zip } from '@zenfs/archives'

import {
  KernelEvents,
  TerminalCommand as ITerminalCommand,
  TerminalEvents
} from '@ecmaos/types'

import type {
  Kernel,
  Process,
  Shell,
  Terminal,
  User
} from '@ecmaos/types'

/**
 * The arguments passed to a command.
 */
export interface CommandArgs {
  process?: Process
  stdin?: ReadableStream<Uint8Array>
  stdout?: WritableStream<Uint8Array>
  stderr?: WritableStream<Uint8Array>
  kernel: Kernel
  shell: Shell
  terminal: Terminal
  args: string[] | CommandLineOptions
}

/**
 * The TerminalCommand class sets up a common interface for builtin terminal commands
 */
export class TerminalCommand implements ITerminalCommand {
  command: string = ''
  description: string = ''
  kernel: Kernel
  options: OptionDefinition[] = []
  run: (pid: number, argv: string[]) => Promise<number | void>
  shell: Shell
  terminal: Terminal
  stdin?: ReadableStream<Uint8Array>
  stdout?: WritableStream<Uint8Array>
  stderr?: WritableStream<Uint8Array>

  constructor({ command, description, kernel, options, run, shell, terminal, stdin, stdout, stderr }: {
    command: string
    description: string
    kernel: Kernel
    options: parseUsage.OptionDefinition[]
    run: (argv: CommandLineOptions, process?: Process) => Promise<number | void>
    shell: Shell
    terminal: Terminal
    stdin?: ReadableStream<Uint8Array>
    stdout?: WritableStream<Uint8Array>
    stderr?: WritableStream<Uint8Array>
  }) {
    this.command = command
    this.description = description
    this.kernel = kernel
    this.options = options
    this.shell = shell
    this.terminal = terminal
    this.stdin = stdin
    this.stdout = stdout
    this.stderr = stderr

    this.run =  async (pid: number, argv: string[]) => {
      if (argv === null) return 1
      try {
        const parsed = parseArgs(this.options, { argv })
        if (parsed.help) {
          this.terminal.writeln(this.usage)
          return 0
        }

        const process = this.kernel.processes.get(pid)
        return await run(parsed, process)
      } catch (error) {
        this.terminal.writeln(chalk.red(error))
        return 1
      }
    }
  }

  get usage() {
    return parseUsage([
      { header: this.command, content: this.description },
      { header: 'Usage', content: this.usageContent },
      { header: 'Options', optionList: this.options }
    ])
  }

  get usageContent() {
    return `${this.command} ${this.options.map(option => {
      let optionStr = option.name
      if (option.type === Boolean) optionStr = `[--${option.name}]`
      else if (option.type === String) optionStr = option.defaultOption ? `<${option.name}>` : `[--${option.name} <value>]`

      if (option.multiple) optionStr += '...'
      return optionStr
    }).join(' ')}`
  }
}

/**
 * The TerminalCommands function creates the set of builtin terminal commands.
 */
export const TerminalCommands = (kernel: Kernel, shell: Shell, terminal: Terminal): { [key: string]: TerminalCommand } => {
  const HelpOption = { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') }

  return {
    ai: new TerminalCommand({
      command: 'ai',
      description: 'Access an AI',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'prompt', type: String, defaultOption: true, description: 'The prompt to send to the AI' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await ai({ kernel, shell, terminal, process, args: [argv.prompt] })
      }
    }),
    cat: new TerminalCommand({
      command: 'cat',
      description: 'Concatenate files and print on the standard output',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to concatenate' },
        { name: 'bytes', type: Number, description: 'The number of bytes to read from the file' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await cat({ kernel, shell, terminal, process, args: [argv.path, argv.bytes] })
      }
    }),
    cd: new TerminalCommand({
      command: 'cd',
      description: 'Change the shell working directory',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to change to' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await cd({ kernel, shell, terminal, args: [argv.path || shell.cwd] })
      }
    }),
    chmod: new TerminalCommand({
      command: 'chmod',
      description: 'Change file mode bits',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The mode and path to the file or directory' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await chmod({ kernel, shell, terminal, args: argv.args })
      }
    }),
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
    cp: new TerminalCommand({
      command: 'cp',
      description: 'Copy files',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The source and destination paths' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await cp({ kernel, shell, terminal, args: argv.args })
      }
    }),
    df: new TerminalCommand({
      command: 'df',
      description: 'Display disk space usage',
      kernel,
      shell,
      terminal,
      options: [],
      run: async () => {
        return await df({ kernel, shell, terminal, args: [] })
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
      run: async (argv: CommandLineOptions) => {
        return await download({ kernel, shell, terminal, args: argv.path })
      }
    }),
    echo: new TerminalCommand({
      command: 'echo',
      description: 'Print arguments to the standard output',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'text', type: String, typeLabel: '{underline text}', defaultOption: true, multiple: true, description: 'The text to print' }
      ],
      run: async (argv: CommandLineOptions, process?: Process) => {
        return await echo({ kernel, shell, terminal, process, args: argv.text })
      }
    }),
    edit: new TerminalCommand({
      command: 'edit',
      description: 'Edit a file',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file to edit' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await edit({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await env({ kernel, shell, terminal, args: [argv.variables, argv.set] })
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
        { name: 'registry', type: String, description: 'The registry to use', defaultValue: 'https://registry.npmjs.org' }
      ],
      run: async (argv: CommandLineOptions) => {
        const { default: install } = await import('./install')
        return await install({ kernel, shell, terminal, args: [argv.package, argv.registry] })
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
    ls: new TerminalCommand({
      command: 'ls',
      description: 'List directory contents',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to list' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await ls({ kernel, shell, terminal, args: [argv.path || shell.cwd] })
      }
    }),
    mkdir: new TerminalCommand({
      command: 'mkdir',
      description: 'Create a directory',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to create' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await mkdir({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await mount({ kernel, shell, terminal, args: [argv.args, argv.type, argv.options] })
      }
    }),
    mv: new TerminalCommand({
      command: 'mv',
      description: 'Move or rename files',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'args', type: String, multiple: true, defaultOption: true, description: 'The source and destination paths' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await mv({ kernel, shell, terminal, args: argv.args })
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
      run: async (argv: CommandLineOptions) => {
        return await open({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await passwd({ kernel, shell, terminal, args: argv.password })
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
      run: async (argv: CommandLineOptions) => {
        return await play({ kernel, shell, terminal, args: [argv.file] })
      }
    }),
    ps: new TerminalCommand({
      command: 'ps',
      description: 'List all running processes',
      kernel,
      shell,
      terminal,
      options: [],
      run: async () => {
        return await ps({ kernel, shell, terminal, args: [] })
      }
    }),
    pwd: new TerminalCommand({
      command: 'pwd',
      description: 'Print the shell working directory',
      kernel,
      shell,
      terminal,
      options: [],
      run: async () => {
        return await pwd({ kernel, shell, terminal, args: [] })
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
    rm: new TerminalCommand({
      command: 'rm',
      description: 'Remove files or directories',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file or directory to remove' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await rm({ kernel, shell, terminal, args: [argv.path] })
      }
    }),
    rmdir: new TerminalCommand({
      command: 'rmdir',
      description: 'Remove a directory',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the directory to remove' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await rmdir({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await screensaver({ kernel, shell, terminal, args: [argv.screensaver, argv.set] })
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
    socket: new TerminalCommand({
      command: 'socket',
      description: 'Send a message to the terminal socket',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'command', type: String, defaultOption: true, description: 'The command to send to the terminal socket' },
        { name: 'args', type: String, multiple: true, description: 'The arguments to send to the command' }
      ],
      run: async () => {
        return await socket()
        // return await socket({ kernel, shell, terminal, args: [argv.command, argv.args] })
      }
    }),
    stat: new TerminalCommand({
      command: 'stat',
      description: 'Display information about a file or directory',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file or directory to display' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await stat({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await su({ kernel, shell, terminal, args: [argv.user] })
      }
    }),
    touch: new TerminalCommand({
      command: 'touch',
      description: 'Create an empty file',
      kernel,
      shell,
      terminal,
      options: [
        HelpOption,
        { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file to create' }
      ],
      run: async (argv: CommandLineOptions) => {
        return await touch({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await umount({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await unzip({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await upload({ kernel, shell, terminal, args: [argv.path] })
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
      run: async (argv: CommandLineOptions) => {
        return await user({ kernel, shell, terminal, args: [argv.command, argv.username, argv.password] })
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
      run: async (argv: CommandLineOptions) => {
        return await zip({ kernel, shell, terminal, args: [argv.output, argv.path] })
      }
    }),
  }
}

export const ai = async ({ process, args }: CommandArgs) => {
  const [prompt] = (args as string[])
  if (!prompt) return 1

  const stream = await streamText({
    model: openai.CompletionTextGenerator({ model: 'gpt-3.5-turbo-instruct', maxGenerationTokens: 1000 }),
    prompt
  })

  for await (const chunk of stream) {
    const writer = process?.stdout.getWriter()
    if (writer) await writer.write(new TextEncoder().encode(chunk))
    writer?.releaseLock()
  }

  const writer = process?.stdout.getWriter()
  if (writer) await writer.write(new TextEncoder().encode('\n'))
  writer?.releaseLock()
  return 0
}

export const cat = async ({ kernel, shell, process, args }: CommandArgs) => {
  if (!process) return 1

  // FIXME: input redirection doesn't work

  // Get a single writer for the entire operation
  const writer = process.stdout.getWriter()

  try {
    // If no files specified, try reading from stdin
    if (!args || !(args as string[])[0]) {
      const reader = process.stdin.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          await writer.write(value)
        }
      } finally {
        reader.releaseLock()
      }

      return 0
    }

    // Otherwise process files
    const [files = [], bytes] = args as [string[], string]
    for (const file of files) {
      const fullPath = path.resolve(shell.cwd, file)

      let interrupted = false
      const interruptHandler = () => { interrupted = true }
      kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

      try {
        if (!fullPath.startsWith('/dev')) {
          const handle = await kernel.filesystem.fs.open(fullPath)
          const stat = await kernel.filesystem.fs.stat(fullPath)

          let bytesRead = 0
          const chunkSize = 1024

          while (bytesRead < stat.size) {
            if (interrupted) break
            const data = new Uint8Array(chunkSize)
            const readSize = Math.min(chunkSize, stat.size - bytesRead)
            await kernel.filesystem.fsSync.read(handle.fd, data, 0, readSize, bytesRead)
            await writer.write(data.subarray(0, readSize))
            bytesRead += readSize
          }
        } else {
          const device = await kernel.filesystem.fs.open(fullPath)
          const maxBytes = bytes ? parseInt(bytes) : undefined
          let totalBytesRead = 0
          const chunkSize = 1024
          const data = new Uint8Array(chunkSize)
          let bytesRead = 0

          do {
            if (interrupted) break
            const result = await device.read(data)
            bytesRead = result.bytesRead
            if (bytesRead > 0) {
              const bytesToWrite = maxBytes ? Math.min(bytesRead, maxBytes - totalBytesRead) : bytesRead
              if (bytesToWrite > 0) {
                await writer.write(data.subarray(0, bytesToWrite))
                totalBytesRead += bytesToWrite
              }
            }
          } while (bytesRead > 0 && (!maxBytes || totalBytesRead < maxBytes))
        }
      } finally {
        kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      }
    }

    return 0
  } finally {
    writer.releaseLock()
  }
}

export const cd = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const destination = (args as string[])[0]
  const fullPath = destination ? path.resolve(shell.cwd, destination) : shell.cwd
  if (await kernel.filesystem.fs.exists(fullPath)) shell.cwd = fullPath
  else terminal.writeln(chalk.red(`${fullPath} not found`))
}

export const chmod = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  if (!args || (args as string[]).length === 0) {
    terminal.writeln(chalk.red('chmod: missing operand'))
    terminal.writeln('Try \'chmod --help\' for more information.')
    return 1
  }

  const [mode, target] = (args as string[])
  if (!mode || !target) return 1
  const fullPath = path.resolve(shell.cwd, target)
  await kernel.filesystem.fs.chmod(fullPath, mode)
  return 0
}

export const chown = async ({ kernel, shell, args }: CommandArgs) => {
  const [user, target, group] = (args as string[])
  if (!user || !target) return 1
  const fullPath = path.resolve(shell.cwd, target)
  kernel.filesystem.fsSync.chownSync(fullPath, parseInt(user), parseInt(group ?? user))
}

export const clear = async ({ terminal }: CommandArgs) => {
  terminal.write('\x1b[2J\x1b[H')
}

export const cp = async ({ kernel, shell, args }: CommandArgs) => {
  const [source, destination] = (args as string[]).map(arg => path.resolve(shell.cwd, arg))
  if (!source || !destination) return 1
  const destinationStats = await kernel.filesystem.fs.stat(destination).catch(() => null)
  // 🪵⛟
  const finalDestination = destinationStats?.isDirectory() ? path.join(destination, path.basename(source)) : destination
  await kernel.filesystem.fs.copyFile(source, finalDestination)
}

export const df = async ({ kernel, terminal }: CommandArgs) => {
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
  terminal.writeln(JSON.stringify(data, null, 2))
  return 0
}

export const download = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const destination = (args as string[])[0]
  const fullPath = destination ? path.resolve(shell.cwd, destination) : shell.cwd
  if (await kernel.filesystem.fs.exists(fullPath)) {
    const data = await kernel.filesystem.fs.readFile(fullPath)
    const blob = new Blob([data], { type: 'application/octet-stream' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')

    a.href = url
    a.download = path.basename(fullPath)
    a.click()
    window.URL.revokeObjectURL(url)
  } else {
    terminal.writeln(chalk.red(`${fullPath} not found`))
  }
}

export const echo = async ({ process, terminal, args }: CommandArgs) => {
  const text = (args as string[]).join(' ')
  const data = new TextEncoder().encode(text + '\n')

  // Create a readable stream that will be consumed
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(data)
      controller.close()
    }
  })
  
  // If we have a process, pipe to its stdout, otherwise write to terminal
  if (process) {
    readable.pipeTo(process.stdout).catch(() => {})
  } else {
    terminal.write(text + '\n')
  }

  return 0
}

// TODO: This was going to be smaller - move it to a package
// FIXME: Pasting does not work correctly
export const edit = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const target = (args as string[])[0]
  if (!target) return 1
  const fullPath = path.resolve(shell.cwd, target)
  const content = await kernel.filesystem.fs.readFile(fullPath, 'utf-8').catch(() => '')
  const lines = content.split('\n')

  let cursorX = 0
  let cursorY = 0
  let message: string | undefined
  let mode = 'normal'
  let startLine = 0

  const renderScreen = () => {
    terminal.write(ansi.erase.display(2) + ansi.cursor.position(0, 0))
    const visibleLines = lines.slice(startLine, startLine + terminal.rows - 1)
    visibleLines.forEach((line: string) => terminal.writeln(line))

    let modeColor = chalk.gray
    switch (mode) {
      case 'insert': modeColor = chalk.green; break
      case 'replace': modeColor = chalk.red; break
    }

    if (!message) terminal.write(modeColor(`-- ${mode.toUpperCase()} MODE (${cursorY + 1}, ${cursorX + 1}) = ${lines[cursorY]?.[cursorX] ?? ''} --`))
    else terminal.write(`--- ${message} ---`)

    if (message) message = undefined
    terminal.write(`\x1b[${cursorY - startLine + 1};${cursorX + 1}H`)
  }

  const handleNormalMode = async (event: KeyboardEvent) => {
    switch (event.key) {
      case 'Insert':
      case 'i':
        mode = 'insert'; break
      case 'r':
        mode = 'replace'; break
      case 'ArrowLeft':
      case 'h':
        cursorX = Math.max(0, cursorX - 1)
        break
      case 'ArrowDown':
      case 'j':
        if (cursorY < lines.length - 1) {
          cursorY++
          if (cursorY >= startLine + terminal.rows - 1) startLine++
        }
        break
      case 'ArrowUp':
      case 'k':
        if (cursorY > 0) {
          cursorY--
          if (cursorY < startLine) {
            startLine--
          }
        }
        break
      case 'ArrowRight':
      case 'l':
        cursorX = lines[cursorY]?.length === 0 ? 0 : Math.min((lines[cursorY]?.length ?? 1) - 1, cursorX + 1)
        break
      case 'Home':
        cursorX = 0
        break
      case 'End':
        cursorX = (lines[cursorY]?.length ?? 0) - 1
        break
      case 'PageUp':
        if (cursorY > 0) {
          const pageSize = terminal.rows - 2
          cursorY = Math.max(0, cursorY - pageSize)
          startLine = Math.max(0, startLine - pageSize)
          if (cursorY < startLine) {
            startLine = cursorY
          }
        }
        break
      case 'PageDown':
        if (cursorY < lines.length - 1) {
          const pageSize = terminal.rows - 2
          cursorY = Math.min(lines.length - 1, cursorY + pageSize)
          startLine = Math.min(lines.length - pageSize, startLine + pageSize)
          if (cursorY >= startLine + pageSize) {
            startLine = cursorY - pageSize + 1
          }
        }
        break
      case 'Delete':
      case 'd':
        if (cursorX < (lines[cursorY]?.length ?? 0)) {
          lines[cursorY] = (lines[cursorY]?.slice(0, cursorX) ?? '') + (lines[cursorY]?.slice(cursorX + 1) ?? '')
        } else if (cursorY < (lines.length - 1)) {
          lines[cursorY] += lines[cursorY + 1] ?? ''
          lines.splice(cursorY + 1, 1)
        }
        break
      case ':':
        terminal.write(ansi.cursor.position(terminal.rows, 0) + ansi.erase.inLine())
        // TODO: Figure out if I want to remove no-case-declarations rule or refactor these
        const cmdLine = await terminal.readline(':', false, true) // eslint-disable-line no-case-declarations
        const lineNum = parseInt(cmdLine) // eslint-disable-line no-case-declarations
        if (!isNaN(lineNum)) {
          const targetLine = Math.max(0, Math.min(lines.length - 1, lineNum - 1))
          if (targetLine < startLine || targetLine >= startLine + terminal.rows - 1)
            startLine = Math.max(0, Math.min(lines.length - terminal.rows + 1, targetLine - Math.floor((terminal.rows - 1) / 2)))

          cursorY = targetLine
        } else for (const command of cmdLine.split('')) {
          switch (command) {
            case 'w':
              message = chalk.green(`Saved to ${fullPath}`)
              await kernel.filesystem.fs.writeFile(fullPath, lines.join('\n'))
              break
            case 'q':
              return true
          }
        }
        break
      case 'v':
        if (!event.ctrlKey) break
        try {
          const clipboardText = await navigator.clipboard.readText()
          const clipboardLines = clipboardText.split('\n')
          lines.splice(cursorY, 0, ...clipboardLines)
          message = chalk.green('Pasted text')
        } catch (err) {
          message = chalk.red('Failed to paste: ' + (err instanceof Error ? err.message : 'Unknown error'))
        }
        break
    }

    return false
  }

  const handleEditMode = (event: KeyboardEvent, replace: boolean = false) => {
    switch (event.key) {
      case 'Insert':
        mode = replace ? 'insert' : 'replace'
        break
      case 'Escape':
        mode = 'normal'; break
      case 'Home':
        cursorX = 0; break
      case 'End':
        cursorX = (lines[cursorY]?.length ?? 0); break
      case 'PageUp':
        if (cursorY > 0) {
          const pageSize = terminal.rows - 2
          cursorY = Math.max(0, cursorY - pageSize)
          startLine = Math.max(0, startLine - pageSize)
          if (cursorY < startLine) {
            startLine = cursorY
          }
        }
        break
      case 'PageDown':
        if (cursorY < lines.length - 1) {
          const pageSize = terminal.rows - 2
          cursorY = Math.min(lines.length - 1, cursorY + pageSize)
          startLine = Math.min(lines.length - pageSize, startLine + pageSize)
          if (cursorY >= startLine + pageSize) {
            startLine = cursorY - pageSize + 1
          }
        }
        break
      case 'Enter':
        lines.splice(cursorY + 1, 0, lines[cursorY]?.slice(cursorX) ?? '')
        lines[cursorY] = lines[cursorY]?.slice(0, cursorX) ?? ''
        cursorY++
        cursorX = 0
        break
      case 'Backspace':
        if (cursorX > 0) {
          lines[cursorY] = (lines[cursorY]?.slice(0, cursorX - 1) ?? '') + (lines[cursorY]?.slice(cursorX) ?? '')
          cursorX--
        } else if (cursorY > 0) {
          cursorX = (lines[cursorY - 1]?.length ?? 0) - 1
          lines[cursorY - 1] += lines[cursorY] ?? ''
          lines.splice(cursorY, 1)
          cursorY--
        }
        break
      case 'Delete':
        if (cursorX < (lines[cursorY]?.length ?? 0)) {
          lines[cursorY] = (lines[cursorY]?.slice(0, cursorX) ?? '') + (lines[cursorY]?.slice(cursorX + 1) ?? '')
        } else if (cursorY < (lines.length - 1)) {
          lines[cursorY] += lines[cursorY + 1] ?? ''
          lines.splice(cursorY + 1, 1)
        }
        break
      case 'ArrowLeft':
        cursorX = Math.max(0, cursorX - 1)
        break
      case 'ArrowUp':
        if (cursorY > 0) {
          cursorY--
          cursorX = Math.min((lines[cursorY]?.length ?? 0), cursorX)
        }
        break
      case 'ArrowDown':
        if (cursorY < lines.length - 1) {
          cursorY++
          cursorX = Math.min((lines[cursorY]?.length ?? 0), cursorX)
        }
        break
      case 'ArrowRight':
        cursorX = Math.min((lines[cursorY]?.length ?? 0), cursorX + 1)
        break
      case 'v':
        if (event.ctrlKey || event.metaKey) {
          navigator.clipboard.readText().then(clipboardText => {
            const clipboardLines = clipboardText.split('\n')
            if (replace) {
              // Replace mode - overwrite existing lines
              lines.splice(cursorY, clipboardLines.length, ...clipboardLines)
            } else {
              // Insert mode - insert at cursor position
              const currentLine = lines[cursorY] ?? ''
              const beforeCursor = currentLine.slice(0, cursorX)
              const afterCursor = currentLine.slice(cursorX)
              
              // Handle first line
              lines[cursorY] = beforeCursor + clipboardLines[0]
              
              // Insert remaining lines
              if (clipboardLines.length > 1) {
                const remainingLines = clipboardLines.slice(1)
                remainingLines[remainingLines.length - 1] += afterCursor
                lines.splice(cursorY + 1, 0, ...remainingLines)
              } else {
                lines[cursorY] += afterCursor
              }
              
              cursorY += clipboardLines.length - 1
              cursorX = clipboardLines[clipboardLines.length - 1]?.length ?? 0
            }
          }).catch(err => {
            message = chalk.red('Failed to paste: ' + err.message)
          })
        } else {
          if (replace) lines[cursorY] = (lines[cursorY]?.slice(0, cursorX) ?? '') + event.key + (lines[cursorY]?.slice(cursorX + 1) ?? '')
          else lines[cursorY] = (lines[cursorY]?.slice(0, cursorX) ?? '') + event.key + (lines[cursorY]?.slice(cursorX) ?? '')
          cursorX++
        }
        break
      default:
        if (replace) lines[cursorY] = (lines[cursorY]?.slice(0, cursorX) ?? '') + event.key + (lines[cursorY]?.slice(cursorX + 1) ?? '')
        else lines[cursorY] = (lines[cursorY]?.slice(0, cursorX) ?? '') + event.key + (lines[cursorY]?.slice(cursorX) ?? '')
        cursorX++
    }
  }

  let active = true
  terminal.unlisten()
  while (active) {
    renderScreen()
    const { domEvent } = await new Promise<{ domEvent: KeyboardEvent }>(resolve => terminal.onKey(resolve))

    switch (mode) {
      case 'normal':
        if (await handleNormalMode(domEvent)) active = false
        break
      case 'insert':
        handleEditMode(domEvent)
        break
      case 'replace':
        handleEditMode(domEvent, true)
        break
    }
  }

  terminal.write(ansi.erase.display(2) + ansi.cursor.position())
  terminal.listen()
}

export const env = async ({ shell, terminal, args }: CommandArgs) => {
  const [variables, value] = (args as string[])
  if (!variables) {
    for (const [key, value] of shell.env.entries()) terminal.writeln(`${chalk.bold(key)}=${chalk.green(value)}`)
  } else {
    for (const variable of variables) {
      if (!value) terminal.writeln(`${chalk.bold(variable)}=${chalk.green(shell.env.get(variable) || '')}`)
      else {
        shell.env.set(variable, value)
        globalThis.process.env[variable] = value
      }
    }
  }
}

export const fetch = async ({ kernel, shell, terminal, process, args }: CommandArgs) => {
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
      const fullPath = path.resolve(kernel.shell.cwd, filename)
      const fileHandle = await kernel.filesystem.fs.open(fullPath, 'w')
      writer = {
        write: (chunk: Uint8Array) => {
          kernel.filesystem.fsSync.write(fileHandle.fd, chunk)
        },
        releaseLock: async () => {
          await kernel.filesystem.fsSync.close(fileHandle.fd)
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
      terminal.write('\n')
    }

    return 0
  } catch (error) {
    terminal.writeln(chalk.red(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`))
    return 1
  }
}

export const load = async ({ kernel, shell, args }: CommandArgs) => {
  const [target] = (args as string[])
  if (!target) {
    await shell.execute('load --help')
    return 1
  }

  const fullPath = path.resolve(shell.cwd, target)
  const code = await kernel.filesystem.fs.readFile(fullPath, 'utf-8')
  const script = new Function(code)
  script()
}

export const ls = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target === '' ? '.' : target) : shell.cwd
  const stats = await kernel.filesystem.fs.stat(fullPath)
  const entries: string[] = stats.isDirectory() ? await kernel.filesystem.fs.readdir(fullPath) : [fullPath]
  const descriptions = kernel.filesystem.descriptions(kernel.i18n.t)

  const getModeType = (stats: Stats) => {
    let type = '-'
    if (stats.isDirectory()) type = 'd'
    else if (stats.isSymbolicLink()) type = 'l'
    else if (stats.isBlockDevice()) type = 'b'
    else if (stats.isCharacterDevice()) type = 'c'
    else if (stats.isFIFO()) type = 'p'
    else if (stats.isSocket()) type = 's'
    return type
  }

  const getModeString = (stats: Stats) => {
    return getModeType(stats) + (stats.mode & parseInt('777', 8)).toString(8).padStart(3, '0')
      .replace(/0/g, '---')
      .replace(/1/g, '--' + chalk.red('x'))
      .replace(/2/g, '-' + chalk.yellow('w') + '-')
      .replace(/3/g, '-' + chalk.yellow('w') + chalk.red('x'))
      .replace(/4/g, chalk.green('r') + '--')
      .replace(/5/g, chalk.green('r') + '-' + chalk.red('x'))
      .replace(/6/g, chalk.green('r') + chalk.yellow('w') + '-')
      .replace(/7/g, chalk.green('r') + chalk.yellow('w') + chalk.red('x'))
  }

  const getTimestampString = (timestamp: Date) => {
    const diff = (new Date().getTime() - timestamp.getTime()) / 1000

    if (diff < 24 * 60 * 60) return chalk.green(timestamp.toISOString().slice(0, 19).replace('T', ' '))
    else if (diff < 7 * 24 * 60 * 60) return chalk.yellow(timestamp.toISOString().slice(0, 19).replace('T', ' '))
    else if (diff < 30 * 24 * 60 * 60) return chalk.blue(timestamp.toISOString().slice(0, 19).replace('T', ' '))
    else if (diff < 365 * 24 * 60 * 60) return chalk.magenta(timestamp.toISOString().slice(0, 19).replace('T', ' '))
    else return chalk.gray(timestamp.toISOString().slice(0, 19).replace('T', ' '))
  }

  const getOwnerString = (stats: Stats) => {
    const owner = kernel.users.all.get(stats.uid) || kernel.users.all.get(0)

    if (owner?.username === shell.username) return chalk.green(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
    else if (stats.uid === 0) return chalk.red(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
    else return chalk.gray(`${owner?.username || stats.uid}:${owner?.username || stats.gid}`)
  }

  const mounts = Array.from(kernel.filesystem.fsSync.mounts.entries() as [string, FileSystem][])
    .filter(([target]) => path.dirname(target) === fullPath && target !== '/')

  // const files = entries
  //   .map(entry => {
  //     const target = path.resolve(fullPath, entry)
  //     try { return { target, name: entry, stats: kernel.filesystem.fsSync.statSync(target) } }
  //     catch (err) { kernel.log?.warn(err); return null }
  //   })
  //   .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)
  //   .filter(entry => !entry.stats.isDirectory())

  const filesMap = await Promise.all(entries
    // .filter(entry => !entry.startsWith('/'))
    .map(async entry => {
      const target = path.resolve(fullPath, entry)
      return { target, name: entry, stats: await kernel.filesystem.fs.stat(target) }
    }))

  const files = filesMap
    .filter(entry => !entry.stats.isDirectory())
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

  // const directories = entries
  //   .map(entry => {
  //     const target = path.resolve(fullPath, entry)
  //     try { return { target, name: entry, stats: kernel.filesystem.fsSync.statSync(target) } }
  //     catch (err) { kernel.log?.warn(err); return null }
  //   })
  //   .filter(entry => entry && entry.stats.isDirectory())
  //   .concat(mounts.map(([target]) => ({
  //     target,
  //     name: path.basename(target),
  //     stats: { isDirectory: () => true, mtime: new Date(), mode: 0o755 } as Stats
  //   })))
  //   .filter((entry, index, self) => self.findIndex(e => e?.name === entry?.name) === index)
  //   .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

  const directoryMap = await Promise.all(entries
    // .filter(entry => entry.startsWith('/'))
    .map(async entry => {
      const target = path.resolve(fullPath, entry)
      return { target, name: entry, stats: await kernel.filesystem.fs.stat(target) }
    }))

  const directories = directoryMap
    .filter(entry => entry.stats.isDirectory())
    .concat(mounts.map(([target]) => ({
      target,
      name: path.basename(target),
      stats: { isDirectory: () => true, mtime: new Date(), mode: 0o755 } as Stats
    })))
    .filter((entry, index, self) => self.findIndex(e => e?.name === entry?.name) === index)
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry !== undefined)

  const data = [
    ['Name', 'Size', 'Modified', 'Mode', 'Owner', 'Info'],
    ...directories.sort((a, b) => a.name.localeCompare(b.name)).map(directory => {
      return [
        directory.name,
        '',
        getTimestampString(directory.stats.mtime),
        getModeString(directory.stats),
        getOwnerString(directory.stats),
        (() => {
          const mount = mounts.find(([target]) => target.endsWith(`/${directory.name}`))
          // TODO: store does not exist on FileSystem (but we can access it here)
          // @ts-ignore
          if (mount) return chalk.white(`(${mount[1].store?.constructor.name || mount[1].constructor.name}/${mount[1].metadata().name})`)
          return descriptions.get(path.resolve(fullPath, directory.name)) || ''
        })()
      ]
    }),
    ...files.sort((a, b) => a.name.localeCompare(b.name)).map(file => {
      return [
        file.name,
        humanFormat(file.stats.size),
        getTimestampString(file.stats.mtime),
        getModeString(file.stats),
        getOwnerString(file.stats),
        (() => {
          if (descriptions.has(path.resolve(fullPath, file.name))) return descriptions.get(path.resolve(fullPath, file.name))
          const ext = file.name.split('.').pop()
          if (ext && descriptions.has('.' + ext)) return descriptions.get('.' + ext)
          if (file.stats.isBlockDevice() || file.stats.isCharacterDevice()) {
            // TODO: zenfs `fs.mounts` is deprecated - use a better way of getting device info
            const device = kernel.filesystem.devfs.devices.get(`/${file.name}`)
            const kdevice = kernel.devices.get(file.name)
            const description = kdevice?.device.pkg?.description || ''
            const version = kdevice?.device.pkg?.version || ''
            if (device) return `${description ? `${description}:` : ''}${version ? `v${version}:` : ''}M${device.major ?? '?'},m${device.minor ?? '?'}`
          }
          return ''
        })()
      ]
    })
  ] as string[][]

  // Special output for certain directories
  if (fullPath.startsWith('/dev')) data.forEach(row => row.splice(1, 2)) // remove size and modified columns

  const columnWidths = data[0]?.map((_, colIndex) => Math.max(...data.map(row => {
    // Remove ANSI escape sequences before calculating length
    const cleanedCell = row[colIndex]?.replace(/\u001b\[.*?m/g, '')
    // count all emojis as two characters
    return cleanedCell?.length || 0
  })))

  for (const [rowIndex, row] of data.entries()) {
    const line = row
      .map((cell, index) => {
        const paddedCell = cell.padEnd(columnWidths?.[index] ?? 0)
        if (index === 0 && rowIndex > 0) {
          return row[3]?.startsWith('d') ? chalk.blue(paddedCell) : chalk.green(paddedCell)
        } else return rowIndex === 0 ? chalk.bold(paddedCell) : chalk.gray(paddedCell)
      })
      .join('  ')

    if (data.length > 1) terminal.writeln(line)
  }

  return 0
}

export const mount = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const [points, type, config] = (args as string[])
  if (!points || !type || points.length !== 2) {
    terminal.writeln(chalk.red('Usage: mount -t <type> <source> <target>'))

    // TODO: store does not exist on FileSystem (but we can access it here)
    // @ts-ignore
    const currentMounts: string[] = Array.from(kernel.filesystem.fsSync.mounts.entries()).map(([target, mount]) => `${chalk.blue(target)} (${mount.store?.constructor.name || mount.constructor.name}/${mount.metadata().name})`)
    const maxTargetLength = Math.max(...currentMounts.map(mount => mount.split(' ')[0]?.length ?? 0))
    for (const mount of currentMounts) {
      const [target, name] = mount.split(' ')
      if (!target || !name) continue
      terminal.writeln(chalk.gray(`${target.padEnd(maxTargetLength + 2)}${name}`))
    }

    return 1
  }

  const options = config?.split(',').map(option => option.split('='))
    .reduce((acc, [key, value]) => ({ ...acc, [key!]: value }), {})

  const [source, target] = points
  if (!source || !target) {
    terminal.writeln(chalk.red('Usage: mount -t <type> <source> <target>'))
    return 1
  }

  const fullSourcePath = path.resolve(shell.cwd, source)
  const fullTargetPath = path.resolve(shell.cwd, target)

  switch (type.toLowerCase()) {
    case 'fetch':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: Fetch, index: fullSourcePath, baseUrl: (options as { baseUrl?: string })?.baseUrl })); break
    case 'indexeddb':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: IndexedDB, storeName: fullSourcePath })); break
    case 'memory':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: InMemory, name: fullSourcePath })); break
    case 'zip':
      kernel.filesystem.fsSync.mount(fullTargetPath, await resolveMountConfig({ backend: Zip, name: fullSourcePath, data: new Uint8Array(await kernel.filesystem.fs.readFile(fullSourcePath)).buffer })); break
  }

  return 0
}


export const mkdir = async ({ kernel, shell, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  await kernel.filesystem.fs.mkdir(fullPath)
}

export const mv = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const [sourceInput, destinationInput] = (args as string[])
  if (!sourceInput || !destinationInput) {
    terminal.writeln(chalk.red('Usage: mv <source> <destination>'))
    return 1
  }

  const source = path.resolve(shell.cwd, sourceInput)
  let destination = path.resolve(shell.cwd, destinationInput)

  if (source === destination) return 0
  const disallowedPaths = ['/dev', '/proc', '/sys', '/run']
  if (disallowedPaths.some(path => source.startsWith(path) || destination.startsWith(path))) {
    terminal.writeln(chalk.red('Cannot move disallowed paths'))
    return 2
  }

  if (await kernel.filesystem.fs.exists(destination)) {
    if ((await kernel.filesystem.fs.stat(destination)).isDirectory()) {
      destination = path.resolve(destination, path.basename(source))
    } else {
      terminal.writeln(chalk.red(`${destination} already exists`))
      return 1
    }
  }

  await kernel.filesystem.fs.rename(source, destination)
  return 0
}

export const observe = async ({ process, terminal }: CommandArgs) => {
  if (!process) throw new Error('Missing process')
  const { stdin, stdout } = process

  if (!stdin) {
    terminal.writeln(chalk.red('No stdin available'))
    return 1
  }

  const reader = stdin.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Log the incoming data
      const text = decoder.decode(value)
      terminal.writeln(chalk.green(`[stdin] ${text.trim()}`))

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

export const open = async ({ terminal, args }: CommandArgs) => {
  const [path] = (args as string[])
  if (!path) return 1
  const isURL = !path.startsWith('/') || !path.startsWith('.')
  if (isURL) window.open(path, '_blank')
  else {
    // TODO: handle files
    terminal.writeln(chalk.red('Unsupported path'))
  }
}

export const passwd = async ({ kernel, terminal, args }: CommandArgs) => {
  let oldPass, newPass

  if (!args || !Array.isArray(args) || args.length < 2) {
    oldPass = await terminal.readline(chalk.cyan('Enter current password: '), true)
    if (!oldPass) {
      terminal.writeln(chalk.red('Current password required'))
      return 1
    }

    newPass = await terminal.readline(chalk.cyan('Enter new password: '), true)
    if (!newPass) {
      terminal.writeln(chalk.red('New password required')) 
      return 1
    }

    const confirmPass = await terminal.readline(chalk.cyan('Confirm new password: '), true)
    if (newPass !== confirmPass) {
      terminal.writeln(chalk.red('Passwords do not match'))
      return 1
    }
  } else {
    [oldPass, newPass] = args as string[]
  }

  try {
    if (!oldPass || !newPass) throw new Error('Missing password')
    await kernel.users.password(oldPass, newPass)
    terminal.writeln(chalk.green('Password updated successfully'))
    return 0
  } catch (error) {
    terminal.writeln(chalk.red(`Failed to update password: ${error instanceof Error ? error.message : 'Unknown error'}`))
    return 1
  }
}

export const play = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const [file] = (args as string[])
  if (!file || file === '') {
    terminal.writeln(chalk.red('Usage: play <file>'))
    return 1
  }

  const fullPath = path.resolve(shell.cwd, file)
  const blob = new Blob([await kernel.filesystem.fs.readFile(fullPath)])
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.play()
}

export const ps = async ({ kernel, terminal }: CommandArgs) => {
  terminal.writeln('PID\tCOMMAND\t\t\tSTATUS')
  for (const [pid, process] of kernel.processes.all.entries()) {
    terminal.writeln(`${chalk.yellow(pid)}\t${chalk.green(process.command)}\t\t\t${chalk.blue(process.status)}`)
  }
}

export const pwd = async ({ shell, terminal }: CommandArgs) => {
  terminal.writeln(shell.cwd)
}

export const reboot = async ({ kernel }: CommandArgs) => {
  kernel.reboot()
}

export const rm = async ({ kernel, shell, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  if ((await kernel.filesystem.fs.stat(fullPath)).isDirectory()) await kernel.filesystem.fs.rmdir(fullPath)
  else await kernel.filesystem.fs.unlink(fullPath)
  return 0
}

export const rmdir = async ({ kernel, shell, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  await kernel.filesystem.fs.rm(fullPath, { recursive: true, force: true })
}

export const screensaver = async ({ kernel, terminal, args }: CommandArgs) => {
  const [screensaver, set] = (args as string[])

  if (screensaver === 'off') {
    kernel.storage.local.removeItem('screensaver')
    return 0
  }

  let saverName = screensaver
  if (!saverName) saverName = kernel.storage.local.getItem('screensaver') || 'matrix'

  const saver = kernel.screensavers.get(saverName)
  if (!saver) {
    terminal.writeln(chalk.red('Invalid screensaver'))
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

  const keyListener = terminal.onKey(({ domEvent }) => {
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

export const socket = async () => {
// export const socket = async ({ kernel, terminal, args }: CommandArgs) => {
  // const [command, ...commandArgs] = (args as string[])

  // const user = kernel.users.get(kernel.shell.credentials.uid)
  // if (!user?.keypair) throw new Error(kernel.i18n.t('User not found or missing keypair'))

  // if (typeof user.keypair.privateKey === 'string') {
  //   // Decrypt the private key
  //   const pass = await terminal.readline(kernel.i18n.t('Your private key is locked, please enter your password to unlock it: '), true)
    
  //   try {
  //     // Pad password to 32 bytes for AES-256
  //     const paddedPassword = new TextEncoder().encode(pass.padEnd(32, '\0')).slice(0, 32)
      
  //     // Create AES key from password
  //     const aesKey = await crypto.subtle.importKey(
  //       'raw',
  //       paddedPassword,
  //       'AES-GCM',
  //       false,
  //       ['encrypt', 'decrypt']
  //     )

  //     // Decode base64 encrypted private key
  //     const encryptedData = new Uint8Array(
  //       atob(user.keypair.privateKey)
  //         .split('')
  //         .map(c => c.charCodeAt(0))
  //     )

  //     // Extract IV and encrypted data
  //     const iv = encryptedData.slice(0, 12)
  //     const encryptedPrivateKey = encryptedData.slice(12)

  //     // Decrypt the private key
  //     const decryptedPrivateKeyText = new TextDecoder().decode(
  //       await crypto.subtle.decrypt(
  //         { name: 'AES-GCM', iv },
  //         aesKey,
  //         encryptedPrivateKey
  //       )
  //     )

  //     // Parse the decrypted JWK
  //     const privateKeyJWK = JSON.parse(decryptedPrivateKeyText)
  //     user.keypair.privateKey = privateKeyJWK
  //   } catch (error) {
  //     kernel.log?.error(error)
  //     terminal.writeln(chalk.red(kernel.i18n.t('Failed to decrypt private key')))
  //     return 1
  //   }
  // }

  // const payloadObject = {
  //   'urn:ecmaos:metal:command': command,
  //   'urn:ecmaos:metal:args': commandArgs[0],
  //   'urn:ecmaos:metal:rows': kernel.terminal.rows,
  //   'urn:ecmaos:metal:cols': kernel.terminal.cols,
  //   'urn:ecmaos:metal:user': kernel.shell.username,
  //   'urn:ecmaos:metal:key': kernel.users.get(kernel.shell.credentials.uid)?.keypair?.publicKey,
  //   'urn:ecmaos:metal:timestamp': Date.now()
  // }

  // Import the private key for signing
  // const userKey = await jose.importJWK(user.keypair.privateKey as jose.JWK, 'ES384')

  // Create and sign the JWT
  // const jwt = await new jose.SignJWT(payloadObject)
  //   .setProtectedHeader({ alg: 'ES384' })
  //   .setIssuedAt()
  //   .setIssuer(`urn:ecmaos:kernel:${kernel.id}`)
  //   .setAudience(`urn:ecmaos:user:${kernel.shell.username}`)
  //   .setExpirationTime('2m')
  //   .sign(userKey)

  // Import server's public key for encryption
  // const serverPublicKey = await jose.importJWK(kernel.terminal.socketKey as jose.JWK, 'ECDH-ES+A256KW')

  // Encrypt the JWT using the server's public key
  // const encryptedJwt = await new jose.CompactEncrypt(
  //   new TextEncoder().encode(jwt)
  // )
  //   .setProtectedHeader({ 
  //     alg: 'ECDH-ES+A256KW', 
  //     enc: 'A256GCM',
  //     kid: kernel.terminal.socketKey?.kid
  //   })
  //   .encrypt(serverPublicKey)

  // kernel.terminal.socket?.send(encryptedJwt)
  return 0
}

export const stat = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const argPath = (args as string[])[0]
  const fullPath = argPath ? path.resolve(shell.cwd, argPath) : shell.cwd
  const stats = await kernel.filesystem.fs.stat(fullPath)
  terminal.writeln(JSON.stringify(stats, null, 2))

  const extension = path.extname(fullPath)
  if (extension === '.zip') {
    const blob = new Blob([await kernel.filesystem.fs.readFile(fullPath)])
    const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(blob))
    const entries = await zipReader.getEntries()
    terminal.writeln(chalk.bold('\nZIP Entries:'))
    for (const entry of entries) terminal.writeln(`${chalk.blue(entry.filename)} (${entry.uncompressedSize} bytes)`)
  }
}

export const su = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const username = (args as string[])[0]
  const currentUser = kernel.users.get(shell.credentials.suid) as User
  if (!currentUser || shell.credentials.suid !== 0) {
    terminal.writeln(chalk.red(kernel.i18n.t('Unauthorized')))
    return 1
  }

  const user = Array.from(kernel.users.all.values()).find(user => user.username === username)
  if (!user) {
    terminal.writeln(chalk.red(kernel.i18n.t('User not found', { username })))
    return 1
  }

  const cred = createCredentials(user)
  useCredentials(cred)

  terminal.promptTemplate = `{user}:{cwd}${user.uid === 0 ? '#' : '$'} `
}

export const touch = async ({ kernel, shell, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  await kernel.filesystem.fs.appendFile(fullPath, '')
}

export const umount = async ({ kernel, shell, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  console.log('umount', fullPath)
  kernel.filesystem.fsSync.umount(fullPath)
}

export const unzip = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const target = (args as string[])[0]
  const fullPath = target ? path.resolve(shell.cwd, target) : shell.cwd
  const blob = new Blob([await kernel.filesystem.fs.readFile(fullPath)])
  const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(blob))

  for (const entry of await zipReader.getEntries()) {
    const entryPath = path.resolve(shell.cwd, entry.filename)
    if (entry.directory) {
      await kernel.filesystem.fs.mkdir(entryPath)
    } else {
      const writer = new zipjs.Uint8ArrayWriter()
      const data = await entry.getData?.(writer)
      if (!data) { terminal.writeln(chalk.red(`Failed to read ${entryPath}`)); return 1 }
      await kernel.filesystem.fs.writeFile(entryPath, data)
    }
  }

  return 0
}

export const upload = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const destination = path.resolve((args as string[])[0] || shell.cwd)
  if (!destination) { terminal.writeln(chalk.red('File path is required')); return 1 }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '*'
  input.onchange = async (event) => {
    if (!event.target) return terminal.writeln(chalk.red('No file selected'))
    const files = (event.target as HTMLInputElement).files
    if (!files) return terminal.writeln(chalk.red('No file selected'))
    for (const file of files) {
      const reader = new FileReader()
      reader.onload = async (event) => {
        if (!event.target) return terminal.writeln(chalk.red('No file selected'))
        const data = new Uint8Array(event.target.result as ArrayBuffer)
        await kernel.filesystem.fs.writeFile(path.resolve(destination, file.name), data)
        kernel.events.dispatch(KernelEvents.UPLOAD, { file: file.name, path: path.resolve(destination, file.name) })
      }

      reader.readAsArrayBuffer(file)
    }
  }

  input.click()
  return 0
}

export const user = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  if (shell.credentials.suid !== 0) {
    terminal.writeln(chalk.red('Unauthorized'))
    return 1
  }

  const command = (args as string[])[0]?.toLowerCase()
  const [username, password] = (args as string[]).slice(1)

  if (!command || command.trim() === '') {
    terminal.writeln(chalk.red('Usage: user <command> [options]'))
    terminal.writeln('Commands:')
    terminal.writeln('  list                    List all users')
    terminal.writeln('  add --username <user>   Add a new user')
    terminal.writeln('  del --username <user>   Delete a user')
    terminal.writeln('  mod --username <user>   Modify a user')
    terminal.writeln('\nYou may specify --password or you will be prompted for it.')
    return 1
  }

  switch (command) {
    case 'list': {
      const users = Array.from(kernel.users.all.values())
      
      // Calculate column widths
      const uidWidth = Math.max(3, ...users.map(u => u.uid.toString().length))
      const usernameWidth = Math.max(8, ...users.map(u => u.username.length))
      const gidWidth = Math.max(3, ...users.map(u => u.gid.toString().length))

      terminal.writeln(chalk.bold(
        'UID'.padEnd(uidWidth) + '\t' +
        'Username'.padEnd(usernameWidth) + '\t' +
        'GID'.padEnd(gidWidth) + '\t' +
        'Groups'
      ))

      for (const user of users) {
        terminal.writeln(
          chalk.yellow(user.uid.toString().padEnd(uidWidth)) + '\t' +
          chalk.green(user.username.padEnd(usernameWidth)) + '\t' +
          chalk.cyan(user.gid.toString().padEnd(gidWidth)) + '\t' +
          chalk.blue(user.groups.join(', '))
        )
      }

      return 0
    }

    case 'add': {
      if (!username) {
        terminal.writeln(chalk.red('Username required'))
        return 1
      }

      if (Array.from(kernel.users.all.values()).some(u => u.username === username)) {
        terminal.writeln(chalk.red(`User ${username} already exists`))
        return 1
      }

      let userPassword = password
      if (!userPassword) {
        userPassword = await terminal.readline(chalk.cyan(`Enter password for ${username}: `), true)
        const confirm = await terminal.readline(chalk.cyan('Confirm password: '), true)
        if (userPassword !== confirm) {
          terminal.writeln(chalk.red('Passwords do not match'))
          return 1
        }
      }

      try {
        await kernel.users.add({ username, password: userPassword })
        terminal.writeln(chalk.green(`User ${username} created successfully`))
        return 0
      } catch (error) {
        terminal.writeln(chalk.red(`Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    case 'del': {
      if (!username) {
        terminal.writeln(chalk.red('Username required'))
        return 1
      }

      const user = Array.from(kernel.users.all.values()).find(u => u.username === username)
      if (!user) {
        terminal.writeln(chalk.red(`User ${username} not found`))
        return 1
      }

      // Don't allow deleting root
      if (user.uid === 0) {
        terminal.writeln(chalk.red('Cannot delete root user'))
        return 1
      }

      try {
        await kernel.users.remove(user.uid)
        await kernel.filesystem.fs.writeFile('/etc/passwd', (await kernel.filesystem.fs.readFile('/etc/passwd', 'utf8')).split('\n').filter((line: string) => !line.startsWith(`${username}:`)).join('\n'))
        await kernel.filesystem.fs.writeFile('/etc/shadow', (await kernel.filesystem.fs.readFile('/etc/shadow', 'utf8')).split('\n').filter((line: string) => !line.startsWith(`${username}:`)).join('\n'))
        terminal.writeln(chalk.green(`User ${username} deleted successfully`))
        return 0
      } catch (error) {
        terminal.writeln(chalk.red(`Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    case 'mod': {
      if (!username) {
        terminal.writeln(chalk.red('Username required'))
        return 1
      }

      const user = Array.from(kernel.users.all.values()).find(u => u.username === username)
      if (!user) {
        terminal.writeln(chalk.red(`User ${username} not found`))
        return 1
      }

      // For now, just allow password changes
      const newPassword = await terminal.readline(chalk.cyan('Enter new password: '), true)
      const confirm = await terminal.readline(chalk.cyan('Confirm new password: '), true)
      
      if (newPassword !== confirm) {
        terminal.writeln(chalk.red('Passwords do not match'))
        return 1
      }

      try {
        await kernel.users.update(user.uid, { password: newPassword })
        terminal.writeln(chalk.green(`Password updated for ${username}`))
        return 0
      } catch (error) {
        terminal.writeln(chalk.red(`Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    default:
      terminal.writeln(chalk.red(`Unknown command: ${command}`))
      return 1
  }
}

export const video = async ({ kernel, shell, args }: CommandArgs) => {
  const file = (args as string[])[0]
  const fullPath = file ? path.resolve(shell.cwd, file) : shell.cwd

  const blob = new Blob([await kernel.filesystem.fs.readFile(fullPath)])
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
    maximized: shouldMaximize
  })
}

export const zip = async ({ kernel, shell, terminal, args }: CommandArgs) => {
  const [output, paths = []] = args as [string, string[]]
  if (!output || paths.length === 0) {
    terminal.writeln('Usage: zip <output> <paths...>')
    return 1
  }

  const outputPath = path.resolve(shell.cwd, output)
  let zipWriter: zipjs.ZipWriter<Blob> | null = null

  try {
    zipWriter = new zipjs.ZipWriter(new zipjs.BlobWriter())

    for (const inputPath of paths) {
      const fullPath = path.resolve(shell.cwd, inputPath)
      
      try {
        const stat = await kernel.filesystem.fs.stat(fullPath)

        if (stat.isFile()) {
          // Add single file
          const relativePath = path.relative(shell.cwd, fullPath)
          const fileData = await kernel.filesystem.fs.readFile(fullPath)
          const reader = new zipjs.Uint8ArrayReader(fileData)
          await zipWriter.add(relativePath, reader)
          terminal.writeln(`Added file: ${relativePath}`)
        } else if (stat.isDirectory()) {
          // Add directory and contents recursively
          async function addDirectory(dirPath: string) {
            const entries = await kernel.filesystem.fs.readdir(dirPath)
            
            for (const entry of entries) {
              const entryPath = path.join(dirPath, entry)
              const relativePath = path.relative(shell.cwd, entryPath)
              const entryStat = await kernel.filesystem.fs.stat(entryPath)
              
              if (entryStat.isFile()) {
                const fileData = await kernel.filesystem.fs.readFile(entryPath)
                const reader = new zipjs.Uint8ArrayReader(fileData)
                await zipWriter?.add(relativePath, reader)
                terminal.writeln(`Added file: ${relativePath}`)
              } else if (entryStat.isDirectory()) {
                await addDirectory(entryPath)
              }
            }
          }

          await addDirectory(fullPath)
          terminal.writeln(`Added directory: ${path.relative(shell.cwd, fullPath)}`)
        } else {
          terminal.writeln(`Skipping ${inputPath}: Not a file or directory`)
        }
      } catch (err: unknown) {
        terminal.writeln(`Error processing ${inputPath}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }

    // Write the zip file
    const blob = await zipWriter.close()
    zipWriter = null // Clear reference after closing
    await kernel.filesystem.fs.writeFile(outputPath, new Uint8Array(await blob.arrayBuffer()))
    terminal.writeln(`Created zip file: ${output}`)

    return 0
  } catch (err: unknown) {
    terminal.writeln(`Failed to create zip file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    return 1
  } finally {
    if (zipWriter) {
      await zipWriter.close()
    }
  }
}
