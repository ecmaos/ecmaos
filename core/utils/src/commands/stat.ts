import path from 'path'
import chalk from 'chalk'
import * as zipjs from '@zip.js/zip.js'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: stat [OPTION]... FILE...
Display file or file system status.

  --help  display this help and exit`
  writelnStdout(process, terminal, usage)
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

      const argPath = argv.length > 0 && !argv[0].startsWith('-') ? argv[0] : shell.cwd
      const fullPath = argPath ? path.resolve(shell.cwd, argPath) : shell.cwd
      const stats = await shell.context.fs.promises.stat(fullPath)
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
      return 0
    }
  })
}
