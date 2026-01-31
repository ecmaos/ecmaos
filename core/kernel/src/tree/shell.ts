/**
  * @experimental
  * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
  * 
  * The Shell class handles the Terminal environment and interaction with the Kernel.
  * 
 */

import path from 'path'
import shellQuote from 'shell-quote'
import { parse } from 'smol-toml'
import { bindContext } from '@zenfs/core'
import type { BoundContext, Credentials } from '@zenfs/core'
import type { Kernel, Shell as IShell, ShellOptions, ShellConfig as IShellConfig, Terminal as ITerminal } from '@ecmaos/types' // TODO: Consistency
import { ThemePresets } from '@ecmaos/types'

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
  private _terminal: ITerminal
  private _terminalWriter?: WritableStreamDefaultWriter<Uint8Array>
  private _tty: number
  
  public readonly config: ShellConfig

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
  get tty() { return this._tty }

  constructor(_options: ShellOptions & { tty?: number }) {
    const options = { ...DefaultShellOptions, ..._options }
    if (!options.kernel) throw new Error('Kernel is required')
    globalThis.shells?.set(this.id, this)

    this._tty = options.tty ?? 0
    this._cwd = options.cwd || localStorage.getItem(`cwd:${this.credentials.uid}`) || DefaultShellOptions.cwd
    this._env = new Map([...Object.entries(DefaultShellOptions.env), ...Object.entries(options.env)])
    this._kernel = options.kernel
    this._terminal = options.terminal || options.kernel.terminal
    this._terminalWriter = this._terminal?.stdout.getWriter() || new WritableStream().getWriter()
    
    this.config = new ShellConfig(this)

    process.env = Object.fromEntries(this._env)
  }

  async loadEnvFile() {
    // Load global /etc/env first
    try {
      if (await this.context.fs.promises.exists('/etc/env')) {
        const globalContent = await this.context.fs.promises.readFile('/etc/env', 'utf-8')
        const globalEnvVars = this.parseEnvFile(globalContent)
        for (const [key, value] of Object.entries(globalEnvVars)) {
          this._env.set(key, value)
        }
      }
    } catch {}

    // Load user ~/.env second (overwrites global values)
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

    // Load shell configuration
    await this.config.load()
    this.terminal.updateConfig()
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
  
  attach(terminal: ITerminal) {
    if (this._terminalWriter) {
      try { this._terminalWriter.releaseLock() } catch {}
    }
    
    this._terminal = terminal
    this._terminalWriter = terminal.stdout.getWriter()
  }

  clearPositionalParameters() {
    for (const key of this.env.keys()) {
      if (!isNaN(parseInt(key))) this.env.delete(key)
    }
  }

  /**
   * Parses and executes command substitutions in the format $(command)
   * Supports nested substitutions
   */
  private async parseCommandSubstitution(commandLine: string): Promise<string> {
    let result = commandLine
    let hasSubstitution = true
    
    // Process substitutions iteratively to handle nested cases
    while (hasSubstitution) {
      hasSubstitution = false
      const matches: Array<{ match: string; command: string; start: number; end: number }> = []
      
      // Find all $(...) patterns by tracking parentheses depth
      // Need to track quote state to skip substitutions inside single quotes
      let inSingleQuote = false
      let inDoubleQuote = false
      let escaped = false
      
      for (let i = 0; i < result.length - 1; i++) {
        const char = result[i]
        
        // Track quote state
        if (escaped) {
          escaped = false
          continue
        }
        
        if (char === '\\') {
          escaped = true
          continue
        }
        
        if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote
        } else if (char === '"' && !inSingleQuote) {
          inDoubleQuote = !inDoubleQuote
        }
        
        // Only process substitutions outside single quotes
        if (!inSingleQuote && char === '$' && result[i + 1] === '(') {
          // Found start of substitution, find matching closing paren
          let depth = 1
          let j = i + 2
          let subInString = false
          let subStringChar = ''
          let subEscaped = false
          
          while (j < result.length && depth > 0) {
            const subChar = result[j]
            
            if (subEscaped) {
              subEscaped = false
              j++
              continue
            }
            
            if (subChar === '\\') {
              subEscaped = true
              j++
              continue
            }
            
            if (!subInString && (subChar === '"' || subChar === "'")) {
              subInString = true
              subStringChar = subChar
            } else if (subInString && subChar === subStringChar) {
              subInString = false
              subStringChar = ''
            } else if (!subInString) {
              if (subChar === '(') {
                depth++
              } else if (subChar === ')') {
                depth--
              }
            }
            
            j++
          }
          
          if (depth === 0) {
            // Found complete substitution
            hasSubstitution = true
            const command = result.slice(i + 2, j - 1)
            matches.push({
              match: result.slice(i, j),
              command,
              start: i,
              end: j
            })
            i = j - 1 // Skip past this substitution
          }
        }
      }
      
      // Process matches from right to left to preserve indices
      matches.reverse()
      
      for (const { command, start, end } of matches) {
        // Execute the command substitution
        const output = await this.executeCommandSubstitution(command)
        
        // Replace the substitution with the output
        // Ensure the output is treated as a separate word by checking boundaries
        const beforeChar = start > 0 ? result[start - 1] : ' '
        const afterChar = end < result.length ? result[end] : ' '
        const needsSpaceBefore = beforeChar !== ' ' && beforeChar !== '\t' && beforeChar !== '\n'
        const needsSpaceAfter = afterChar !== ' ' && afterChar !== '\t' && afterChar !== '\n' && afterChar !== ''
        
        const replacement = (needsSpaceBefore ? ' ' : '') + output + (needsSpaceAfter ? ' ' : '')
        result = result.slice(0, start) + replacement + result.slice(end)
      }
    }
    
    return result
  }

  /**
   * Executes a command substitution and returns its output
   */
  private async executeCommandSubstitution(command: string): Promise<string> {
    // Create a temporary stream to capture output
    const chunks: Uint8Array[] = []
    const outputStream = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk)
      }
    })
    
    // Create a dummy error stream (we'll ignore stderr for substitutions)
    const errorStream = new WritableStream<Uint8Array>({
      write() {
        // Ignore stderr in command substitutions
      }
    })
    
    // Execute the command
    try {
      // Parse the command to get command name and args
      const parsedArgs = shellQuote.parse(command, this.envObject)
      const [commandName, ...rawArgs] = parsedArgs
      if (!commandName || typeof commandName !== 'string') return ''
      
      const args = await this.expandGlobArgs(rawArgs)
      const finalCommand = await this.resolveCommand(commandName)
      if (!finalCommand) return ''
      
      // Execute the command
      await this._kernel.execute({
        command: finalCommand,
        args,
        kernel: this._kernel,
        shell: this,
        terminal: this._terminal,
        stdin: new ReadableStream<Uint8Array>(),
        stdout: outputStream,
        stderr: errorStream
      })
      
      // Combine all chunks and convert to string
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const combined = new Uint8Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      
      // Decode and trim trailing newlines (standard shell behavior)
      const output = new TextDecoder().decode(combined)
      return output.replace(/\n+$/, '')
    } catch {
      return ''
    }
  }

  /**
   * Expands tilde (~) to the user's home directory
   * Handles ~, ~/, and ~/path patterns
   * Respects quotes: no expansion inside single quotes, expansion inside double quotes
   */
  expandTilde(input: string): string {
    const home = this._env.get('HOME')
    if (!home) return input

    let result = ''
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false
    let i = 0

    while (i < input.length) {
      const char = input[i]
      const nextChar = input[i + 1]

      if (escaped) {
        result += char
        escaped = false
        i++
        continue
      }

      if (char === '\\') {
        escaped = true
        result += char
        i++
        continue
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        result += char
        i++
        continue
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        result += char
        i++
        continue
      }

      // Only expand tilde outside single quotes
      // Tilde can be expanded inside double quotes (standard shell behavior)
      if (!inSingleQuote && char === '~') {
        // Check if this is a word boundary (start of string, after whitespace, or after =)
        const isWordStart = i === 0 || (i > 0 && /\s|=/.test(input[i - 1] ?? ' '))
        
        if (isWordStart) {
          // Check if it's ~/path or just ~
          if (nextChar === '/' || nextChar === undefined || /\s/.test(nextChar)) {
            result += home
            i++
            continue
          }
        }
      }

      result += char
      i++
    }

    return result
  }

  /**
   * Expands a glob pattern to matching file paths
   * @param pattern - Glob pattern (e.g., "bin/*", "*.js")
   * @returns Array of matching file paths
   */
  private async expandGlob(pattern: string): Promise<string[]> {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return [pattern]
    }

    const lastSlashIndex = pattern.lastIndexOf('/')
    const searchDir = lastSlashIndex !== -1
      ? path.resolve(this.cwd, pattern.substring(0, lastSlashIndex + 1))
      : this.cwd
    const globPattern = lastSlashIndex !== -1
      ? pattern.substring(lastSlashIndex + 1)
      : pattern

    try {
      const entries = await this.context.fs.promises.readdir(searchDir)
      const regexPattern = globPattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.')
      const regex = new RegExp(`^${regexPattern}$`)
      
      const matches = entries.filter(entry => regex.test(entry))
      
      if (lastSlashIndex !== -1) {
        const dirPart = pattern.substring(0, lastSlashIndex + 1)
        return matches.map(match => dirPart + match)
      }
      return matches
    } catch {
      // If directory doesn't exist or can't be read, return empty array
      // This matches standard shell behavior where non-matching globs are passed as-is
      return []
    }
  }

  /**
   * Expands glob objects from shell-quote.parse() to actual file paths
   * @param args - Array of arguments from shell-quote.parse() that may contain glob objects, strings, or comments
   * @returns Array of strings with glob patterns expanded
   */
  private async expandGlobArgs(args: Array<unknown>): Promise<string[]> {
    const expandedArgs: string[] = []
    
    // Group adjacent non-glob, non-comment items to reconstruct arguments that were split
    // This handles cases where shell-quote splits on special characters like parentheses
    const groups: Array<Array<unknown>> = []
    let currentGroup: Array<unknown> = []
    
    for (const arg of args) {
      // Skip comments
      if (typeof arg === 'object' && arg !== null && 'comment' in arg) {
        continue
      }
      
      // Check if this is a glob object - globs should be separate
      if (typeof arg === 'object' && arg !== null && 'op' in arg && (arg as { op: string }).op === 'glob' && 'pattern' in arg) {
        // Push current group if it has items
        if (currentGroup.length > 0) {
          groups.push(currentGroup)
          currentGroup = []
        }
        // Push glob as its own group
        groups.push([arg])
      } else {
        // Add to current group
        currentGroup.push(arg)
      }
    }
    
    // Push final group if it has items
    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }
    
    // Process each group
    for (const group of groups) {
      if (group.length === 0) continue
      
      // If group has a single glob, expand it
      if (group.length === 1 && typeof group[0] === 'object' && group[0] !== null && 'op' in group[0] && (group[0] as { op: string }).op === 'glob' && 'pattern' in group[0] && typeof (group[0] as { pattern?: string }).pattern === 'string') {
        const pattern = (group[0] as { pattern: string }).pattern
        const expanded = await this.expandGlob(pattern)
        if (expanded.length === 0) {
          expandedArgs.push(pattern)
        } else {
          expandedArgs.push(...expanded)
        }
      } else {
        // Check if all items in the group are plain strings (not objects representing special chars)
        // If so, they were originally separate arguments and should remain separate
        const allStrings = group.every(item => typeof item === 'string')
        
        if (allStrings && group.length > 1) {
          // These were separate arguments, push them individually
          for (const item of group) {
            if (typeof item === 'string' && item) {
              expandedArgs.push(item)
            }
          }
        } else {
          // Reconstruct the argument by joining all parts
          // This handles cases where shell-quote split on special characters
          const reconstructed = group.map(item => {
            if (typeof item === 'string') {
              return item
            } else if (typeof item === 'object' && item !== null) {
              // Try to extract meaningful string from object
              if ('pattern' in item && typeof (item as { pattern?: string }).pattern === 'string') {
                return (item as { pattern: string }).pattern
              }
              // For other objects, try to find string properties
              for (const key in item) {
                const value = (item as Record<string, unknown>)[key]
                if (typeof value === 'string' && value.length > 0 && key !== 'op') {
                  return value
                }
              }
              // Fallback: return empty string (object represents a special character we can't reconstruct)
              return ''
            }
            return String(item)
          }).join('')
          
          if (reconstructed) {
            // Check if it contains glob characters
            if (reconstructed.includes('*') || reconstructed.includes('?')) {
              const expanded = await this.expandGlob(reconstructed)
              if (expanded.length === 0) {
                expandedArgs.push(reconstructed)
              } else {
                expandedArgs.push(...expanded)
              }
            } else {
              expandedArgs.push(reconstructed)
            }
          }
        }
      }
    }
    
    return expandedArgs
  }

  /**
   * Expands history bang syntax (e.g., !10) to the corresponding command from history
   * Supports patterns like !N where N is a history line number (1-indexed)
   * Recursively expands history bangs until no more expansions are possible
   */
  private async expandHistoryBang(commandLine: string): Promise<string> {
    const home = this._env.get('HOME') || '/root'
    const historyPath = path.join(home, '.history')

    try {
      if (!await this.context.fs.promises.exists(historyPath)) {
        return commandLine
      }

      const content = await this.context.fs.promises.readFile(historyPath, 'utf-8')
      const historyLines = content.split('\n').filter(line => line.length > 0)

      if (historyLines.length === 0) {
        return commandLine
      }

      let result = commandLine
      let hasExpansion = true
      const maxIterations = 100
      let iterations = 0

      while (hasExpansion && iterations < maxIterations) {
        iterations++
        hasExpansion = false
        let inSingleQuote = false
        let inDoubleQuote = false
        let escaped = false
        let i = 0

        while (i < result.length) {
          const char = result[i]

          if (escaped) {
            escaped = false
            i++
            continue
          }

          if (char === '\\') {
            escaped = true
            i++
            continue
          }

          if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote
            i++
            continue
          }

          if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote
            i++
            continue
          }

          if (!inSingleQuote && char === '!') {
            const nextChar = result[i + 1]
            
            if (nextChar && /[0-9]/.test(nextChar)) {
              let numStr = ''
              let j = i + 1
              
              while (j < result.length) {
                const char = result[j]
                if (char && /[0-9]/.test(char)) {
                  numStr += char
                  j++
                } else {
                  break
                }
              }

              const historyNum = parseInt(numStr, 10)
              
              if (historyNum >= 1 && historyNum <= historyLines.length) {
                const historyCommand = historyLines[historyNum - 1]
                if (historyCommand) {
                  result = result.slice(0, i) + historyCommand + result.slice(j)
                  hasExpansion = true
                  break
                }
              }
              
              throw new Error(`!${historyNum}: event not found`)
            }
          }

          i++
        }
      }

      if (iterations >= maxIterations) {
        throw new Error('History expansion exceeded maximum iterations (possible circular reference)')
      }

      return result
    } catch (error) {
      if (error instanceof Error && (error.message.includes('event not found') || error.message.includes('maximum iterations'))) {
        throw error
      }
      return commandLine
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
            stdinIsTTY: boolean
            outputStream: WritableStream<Uint8Array>
            errorStream: WritableStream<Uint8Array>
            stdoutIsTTY: boolean
          }> = []

          let prevReadable: ReadableStream<Uint8Array> | undefined
          const { env, kernel } = this

          for (let i = 0; i < commands.length; i++) {
            let commandLine = commands[i]
            if (!commandLine) continue

            commandLine = await this.parseCommandSubstitution(commandLine)
            commandLine = await this.expandHistoryBang(commandLine)
            commandLine = this.expandTilde(commandLine)

            const { command, redirections } = this.parseRedirection(commandLine)
            const parsedArgs = shellQuote.parse(command, this.envObject)
            const [commandName, ...rawArgs] = parsedArgs
            if (!commandName || typeof commandName !== 'string') {
              throw new Error(kernel.i18n.t('commandNotFound', { ns: 'kernel', command: commandLine }))
            }

            // Expand glob patterns in arguments
            const args = await this.expandGlobArgs(rawArgs)

            const finalCommand = await this.resolveCommand(commandName)
            if (!finalCommand) {
              throw new Error(kernel.i18n.t('commandNotFound', { ns: 'kernel', command: commandName }))
            }

            const isFirstCommand = i === 0
            const isLastCommand = i === commands.length - 1

            let inputStream: ReadableStream<Uint8Array>
            let stdinIsTTY: boolean = false
            if (isFirstCommand) {
              const inputRedirect = redirections.find(r => r.type === '<')
              if (inputRedirect) {
                const sourcePath = path.resolve(this.cwd, inputRedirect.target)
                if (!await this.context.fs.promises.exists(sourcePath)) {
                  throw new Error(`File not found: ${sourcePath}`)
                }
                inputStream = this.createFileReadStream(sourcePath, env, kernel)
                stdinIsTTY = false
              } else {
                inputStream = this._terminal.getInputStream()
                stdinIsTTY = true
              }
            } else {
              if (!prevReadable) {
                throw new Error('Pipeline error: missing previous stream')
              }
              inputStream = prevReadable
              stdinIsTTY = false
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

            const stdoutIsTTY = !stdoutRedirect && isLastCommand
            pipelineSetup.push({ finalCommand, args, inputStream, stdinIsTTY, outputStream, errorStream, stdoutIsTTY })
          }

          const commandPromises = pipelineSetup.map(({ finalCommand, args, inputStream, stdinIsTTY, outputStream, errorStream, stdoutIsTTY }) =>
            this._kernel.execute({
              command: finalCommand,
              args,
              kernel: this._kernel,
              shell: this,
              terminal: this._terminal,
              stdin: inputStream,
              stdinIsTTY,
              stdout: outputStream,
              stdoutIsTTY,
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
          import.meta.env.ECMAOS_APP_SHELL_INPUT_REDIRECTION_CHUNK_SIZE || 
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



/**
 * Default configuration values
 */
export const DefaultConfig: IShellConfig = {
  noBell: false,
  fontFamily: 'FiraCode Nerd Font Mono, Ubuntu Mono, courier-new, courier, monospace',
  fontSize: 16,
  cursorBlink: true,
  cursorStyle: 'block',
  theme: {
    background: '#000000',
    foreground: '#00FF00',
    promptColor: 'green'
  },
  smoothScrollDuration: 100,
  macOptionIsMeta: true
}

export class ShellConfig implements IShellConfig {
  private _noBell: boolean = DefaultConfig.noBell! // Bang because we know default exists
  private _fontFamily: string = DefaultConfig.fontFamily!
  private _fontSize: number = DefaultConfig.fontSize!
  private _cursorBlink: boolean = DefaultConfig.cursorBlink!
  private _cursorStyle: 'block' | 'underline' | 'bar' = DefaultConfig.cursorStyle!
  private _theme: IShellConfig['theme'] = { ...DefaultConfig.theme }
  private _smoothScrollDuration: number = DefaultConfig.smoothScrollDuration!
  private _macOptionIsMeta: boolean = DefaultConfig.macOptionIsMeta!
  
  private _shell: Shell

  get noBell() { return this._noBell }
  get fontFamily() { return this._fontFamily }
  get fontSize() { return this._fontSize }
  get cursorBlink() { return this._cursorBlink }
  get cursorStyle() { return this._cursorStyle }
  get theme() { return this._theme }
  get smoothScrollDuration() { return this._smoothScrollDuration }
  get macOptionIsMeta() { return this._macOptionIsMeta }

  constructor(shell: Shell) {
    this._shell = shell
  }

  /**
   * Applies a partial configuration to the current config
   */
  private applyConfig(config: Partial<IShellConfig>) {
    if (typeof config.noBell === 'boolean') this._noBell = config.noBell
    if (typeof config.fontFamily === 'string') this._fontFamily = config.fontFamily
    if (typeof config.fontSize === 'number') this._fontSize = config.fontSize
    if (typeof config.cursorBlink === 'boolean') this._cursorBlink = config.cursorBlink
    if (['block', 'underline', 'bar'].includes(config.cursorStyle as string)) this._cursorStyle = config.cursorStyle as 'block' | 'underline' | 'bar'
    if (typeof config.smoothScrollDuration === 'number') this._smoothScrollDuration = config.smoothScrollDuration
    if (typeof config.macOptionIsMeta === 'boolean') this._macOptionIsMeta = config.macOptionIsMeta
    
    if (config.theme) {
      if (config.theme.name && ThemePresets[config.theme.name]) {
        this._theme = { ...this._theme, ...ThemePresets[config.theme.name] }
      } else {
        this._theme = { ...this._theme, ...config.theme }
      }
    }
  }

  /**
   * Loads configuration from /etc/shell.toml and ~/.config/shell.toml
   */
  async load() {
    try {
      // Load system default config first
      if (await this._shell.context.fs.promises.exists('/etc/shell.toml')) {
        try {
          const content = await this._shell.context.fs.promises.readFile('/etc/shell.toml', 'utf-8')
          const config = parse(content) as Partial<IShellConfig>
          this.applyConfig(config)
        } catch (error) {
          console.warn('Failed to load system shell config:', error)
        }
      }

      // Load user config second (overwrites system defaults)
      const home = this._shell.env.get('HOME')
      if (home) {
        const configPath = `${home}/.config/shell.toml`
        if (await this._shell.context.fs.promises.exists(configPath)) {
          const content = await this._shell.context.fs.promises.readFile(configPath, 'utf-8')
          const config = parse(content) as Partial<IShellConfig>
          this.applyConfig(config)
        }
      }
    } catch (error) {
      console.warn('Failed to load shell config:', error)
    }
  }

  setTheme(theme: string | IShellConfig['theme']) {
    if (typeof theme === 'string') {
      if (Object.prototype.hasOwnProperty.call(ThemePresets, theme)) {
        const preset = ThemePresets[theme]
        this._theme = { ...this._theme, ...preset }
        if (this._theme) {
          this._theme.name = theme
        }
      }
    } else {
      this._theme = { ...this._theme, ...theme }
    }
    
    this._shell.terminal.updateConfig()
  }
}
