import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: awk [OPTION]... 'program' [FILE]...
Pattern scanning and text processing language.

  -F, --field-separator=FS   set field separator (default: whitespace)
  -v, --assign=VAR=VAL        assign variable VAR to value VAL
  --help                     display this help and exit

Basic usage:
  awk '{ print $1 }' file              Print first field of each line
  awk '/pattern/ { print }' file        Print lines matching pattern
  awk 'BEGIN { print "start" } { print } END { print "end" }' file

Variables:
  $0    whole line
  $1, $2, ...  field numbers
  NR    record number (line number)
  NF    number of fields`
  writelnStderr(process, terminal, usage)
}

interface AwkProgram {
  begin?: string[]
  pattern?: string
  action?: string
  end?: string[]
}

function parseAwkProgram(program: string): AwkProgram | null {
  const result: AwkProgram = {}
  
  let beginMatch = program.match(/BEGIN\s*\{([^}]*)\}/)
  if (beginMatch) {
    result.begin = beginMatch[1]?.split(';').map(s => s.trim()).filter(s => s) ?? []
  }
  
  let endMatch = program.match(/END\s*\{([^}]*)\}/)
  if (endMatch) {
    result.end = endMatch[1]?.split(';').map(s => s.trim()).filter(s => s) ?? []
  }
  
  let mainMatch = program.match(/(?:BEGIN\s*\{[^}]*\})?\s*([^}]*?)\s*(?:\{([^}]*)\})?\s*(?:END\s*\{[^}]*\})?/)
  if (!mainMatch) {
    const simpleMatch = program.match(/\{([^}]*)\}/)
    if (simpleMatch) {
      result.action = simpleMatch[1]?.trim() ?? ''
    } else {
      return null
    }
  } else {
    const patternPart = mainMatch[1]?.trim()
    const actionPart = mainMatch[2]?.trim()
    
    if (patternPart && !patternPart.startsWith('{')) {
      if (patternPart.startsWith('/') && patternPart.endsWith('/')) {
        result.pattern = patternPart.slice(1, -1)
      } else {
        result.pattern = patternPart
      }
    }
    
    if (actionPart) {
      result.action = actionPart
    } else if (!patternPart) {
      result.action = 'print'
    }
  }
  
  if (!result.action && !result.begin && !result.end) {
    return null
  }
  
  return result
}

function splitFields(line: string, fs: string): string[] {
  if (fs === ' ') {
    return line.trim().split(/\s+/)
  }
  return line.split(fs)
}

function executeAction(action: string, fields: string[], line: string, NR: number, NF: number): string {
  if (!action || action.trim() === 'print' || action.trim() === '') {
    return line
  }
  
  const printMatch = action.match(/print\s+(.+)/)
  if (printMatch) {
    const args = printMatch[1]?.trim() ?? ''
    const parts = args.split(',').map(s => s.trim())
    const output: string[] = []
    
    for (const part of parts) {
      if (part === '$0') {
        output.push(line)
      } else if (part.match(/^\$\d+$/)) {
        const fieldNum = parseInt(part.slice(1), 10)
        if (fieldNum >= 1 && fieldNum <= fields.length) {
          output.push(fields[fieldNum - 1] || '')
        }
      } else if (part === 'NR') {
        output.push(String(NR))
      } else if (part === 'NF') {
        output.push(String(NF))
      } else if (part.startsWith('"') && part.endsWith('"')) {
        output.push(part.slice(1, -1))
      } else if (part.startsWith("'") && part.endsWith("'")) {
        output.push(part.slice(1, -1))
      } else {
        output.push(part)
      }
    }
    
    return output.join(' ')
  }
  
  return line
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'awk',
    description: 'Pattern scanning and text processing language',
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

      let fieldSeparator = ' '
      const variables: Record<string, string> = {}
      const args: string[] = []
      let program: string | undefined

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-F' || arg === '--field-separator') {
          if (i + 1 < argv.length) {
            fieldSeparator = argv[++i] || ' '
          }
        } else if (arg.startsWith('--field-separator=')) {
          fieldSeparator = arg.slice(18)
        } else if (arg.startsWith('-F')) {
          fieldSeparator = arg.slice(2) || ' '
        } else if (arg === '-v' || arg === '--assign') {
          if (i + 1 < argv.length) {
            const assign = argv[++i] || ''
            const [key, ...valueParts] = assign.split('=')
            if (key) {
              variables[key] = valueParts.join('=')
            }
          }
        } else if (arg.startsWith('--assign=')) {
          const assign = arg.slice(9)
          const [key, ...valueParts] = assign.split('=')
          if (key) {
            variables[key] = valueParts.join('=')
          }
        } else if (arg.startsWith('-v')) {
          const assign = arg.slice(2)
          const [key, ...valueParts] = assign.split('=')
          if (key) {
            variables[key] = valueParts.join('=')
          }
        } else if (!arg.startsWith('-')) {
          if (!program && (arg.startsWith("'") || arg.startsWith('"'))) {
            program = arg.slice(1, -1)
          } else if (!program) {
            program = arg
          } else {
            args.push(arg)
          }
        }
      }

      if (!program) {
        await writelnStderr(process, terminal, 'awk: program is required')
        await writelnStderr(process, terminal, "Try 'awk --help' for more information.")
        return 1
      }

      const parsedProgram = parseAwkProgram(program)
      if (!parsedProgram) {
        await writelnStderr(process, terminal, 'awk: invalid program')
        return 1
      }

      const writer = process.stdout.getWriter()

      try {
        let lines: string[] = []

        if (args.length === 0) {
          if (!process.stdin) {
            return 0
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) {
                buffer += decoder.decode(value, { stream: true })
                const newLines = buffer.split('\n')
                buffer = newLines.pop() || ''
                lines.push(...newLines)
              }
            }
            if (buffer) {
              lines.push(buffer)
            }
          } finally {
            reader.releaseLock()
          }
        } else {
          for (const file of args) {
            const fullPath = path.resolve(shell.cwd, file)

            let interrupted = false
            const interruptHandler = () => { interrupted = true }
            kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

            try {
              if (fullPath.startsWith('/dev')) {
                await writelnStderr(process, terminal, `awk: ${file}: cannot process device files`)
                continue
              }

              const handle = await shell.context.fs.promises.open(fullPath, 'r')
              const stat = await shell.context.fs.promises.stat(fullPath)

              const decoder = new TextDecoder()
              let content = ''
              let bytesRead = 0
              const chunkSize = 1024

              while (bytesRead < stat.size) {
                if (interrupted) break
                const data = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - bytesRead)
                await handle.read(data, 0, readSize, bytesRead)
                const chunk = data.subarray(0, readSize)
                content += decoder.decode(chunk, { stream: true })
                bytesRead += readSize
              }

              const fileLines = content.split('\n')
              if (fileLines[fileLines.length - 1] === '') {
                fileLines.pop()
              }
              lines.push(...fileLines)
            } catch (error) {
              await writelnStderr(process, terminal, `awk: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            } finally {
              kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
            }
          }
        }

        if (parsedProgram.begin) {
          for (const stmt of parsedProgram.begin) {
            if (stmt.trim() === 'print' || stmt.trim().startsWith('print ')) {
              const output = executeAction(stmt, [], '', 0, 0)
              if (output) {
                await writer.write(new TextEncoder().encode(output + '\n'))
              }
            }
          }
        }

        let NR = 0
        for (const line of lines) {
          NR++
          const fields = splitFields(line, fieldSeparator)
          const NF = fields.length

          let shouldProcess = true
          if (parsedProgram.pattern) {
            try {
              const regex = new RegExp(parsedProgram.pattern)
              shouldProcess = regex.test(line)
            } catch {
              shouldProcess = false
            }
          }

          if (shouldProcess && parsedProgram.action) {
            const output = executeAction(parsedProgram.action, fields, line, NR, NF)
            if (output !== null) {
              await writer.write(new TextEncoder().encode(output + '\n'))
            }
          } else if (shouldProcess && !parsedProgram.action && !parsedProgram.pattern) {
            await writer.write(new TextEncoder().encode(line + '\n'))
          }
        }

        if (parsedProgram.end) {
          for (const stmt of parsedProgram.end) {
            if (stmt.trim() === 'print' || stmt.trim().startsWith('print ')) {
              const output = executeAction(stmt, [], '', NR + 1, 0)
              if (output) {
                await writer.write(new TextEncoder().encode(output + '\n'))
              }
            }
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `awk: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
