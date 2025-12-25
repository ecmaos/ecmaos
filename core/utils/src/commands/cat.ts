import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writeStdout, writelnStdout } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cat',
    description: 'Concatenate files and print on the standard output',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'The path(s) to the file(s) to concatenate' },
      { name: 'bytes', type: Number, description: 'The number of bytes to read from the file' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      // Get a single writer for the entire operation
      const writer = process.stdout.getWriter()

      try {
        // If no files specified, read from stdin
        if (!argv.path || !(argv.path as string[])[0]) {
          const reader = process.stdin!.getReader()

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
        const files = (argv.path as string[]) || []
        const bytes = argv.bytes as string | undefined
        for (const file of files) {
          const fullPath = path.resolve(shell.cwd, file)

          let interrupted = false
          const interruptHandler = () => { interrupted = true }
          kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

          try {
            if (!fullPath.startsWith('/dev')) {
              const handle = await shell.context.fs.promises.open(fullPath, 'r')
              const stat = await shell.context.fs.promises.stat(fullPath)

              let bytesRead = 0
              const chunkSize = 1024

              while (bytesRead < stat.size) {
                if (interrupted) break
                const data = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - bytesRead)
                await handle.read(data, 0, readSize, bytesRead)
                await writer.write(data.subarray(0, readSize))
                bytesRead += readSize
              }
            } else {
              const device = await shell.context.fs.promises.open(fullPath)
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
        await writeStdout(process, terminal, '\n')
      }
    }
  })
}

