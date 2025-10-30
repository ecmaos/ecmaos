/**
  * @experimental
  * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
  * 
  * The Shell class handles the Terminal environment and interaction with the Kernel.
  * 
 */

import path from 'path'
import shellQuote from 'shell-quote'

import { bindContext } from '@zenfs/core'
import type { BoundContext, Credentials } from '@zenfs/core'
import type { Kernel, Shell as IShell, ShellOptions, Terminal } from '@ecmaos/types'

const DefaultShellPath = '$HOME/bin:/bin:/usr/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/sbin'
const DefaultShellOptions = {
  cwd: '/',
  env: {
    PATH: DefaultShellPath,
    SHELL: 'ecmaos',
    TERM: 'xterm.js',
    USER: 'root',
    HOME: '/root',
  }
}

/**
  * @experimental
  * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
  * 
  * The Shell class handles the Terminal environment and interaction with the Kernel.
  * 
 */
export class Shell implements IShell {
  // private _cred: Credentials = { uid: 0, gid: 0, suid: 0, sgid: 0, euid: 0, egid: 0, groups: [] }
  // private _context: BoundContext
  private _cwd: string
  private _env: Map<string, string>
  private _id: string = crypto.randomUUID()
  private _kernel: Kernel
  private _terminal: Terminal
  private _terminalWriter?: WritableStreamDefaultWriter<Uint8Array>

  public credentials: Credentials = { uid: 0, gid: 0, suid: 0, sgid: 0, euid: 0, egid: 0, groups: [] }
  public context: BoundContext = bindContext({ root: '/', pwd: '/', credentials: this.credentials })

  get cwd() { return this._cwd }
  set cwd(path: string) { this._cwd = path === '/' ? path : path.endsWith('/') ? path.slice(0, -1) : path }
  get env() { return this._env }
  set env(env: Map<string, string>) { this._env = env; globalThis.process.env = { ...globalThis.process.env, ...Object.fromEntries(env) } }
  get envObject() { return Object.fromEntries(this._env) }
  get id() { return this._id }
  get kernel() { return this._kernel }
  get terminal() { return this._terminal }
  get username() { return this._kernel.users.get(this.credentials.uid)?.username || 'root' }

  // get credentials() { return this.credentials }
  // set credentials(cred: Credentials) { this.credentials = cred }

  // get context() { return this._context }
  // set context(context: BoundContext) { this._context = context }

  constructor(_options: ShellOptions) {
    const options = { ...DefaultShellOptions, ..._options }
    if (!options.kernel) throw new Error('Kernel is required')
    globalThis.shells?.set(this.id, this)

    this._cwd = options.cwd || localStorage.getItem(`cwd:${this.credentials.uid}`) || DefaultShellOptions.cwd
    this._env = new Map([...Object.entries(DefaultShellOptions.env), ...Object.entries(options.env)])
    this._kernel = options.kernel
    this._terminal = options.terminal || options.kernel.terminal
    this._terminalWriter = this._terminal?.stdout.getWriter() || new WritableStream().getWriter()

    process.env = Object.fromEntries(this._env)
  }
  
  attach(terminal: Terminal) {
    this._terminal = terminal
    this._terminalWriter = terminal.stdout.getWriter()
  }

  clearPositionalParameters() {
    for (const key of this.env.keys()) {
      if (!isNaN(parseInt(key))) this.env.delete(key)
    }
  }

  private parseRedirection(commandLine: string): { command: string, redirections: { type: '>' | '>>' | '<', target: string }[] } {
    const redirections: { type: '>' | '>>' | '<', target: string }[] = []
    let command = commandLine

    const redirectionRegex = /([>]{1,2}|<)\s*(\S+)/g
    
    command = command.replace(redirectionRegex, (_, operator, target) => {
      redirections.push({
        type: operator as '>' | '>>' | '<',
        target: target.trim()
      })
      return ''
    }).trim()

    return { command, redirections }
  }

