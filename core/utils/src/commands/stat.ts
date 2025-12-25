import path from 'path'
import chalk from 'chalk'
import * as zipjs from '@zip.js/zip.js'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'stat',
    description: 'Display information about a file or directory',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, description: 'The path to the file or directory to display' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const argPath = (argv.path as string) || shell.cwd
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

