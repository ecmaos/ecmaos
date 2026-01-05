import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: open [FILE|URL]
Open a file or URL.

  --help                   display this help and exit

Examples:
  open file.txt                    open a file in the current directory
  open /path/to/file.txt           open a file by absolute path
  open sample-1/sample-5 (1).jpg   open a file with spaces in the name
  open https://example.com         open a URL in a new tab`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'open',
    description: 'Open a file or URL',
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
        await writelnStderr(process, terminal, `open: missing file or URL argument`)
        await writelnStderr(process, terminal, `Try 'open --help' for more information.`)
        return 1
      }

      const filePath = argv.join(' ')

      if (!filePath) {
        await writelnStderr(process, terminal, `open: missing file or URL argument`)
        return 1
      }

      // Check if it's a URL by looking for URL schemes
      const urlPattern = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
      const isURL = urlPattern.test(filePath)

      if (isURL) {
        window.open(filePath, '_blank')
        return 0
      }

      // Treat as file path - resolve relative to current working directory
      const fullPath = path.resolve(shell.cwd, filePath)

      try {
        if (!(await shell.context.fs.promises.exists(fullPath))) {
          await writelnStderr(process, terminal, chalk.red(`open: file not found: ${fullPath}`))
          return 1
        }

        const file = await shell.context.fs.promises.readFile(fullPath)
        const blob = new Blob([new Uint8Array(file)], { type: 'application/octet-stream' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = path.basename(fullPath)
        a.click()
        window.URL.revokeObjectURL(url)
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`open: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }
  })
}
