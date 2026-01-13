import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cksum [FILE]...
Print CRC checksum and byte count for each FILE.

If no FILE is specified, or if FILE is -, read standard input.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

function calculateCRC32(data: Uint8Array): number {
  let crc = 0xffffffff
  const polynomial = 0xedb88320

  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte === undefined) continue
    crc ^= byte
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ polynomial
      } else {
        crc = crc >>> 1
      }
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cksum',
    description: 'Print CRC checksum and byte count',
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

      const files: string[] = []

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        } else {
          await writelnStderr(process, terminal, `cksum: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'cksum --help' for more information.")
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

          const crc = calculateCRC32(data)
          await writer.write(new TextEncoder().encode(`${crc} ${data.length}\n`))
          return 0
        }

        for (const file of files) {
          const fullPath = path.resolve(shell.cwd, file)

          try {
            if (fullPath.startsWith('/dev')) {
              await writelnStderr(process, terminal, `cksum: ${file}: cannot checksum device files`)
              continue
            }

            const data = await shell.context.fs.promises.readFile(fullPath)
            const bytes = new Uint8Array(data)
            const crc = calculateCRC32(bytes)
            await writer.write(new TextEncoder().encode(`${crc} ${bytes.length} ${file}\n`))
          } catch (error) {
            await writelnStderr(process, terminal, `cksum: ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `cksum: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
