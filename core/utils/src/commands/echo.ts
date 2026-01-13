import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: echo [OPTION]... [STRING]...
Echo the STRING(s) to standard output.

  -e     enable interpretation of backslash escapes
  -n     do not output the trailing newline
  --help display this help and exit`
  writelnStderr(process, terminal, usage)
}

function interpretEscapes(text: string): string {
  let result = ''
  let i = 0
  
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      const next = text[i + 1]
      switch (next) {
        case '\\':
          result += '\\'
          i += 2
          break
        case 'a':
          result += '\x07'
          i += 2
          break
        case 'b':
          result += '\b'
          i += 2
          break
        case 'c':
          return result
        case 'e':
        case 'E':
          result += '\x1b'
          i += 2
          break
        case 'f':
          result += '\f'
          i += 2
          break
        case 'n':
          result += '\n'
          i += 2
          break
        case 'r':
          result += '\r'
          i += 2
          break
        case 't':
          result += '\t'
          i += 2
          break
        case 'v':
          result += '\v'
          i += 2
          break
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7': {
          let octal = ''
          let j = i + 1
          while (j < text.length && j < i + 4) {
            const char = text[j]
            if (char && /[0-7]/.test(char)) {
              octal += char
              j++
            } else {
              break
            }
          }
          if (octal) {
            result += String.fromCharCode(parseInt(octal, 8))
            i = j
          } else {
            result += text[i]
            i++
          }
          break
        }
        case 'x': {
          let hex = ''
          let j = i + 2
          while (j < text.length && j < i + 4) {
            const char = text[j]
            if (char && /[0-9a-fA-F]/.test(char)) {
              hex += char
              j++
            } else {
              break
            }
          }
          if (hex) {
            result += String.fromCharCode(parseInt(hex, 16))
            i = j
          } else {
            result += text[i]
            i++
          }
          break
        }
        default:
          result += text[i]
          i++
          break
      }
    } else {
      result += text[i]
      i++
    }
  }
  
  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'echo',
    description: 'Print arguments to the standard output',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length === 0) {
        await writelnStdout(process, terminal, '')
        return 0
      }

      let noNewline = false
      let enableEscapes = false
      const textParts: string[] = []
      let i = 0

      while (i < argv.length) {
        const arg = argv[i]
        if (!arg) {
          i++
          continue
        }
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-n') {
          noNewline = true
        } else if (arg === '-e') {
          enableEscapes = true
        } else if (arg.startsWith('-') && arg.length > 1 && arg !== '--') {
          const flags = arg.slice(1).split('')
          if (flags.includes('n')) {
            noNewline = true
          }
          if (flags.includes('e')) {
            enableEscapes = true
          }
          const invalidFlag = flags.find(f => f !== 'n' && f !== 'e')
          if (invalidFlag) {
            await writelnStdout(process, terminal, `echo: invalid option -- '${invalidFlag}'`)
            return 1
          }
        } else {
          textParts.push(arg)
        }
        i++
      }

      let text = textParts.join(' ')
      if (enableEscapes) {
        text = interpretEscapes(text)
      }
      const output = noNewline ? text : text + '\n'

      if (process) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(new TextEncoder().encode(output))
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(output)
      }

      return 0
    }
  })
}

