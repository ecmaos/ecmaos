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

  async loadEnvFile() {
    const home = this._env.get('HOME')
    if (!home) return

    const envFilePath = path.join(home, '.env')
    try {
      if (!await this.context.fs.promises.exists(envFilePath)) return

      const content = await this.context.fs.promises.readFile(envFilePath, 'utf-8')
      const envVars = this.parseEnvFile(content)
      for (const [key, value] of Object.entries(envVars)) {
        this._env.set(key, value)
      }

      process.env = Object.fromEntries(this._env)
    } catch {}
  }

  parseEnvFile(content: string): Record<string, string> {
    const envVars: Record<string, string> = {}
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^([^=#\s]+)=(.*)$/)
      if (match) {
        const [, key, value] = match
        if (!key || !value) continue
        let parsedValue = value.trim()

        if ((parsedValue.startsWith('"') && parsedValue.endsWith('"')) ||
            (parsedValue.startsWith("'") && parsedValue.endsWith("'")))
          parsedValue = parsedValue.slice(1, -1)

        envVars[key] = parsedValue
      }
    }

    return envVars
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

  private parseRedirection(commandLine: string): { 
    command: string, 
    redirections: { type: '>' | '>>' | '<' | '2>' | '2>>' | '2>&1' | '&>' | '&>>', target: string }[] 
  } {
    const redirections: { type: '>' | '>>' | '<' | '2>' | '2>>' | '2>&1' | '&>' | '&>>', target: string }[] = []
    let command = commandLine

    // Order matters: check longer patterns first
    // &>> - append both stdout and stderr to file
    // &> or >& - redirect both stdout and stderr to file  
    // 2>&1 - redirect stderr to stdout
    // 2>> - append stderr to file
    // 2> - redirect stderr to file
    // >> - append stdout to file
    // > - redirect stdout to file
    // < - redirect stdin from file
    const redirectionRegex = /(&>>|&>|>&|2>&1|2>>|2>|>>|>|<)\s*(\S+)?/g
    
    command = command.replace(redirectionRegex, (_, operator, target) => {
      // Normalize >& to &>
      const normalizedOp = operator === '>&' ? '&>' : operator
      
      // 2>&1 doesn't have a target file
      if (normalizedOp === '2>&1') {
        redirections.push({ type: '2>&1', target: '' })
      } else if (target) {
        redirections.push({
          type: normalizedOp as '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '&>>',
          target: target.trim()
        })
      }
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
        
        try {
          const pipelineSetup: Array<{
            finalCommand: string
            args: string[]
            inputStream: ReadableStream<Uint8Array>
            outputStream: WritableStream<Uint8Array>
            errorStream: WritableStream<Uint8Array>
          }> = []

          let prevReadable: ReadableStream<Uint8Array> | undefined
          const { env, kernel } = this

          for (let i = 0; i < commands.length; i++) {
            const commandLine = commands[i]
            if (!commandLine) continue

            const { command, redirections } = this.parseRedirection(commandLine)
            const [commandName, ...args] = shellQuote.parse(command, this.envObject) as string[]
            if (!commandName) return Infinity

            const finalCommand = await this.resolveCommand(commandName)
            if (!finalCommand) return Infinity

            const isFirstCommand = i === 0
            const isLastCommand = i === commands.length - 1

            let inputStream: ReadableStream<Uint8Array>
            if (isFirstCommand) {
              const inputRedirect = redirections.find(r => r.type === '<')
              if (inputRedirect) {
                const sourcePath = path.resolve(this.cwd, inputRedirect.target)
                if (!await this.context.fs.promises.exists(sourcePath)) {
                  throw new Error(`File not found: ${sourcePath}`)
                }
                inputStream = this.createFileReadStream(sourcePath, env, kernel)
              } else {
                inputStream = this._terminal.getInputStream()
              }
            } else {
              if (!prevReadable) {
                throw new Error('Pipeline error: missing previous stream')
              }
              inputStream = prevReadable
            }

            let outputStream: WritableStream<Uint8Array>
            let errorStream: WritableStream<Uint8Array>
            
            const stdoutRedirect = redirections.find(r => r.type === '>' || r.type === '>>')
            const stderrRedirect = redirections.find(r => r.type === '2>' || r.type === '2>>')
            const bothRedirect = redirections.find(r => r.type === '&>' || r.type === '&>>')
            const stderrToStdout = redirections.find(r => r.type === '2>&1')
            
            if (isLastCommand) {
              // Handle &> or &>> (both stdout and stderr to file)
              if (bothRedirect) {
                const targetPath = path.resolve(this.cwd, bothRedirect.target)
                const append = bothRedirect.type === '&>>'
                const shared = this.createSharedFileStreams(targetPath, append)
                outputStream = shared.stdout
                errorStream = shared.stderr
              } else if (stderrToStdout) {
                // 2>&1 - stderr goes to same destination as stdout
                if (stdoutRedirect) {
                  // stdout > file, stderr 2>&1 -> both to file
                  const targetPath = path.resolve(this.cwd, stdoutRedirect.target)
                  const append = stdoutRedirect.type === '>>'
                  const shared = this.createSharedFileStreams(targetPath, append)
                  outputStream = shared.stdout
                  errorStream = shared.stderr
                } else {
                  // stdout to terminal, stderr 2>&1 -> both to terminal
                  const shared = this.createSharedTerminalStreams()
                  outputStream = shared.stdout
                  errorStream = shared.stderr
                }
              } else {
                // Handle stdout redirection
                if (stdoutRedirect) {
                  const targetPath = path.resolve(this.cwd, stdoutRedirect.target)
                  const append = stdoutRedirect.type === '>>'
                  outputStream = this.createFileWriteStream(targetPath, append)
                } else {
                  outputStream = this.createTerminalOutputStream()
                }
                
                // Handle stderr redirection
                if (stderrRedirect) {
                  const targetPath = path.resolve(this.cwd, stderrRedirect.target)
                  const append = stderrRedirect.type === '2>>'
                  errorStream = this.createFileWriteStream(targetPath, append)
                } else {
                  errorStream = this.createTerminalErrorStream()
                }
              }
            } else {
              // Create pipe to next command (only stdout goes through pipe)
              const pipe = new TransformStream<Uint8Array>()
              outputStream = pipe.writable
              prevReadable = pipe.readable
              
              // Stderr still goes to terminal or file even in pipeline
              if (stderrToStdout) {
                // 2>&1 in pipeline - need to create a second stream that writes to the pipe
                // We can't share the pipe.writable, so we create a passthrough
                const pipeWriter = pipe.writable.getWriter()
                errorStream = new WritableStream<Uint8Array>({
                  write: async (chunk) => {
                    await pipeWriter.write(chunk)
                  },
                  close: async () => {
                    pipeWriter.releaseLock()
                  }
                })
                // Re-create outputStream since we took the writer
                outputStream = new WritableStream<Uint8Array>({
                  write: async (chunk) => {
                    await pipeWriter.write(chunk)
                  }
                })
              } else if (stderrRedirect) {
                const targetPath = path.resolve(this.cwd, stderrRedirect.target)
                const append = stderrRedirect.type === '2>>'
                errorStream = this.createFileWriteStream(targetPath, append)
              } else {
                errorStream = this.createTerminalErrorStream()
              }
            }

            pipelineSetup.push({ finalCommand, args, inputStream, outputStream, errorStream })
          }

          const commandPromises = pipelineSetup.map(({ finalCommand, args, inputStream, outputStream, errorStream }) =>
            this._kernel.execute({
              command: finalCommand,
              args,
              kernel: this._kernel,
              shell: this,
              terminal: this._terminal,
              stdin: inputStream,
              stdout: outputStream,
              stderr: errorStream
            })
          )

          const results = await Promise.all(commandPromises)
          
          for (const result of results) {
            if (result !== 0) {
              finalResult = result
            }
          }

          if (finalResult !== 0) shouldContinue = false
        } catch (error) {
          this._terminal.restoreCommand(currentCmd)
          throw error
        }
      }
    }

    return finalResult
  }

  /**
   * Creates a ReadableStream that reads from a file
   */
  private createFileReadStream(
    sourcePath: string, 
    env: Map<string, string>, 
    kernel: Kernel
  ): ReadableStream<Uint8Array> {
    return new ReadableStream({
      async start(controller) {
        const fileHandle = await kernel.filesystem.fs.open(sourcePath, 'r')
        const chunkSize = parseInt(
          env.get('SHELL_INPUT_REDIRECTION_CHUNK_SIZE') || 
          import.meta.env.VITE_APP_SHELL_INPUT_REDIRECTION_CHUNK_SIZE || 
          '8192'
        )
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

  /**
   * Creates a WritableStream that writes to a file
   */
  private createFileWriteStream(targetPath: string, append: boolean): WritableStream<Uint8Array> {
    const context = this.context
    let isFirstWrite = true
    
    return new WritableStream({
      write: async (chunk) => {
        if (append || !isFirstWrite) {
          await context.fs.promises.appendFile(targetPath, chunk)
        } else {
          await context.fs.promises.writeFile(targetPath, chunk)
          isFirstWrite = false
        }
      }
    })
  }

  /**
   * Creates a WritableStream that writes to the terminal
   */
  private createTerminalOutputStream(): WritableStream<Uint8Array> {
    const writer = this._terminalWriter
    return new WritableStream({
      write: async (chunk) => {
        if (writer) await writer.write(chunk)
      }
    })
  }

  private createTerminalErrorStream(): WritableStream<Uint8Array> {
    const terminal = this._terminal
    return new WritableStream({
      write: async (chunk) => {
        // Write to terminal with error styling
        const text = new TextDecoder().decode(chunk)
        terminal.write(`\x1b[31m${text}\x1b[0m`)
      }
    })
  }

  /**
   * Creates a pair of WritableStreams that both write to the same file.
   * Used for &> and 2>&1 redirections where stdout and stderr go to the same destination.
   */
  private createSharedFileStreams(filePath: string, append: boolean): { stdout: WritableStream<Uint8Array>, stderr: WritableStream<Uint8Array> } {
    const context = this.context
    // Use a queue to serialize writes from both streams
    let writeQueue = Promise.resolve()
    let isFirstWrite = true
    
    const writeToFile = async (chunk: Uint8Array) => {
      if (append || !isFirstWrite) {
        await context.fs.promises.appendFile(filePath, chunk)
      } else {
        await context.fs.promises.writeFile(filePath, chunk)
        isFirstWrite = false
      }
    }
    
    const createStream = () => new WritableStream<Uint8Array>({
      write: async (chunk) => {
        // Queue writes to ensure serialization
        const currentWrite = writeQueue.then(() => writeToFile(chunk))
        writeQueue = currentWrite.catch(() => {})
        await currentWrite
      }
    })
    
    return {
      stdout: createStream(),
      stderr: createStream()
    }
  }

  /**
   * Creates a pair of WritableStreams that both write to the terminal.
   * Used for 2>&1 when stdout goes to terminal.
   */
  private createSharedTerminalStreams(): { stdout: WritableStream<Uint8Array>, stderr: WritableStream<Uint8Array> } {
    const writer = this._terminalWriter
    
    const createStream = () => new WritableStream<Uint8Array>({
      write: async (chunk) => {
        if (writer) await writer.write(chunk)
      }
    })
    
    return {
      stdout: createStream(),
      stderr: createStream()
    }
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
      if (await this.context.fs.promises.exists(fullPath)) return fullPath
    }

    return undefined
  }

  setPositionalParameters(args: string[]) {
    this.clearPositionalParameters()
    for (const [index, arg] of args.entries()) this.env.set(`${index}`, arg)
  }
}
