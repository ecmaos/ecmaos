import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: od [OPTION]... [FILE]...
Dump files in octal and other formats.

  -A, --address-radix=RADIX  address format: d (decimal), o (octal), x (hex), n (none)
  -t, --format=TYPE          output format: o (octal), x (hex), d (decimal), u (unsigned), c (char), a (named char)
  -N, --read-bytes=BYTES     limit number of bytes to read
  -j, --skip-bytes=BYTES     skip bytes before reading
  --help                     display this help and exit`
  writelnStderr(process, terminal, usage)
}

function formatAddress(offset: number, radix: string): string {
  switch (radix) {
    case 'd':
      return offset.toString(10).padStart(7, '0')
    case 'o':
      return offset.toString(8).padStart(7, '0')
    case 'x':
      return offset.toString(16).padStart(7, '0')
    case 'n':
      return ''
    default:
      return offset.toString(8).padStart(7, '0')
  }
}

function formatByte(byte: number, format: string): string {
  switch (format) {
    case 'o':
    case 'o1':
      return byte.toString(8).padStart(3, '0')
    case 'x':
    case 'x1':
      return byte.toString(16).padStart(2, '0')
    case 'd':
    case 'd1':
      return byte.toString(10).padStart(3, '0')
    case 'u':
    case 'u1':
      return byte.toString(10).padStart(3, '0')
    case 'c':
      if (byte >= 32 && byte <= 126) {
        return `'${String.fromCharCode(byte)}'`
      } else if (byte === 0) {
        return '\\0'
      } else if (byte === 7) {
        return '\\a'
      } else if (byte === 8) {
        return '\\b'
      } else if (byte === 9) {
        return '\\t'
      } else if (byte === 10) {
        return '\\n'
      } else if (byte === 11) {
        return '\\v'
      } else if (byte === 12) {
        return '\\f'
      } else if (byte === 13) {
        return '\\r'
      } else {
        return `\\${byte.toString(8).padStart(3, '0')}`
      }
    case 'a':
      if (byte >= 32 && byte <= 126) {
        return String.fromCharCode(byte)
      } else {
        return '.'
      }
    default:
      return byte.toString(8).padStart(3, '0')
  }
}

function formatLine(data: Uint8Array, offset: number, addressRadix: string, format: string): string {
  const address = formatAddress(offset, addressRadix)
  const bytes: string[] = []
  const ascii: string[] = []
  
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte === undefined) continue
    
    bytes.push(formatByte(byte, format))
    
    if (byte >= 32 && byte <= 126) {
      ascii.push(String.fromCharCode(byte))
    } else {
      ascii.push('.')
    }
  }
  
  let result = address ? `${address}: ` : ''
  result += bytes.join(' ')
  
  if (format !== 'c' && format !== 'a') {
    result += '  ' + ascii.join('')
  }
  
  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'od',
    description: 'Dump files in octal and other formats',
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

      let addressRadix = 'o'
      let format = 'o1'
      let readBytes: number | null = null
      let skipBytes = 0
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-A' || arg === '--address-radix') {
          if (i + 1 < argv.length) {
            const radix = argv[++i]
            if (radix && ['d', 'o', 'x', 'n'].includes(radix)) {
              addressRadix = radix
            } else {
              await writelnStderr(process, terminal, `od: invalid address radix: ${radix}`)
              return 1
            }
          }
        } else if (arg.startsWith('--address-radix=')) {
          const radix = arg.slice(16)
          if (['d', 'o', 'x', 'n'].includes(radix)) {
            addressRadix = radix
          } else {
            await writelnStderr(process, terminal, `od: invalid address radix: ${radix}`)
            return 1
          }
        } else if (arg.startsWith('-A')) {
          const radix = arg.slice(2)
          if (['d', 'o', 'x', 'n'].includes(radix)) {
            addressRadix = radix
          } else {
            await writelnStderr(process, terminal, `od: invalid address radix: ${radix}`)
            return 1
          }
        } else if (arg === '-t' || arg === '--format') {
          if (i + 1 < argv.length) {
            const fmt = argv[++i]
            if (fmt) {
              format = fmt
            }
          }
        } else if (arg.startsWith('--format=')) {
          format = arg.slice(9)
        } else if (arg.startsWith('-t')) {
          format = arg.slice(2) || 'o1'
        } else if (arg === '-N' || arg === '--read-bytes') {
          if (i + 1 < argv.length) {
            const bytesStr = argv[++i]
            if (bytesStr !== undefined) {
              const parsed = parseInt(bytesStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                readBytes = parsed
              } else {
                await writelnStderr(process, terminal, `od: invalid byte count: ${bytesStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--read-bytes=')) {
          const bytesStr = arg.slice(13)
          const parsed = parseInt(bytesStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            readBytes = parsed
          } else {
            await writelnStderr(process, terminal, `od: invalid byte count: ${bytesStr}`)
            return 1
          }
        } else if (arg.startsWith('-N')) {
          const bytesStr = arg.slice(2)
          const parsed = parseInt(bytesStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            readBytes = parsed
          } else {
            await writelnStderr(process, terminal, `od: invalid byte count: ${bytesStr}`)
            return 1
          }
        } else if (arg === '-j' || arg === '--skip-bytes') {
          if (i + 1 < argv.length) {
            const bytesStr = argv[++i]
            if (bytesStr !== undefined) {
              const parsed = parseInt(bytesStr, 10)
              if (!isNaN(parsed) && parsed >= 0) {
                skipBytes = parsed
              } else {
                await writelnStderr(process, terminal, `od: invalid skip count: ${bytesStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--skip-bytes=')) {
          const bytesStr = arg.slice(13)
          const parsed = parseInt(bytesStr, 10)
          if (!isNaN(parsed) && parsed >= 0) {
            skipBytes = parsed
          } else {
            await writelnStderr(process, terminal, `od: invalid skip count: ${bytesStr}`)
            return 1
          }
        } else if (arg.startsWith('-j')) {
          const bytesStr = arg.slice(2)
          const parsed = parseInt(bytesStr, 10)
          if (!isNaN(parsed) && parsed >= 0) {
            skipBytes = parsed
          } else {
            await writelnStderr(process, terminal, `od: invalid skip count: ${bytesStr}`)
            return 1
          }
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        } else {
          await writelnStderr(process, terminal, `od: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'od --help' for more information.")
          return 1
        }
      }

      const writer = process.stdout.getWriter()

      try {
        let data: Uint8Array

        if (files.length === 0) {
          if (!process.stdin) {
            return 0
          }

          const reader = process.stdin.getReader()
          const chunks: Uint8Array[] = []

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) {
                chunks.push(value)
              }
            }
          } finally {
            reader.releaseLock()
          }

          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
          data = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }
        } else {
          const file = files[0]
          if (!file) return 1
          const fullPath = path.resolve(shell.cwd, file)

          try {
            if (fullPath.startsWith('/dev')) {
              await writelnStderr(process, terminal, `od: ${file}: cannot process device files`)
              return 1
            }

            const fileData = await shell.context.fs.promises.readFile(fullPath)
            data = new Uint8Array(fileData)
          } catch (error) {
            await writelnStderr(process, terminal, `od: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            return 1
          }
        }

        if (skipBytes > 0) {
          if (skipBytes >= data.length) {
            return 0
          }
          data = data.slice(skipBytes)
        }

        if (readBytes !== null && readBytes < data.length) {
          data = data.slice(0, readBytes)
        }

        const bytesPerLine = 16
        let offset = 0

        while (offset < data.length) {
          const lineData = data.slice(offset, offset + bytesPerLine)
          const line = formatLine(lineData, offset + skipBytes, addressRadix, format)
          await writer.write(new TextEncoder().encode(line + '\n'))
          offset += lineData.length
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `od: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