  async execute(line: string) {
    const lineWithoutComments = line.split('#')[0]?.trim()
    if (!lineWithoutComments || lineWithoutComments === '') return 0

    const commandGroups = lineWithoutComments.split(';').map(group => group.trim())
    let finalResult = 0

    for (const group of commandGroups) {
      if (group === '') continue
      
      const conditionalCommands = group.split('&&').map(cmd => cmd.trim())
      let shouldContinue = true

      for (const conditionalCmd of conditionalCommands) {
        if (!shouldContinue) break

        const commands = conditionalCmd.split('|').map(cmd => cmd.trim())
        const currentCmd = this._terminal.cmd

        let prevOutputStream: ReadableStream<Uint8Array> | undefined
        
        try {
          for (let i = 0; i < commands.length; i++) {
            const commandLine = commands[i]
            if (!commandLine) continue

            const { command, redirections } = this.parseRedirection(commandLine)
            const [commandName, ...args] = shellQuote.parse(command, this.envObject) as string[]
            if (!commandName) return Infinity

            const finalCommand = await this.resolveCommand(commandName)
            if (!finalCommand) return Infinity

            let inputStream = i === 0 
              ? this._terminal.getInputStream() 
              : prevOutputStream

            const { env, kernel } = this

            for (const redirection of redirections) {
              if (redirection.type === '<') {
                const sourcePath = path.resolve(this.cwd, redirection.target)
                if (!await this.context.fs.promises.exists(sourcePath)) {
                  throw new Error(`File not found: ${sourcePath}`)
                }

                inputStream = new ReadableStream({
                  async start(controller) {
                    const fileHandle = await kernel.filesystem.fs.open(sourcePath, 'r')
                    const chunkSize = parseInt(env.get('SHELL_INPUT_REDIRECTION_CHUNK_SIZE') || import.meta.env.VITE_APP_SHELL_INPUT_REDIRECTION_CHUNK_SIZE || '8192')
                    const buffer = new Uint8Array(chunkSize)
                    
                    try {
                      while (true) {
                        const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize)
                        if (bytesRead === 0) break
                        controller.enqueue(buffer.slice(0, bytesRead))
                      }
                    } finally {
                      await fileHandle.close()
                      controller.close()
                    }
                  }
                })
              }
            }

            const { readable, writable } = new TransformStream<Uint8Array>()

            const isLastCommand = i === commands.length - 1
            let outputStream = writable

            if (isLastCommand && redirections.length > 0) {
              for (const redirection of redirections) {
                if (redirection.type === '>') {
                  const targetPath = path.resolve(this.cwd, redirection.target)
                  outputStream = new WritableStream({
                    write: async (chunk) => {
                      await this.context.fs.promises.writeFile(targetPath, chunk)
                    }
                  })
                } else if (redirection.type === '>>') {
                  const targetPath = path.resolve(this.cwd, redirection.target)
                  outputStream = new WritableStream({
                    write: async (chunk) => {
                      await this.context.fs.promises.appendFile(targetPath, chunk)
                    }
                  })
                }
              }
            } else if (isLastCommand) {
              // If no redirection, use terminal output
              readable.pipeTo(new WritableStream({
                write: async (chunk) => {
                  if (this._terminalWriter) await this._terminalWriter.write(chunk)
                }
              })).catch(() => {})
            }

            const result = await this._kernel.execute({
              command: finalCommand,
              args,
              kernel: this._kernel,
              shell: this,
              terminal: this._terminal,
              stdin: inputStream,
              stdout: outputStream,
              stderr: this._terminal.stderr
            })

            if (result !== 0) {
              finalResult = result
              break
            }

            prevOutputStream = isLastCommand ? undefined : readable
          }

          // Check if we should continue with the next && command
          if (finalResult !== 0) {
            shouldContinue = false
          }
        } catch (error) {
          this._terminal.restoreCommand(currentCmd)
          throw error
        }
      }
    }

    return finalResult
  }

  private async resolveCommand(command: string): Promise<string | undefined> {
    if (command.startsWith('./')) {
      const cwdCommand = path.join(this.cwd, command.slice(2))
      if (await this.context.fs.promises.exists(cwdCommand)) {
        return cwdCommand
      }
      return undefined
    }

    const paths = this.env.get('PATH')?.split(':') || DefaultShellPath.split(':')
    const resolvedCommand = path.resolve(command)

    if (await this.context.fs.promises.exists(resolvedCommand)) {
      return resolvedCommand
    }

    for (const path of paths) {
      const expandedPath = path.replace(/\$([A-Z_]+)/g, (_, name) => this.env.get(name) || '')
      const fullPath = `${expandedPath}/${command}`
      if (await this.context.fs.promises.exists(fullPath)) {
        return fullPath
      }
    }

    return undefined
  }

  setPositionalParameters(args: string[]) {
    this.clearPositionalParameters()
    for (const [index, arg] of args.entries()) this.env.set(`${index}`, arg)
  }
}
