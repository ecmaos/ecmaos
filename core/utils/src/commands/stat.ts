import path from 'path'
import chalk from 'chalk'
import * as zipjs from '@zip.js/zip.js'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: stat [OPTION]... FILE...
Display file or file system status.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'stat',
    description: 'Display information about a file or directory',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      // Filter out options/flags and get target paths
      const targets = argv.length > 0 
        ? argv.filter(arg => !arg.startsWith('-'))
        : [shell.cwd]

      if (targets.length === 0) {
        targets.push(shell.cwd)
      }

      let hasError = false

      for (const target of targets) {
        const fullPath = path.resolve(shell.cwd, target)
        
        try {
          const stats = await shell.context.fs.promises.stat(fullPath)
          
          if (targets.length > 1) {
            await writelnStdout(process, terminal, `${target}:`)
          }
          await writelnStdout(process, terminal, JSON.stringify(stats, null, 2))

          const extension = path.extname(fullPath)
          if (extension === '.zip') {
            const blob = new Blob([new Uint8Array(await shell.context.fs.promises.readFile(fullPath))])
            const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(blob))
            const entries = await zipReader.getEntries()
            await writelnStdout(process, terminal, chalk.bold('\nZIP Entries:'))
            for (const entry of entries) {
              await writelnStdout(process, terminal, `${chalk.blue(entry.filename)} (${entry.uncompressedSize} bytes)`)
            }
          }
          
          if (targets.length > 1) {
            await writelnStdout(process, terminal, '')
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          await writelnStderr(process, terminal, `stat: ${target}: ${errorMessage}`)
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
