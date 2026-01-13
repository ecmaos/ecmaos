import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: printf FORMAT [ARGUMENT]...
Format and print ARGUMENT(s) according to FORMAT.

FORMAT controls the output as in C printf.  Interpreted sequences:

  \\\\     backslash
  \\a      alert (BEL)
  \\b      backspace
  \\c      produce no further output
  \\e      escape
  \\f      form feed
  \\n      new line
  \\r      carriage return
  \\t      horizontal tab
  \\v      vertical tab
  \\0NNN   byte with octal value NNN (1 to 3 digits)
  \\xHH    byte with hexadecimal value HH (1 to 2 digits)

Conversion specifiers:

  %b      ARGUMENT as a string with '\\' escapes interpreted
  %c      ARGUMENT as a single character
  %d      ARGUMENT as a signed decimal integer
  %i      ARGUMENT as a signed decimal integer
  %o      ARGUMENT as an unsigned octal number
  %s      ARGUMENT as a string
  %u      ARGUMENT as an unsigned decimal integer
  %x      ARGUMENT as an unsigned hexadecimal number (lowercase)
  %X      ARGUMENT as an unsigned hexadecimal number (uppercase)
  %%      a single %

  --help  display this help and exit`
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

function formatValue(format: string, value: string): string {
  switch (format) {
    case '%b':
      return interpretEscapes(value)
    case '%c': {
      const num = parseInt(value, 10)
      if (!isNaN(num)) {
        return String.fromCharCode(num)
      }
      return value[0] || ''
    }
    case '%d':
    case '%i': {
      const num = parseInt(value, 10)
      return isNaN(num) ? '0' : num.toString()
    }
    case '%o': {
      const num = parseInt(value, 10)
      return isNaN(num) ? '0' : num.toString(8)
    }
    case '%s':
      return value
    case '%u': {
      const num = parseInt(value, 10)
      if (isNaN(num)) return '0'
      const unsigned = num >>> 0
      return unsigned.toString()
    }
    case '%x': {
      const num = parseInt(value, 10)
      return isNaN(num) ? '0' : (num >>> 0).toString(16)
    }
    case '%X': {
      const num = parseInt(value, 10)
      return isNaN(num) ? '0' : (num >>> 0).toString(16).toUpperCase()
    }
    case '%%':
      return '%'
    default:
      return format
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'printf',
    description: 'Format and print data',
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

      if (argv.length === 0) {
        await writelnStderr(process, terminal, 'printf: missing format string')
        await writelnStderr(process, terminal, "Try 'printf --help' for more information.")
        return 1
      }

      const format = argv[0] || ''
      const args = argv.slice(1)

      let result = ''
      let argIndex = 0
      let i = 0

      while (i < format.length) {
        if (format[i] === '%' && i + 1 < format.length) {
          const next = format[i + 1]
          if (next === '%') {
            result += '%'
            i += 2
          } else {
            const specifier = `%${next}`
            if (argIndex < args.length) {
              result += formatValue(specifier, args[argIndex] || '')
              argIndex++
            } else {
              result += specifier
            }
            i += 2
          }
        } else if (format[i] === '\\' && i + 1 < format.length) {
          const escapeSeq = format.slice(i)
          const match = escapeSeq.match(/^\\([\\abceEfnrtv]|x[0-9a-fA-F]{1,2}|0[0-7]{1,3})/)
          if (match) {
            const escaped = interpretEscapes(match[0])
            result += escaped
            i += match[0].length
          } else {
            result += format[i]
            i++
          }
        } else {
          result += format[i]
          i++
        }
      }

      if (process.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(new TextEncoder().encode(result))
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(result)
      }

      return 0
    }
  })
}
