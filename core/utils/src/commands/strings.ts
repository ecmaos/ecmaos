import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: strings [OPTION]... [FILE]...
Print the sequences of printable characters in files.

  -n, --bytes=MIN_LEN    print sequences of at least MIN_LEN characters (default: 4)
  --help                 display this help and exit`
  writelnStderr(process, terminal, usage)
}

function extractStrings(data: Uint8Array, minLen: number): string[] {
  const strings: string[] = []
  let currentString = ''
  
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte === undefined) continue
    
    if (byte >= 32 && byte <= 126) {
      currentString += String.fromCharCode(byte)
    } else {
      if (currentString.length >= minLen) {
        strings.push(currentString)
      }
      currentString = ''
    }
  }
  
  if (currentString.length >= minLen) {
    strings.push(currentString)
  }
  
  return strings
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'strings',
    description: 'Print the sequences of printable characters in files',
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

      let minLen = 4
      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-n' || arg === '--bytes') {
          if (i + 1 < argv.length) {
            const lenStr = argv[++i]
            if (lenStr !== undefined) {
              const parsed = parseInt(lenStr, 10)
              if (!isNaN(parsed) && parsed > 0) {
                minLen = parsed
              } else {
                await writelnStderr(process, terminal, `strings: invalid minimum length: ${lenStr}`)
                return 1
              }
            }
          }
        } else if (arg.startsWith('--bytes=')) {
          const lenStr = arg.slice(8)
          const parsed = parseInt(lenStr, 10)
          if (!isNaN(parsed) && parsed > 0) {
            minLen = parsed
          } else {
            await writelnStderr(process, terminal, `strings: invalid minimum length: ${lenStr}`)
            return 1
          }
        } else if (arg.startsWith('-n')) {
          const lenStr = arg.slice(2)
          if (lenStr) {
            const parsed = parseInt(lenStr, 10)
            if (!isNaN(parsed) && parsed > 0) {
              minLen = parsed
            } else {
              await writelnStderr(process, terminal, `strings: invalid minimum length: ${lenStr}`)
              return 1
            }
          }
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        } else {
          await writelnStderr(process, terminal, `strings: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'strings --help' for more information.")
          return 1
        }
      }

      const writer = process.stdout.getWriter()

      try {
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
          const data = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            data.set(chunk, offset)
            offset += chunk.length
          }

          const extractedStrings = extractStrings(data, minLen)
          for (const str of extractedStrings) {
            await writer.write(new TextEncoder().encode(str + '\n'))
          }

          return 0
        }

        for (const file of files) {
          const fullPath = path.resolve(shell.cwd, file)

          try {
            if (fullPath.startsWith('/dev')) {
              await writelnStderr(process, terminal, `strings: ${file}: cannot process device files`)
              continue
            }

            const data = await shell.context.fs.promises.readFile(fullPath)
            const extractedStrings = extractStrings(new Uint8Array(data), minLen)
            for (const str of extractedStrings) {
              await writer.write(new TextEncoder().encode(str + '\n'))
            }
          } catch (error) {
            await writelnStderr(process, terminal, `strings: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `strings: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
