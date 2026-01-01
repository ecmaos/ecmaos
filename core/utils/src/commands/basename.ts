import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: basename NAME [SUFFIX]
       basename OPTION... NAME...
Strip directory and suffix from filenames.

  -s, --suffix=SUFFIX  remove a trailing SUFFIX
  --help               display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'basename',
    description: 'Strip directory and suffix from filenames',
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

      let suffix: string | undefined
      const paths: string[] = []
      let i = 0

      while (i < argv.length) {
        const arg = argv[i]
        if (arg === '-s' || arg === '--suffix') {
          if (i + 1 < argv.length) {
            suffix = argv[++i]
          } else {
            await writelnStderr(process, terminal, 'basename: option requires an argument -- \'s\'')
            return 1
          }
        } else if (arg.startsWith('--suffix=')) {
          suffix = arg.slice(9)
        } else if (arg.startsWith('-s')) {
          suffix = arg.slice(2)
        } else if (!arg.startsWith('-')) {
          paths.push(arg)
        }
        i++
      }

      if (paths.length === 0) {
        await writelnStderr(process, terminal, 'basename: missing operand')
        return 1
      }

      const writer = process.stdout.getWriter()

      try {
        for (const filePath of paths) {
          let basename = path.basename(filePath)
          
          if (suffix && basename.endsWith(suffix)) {
            basename = basename.slice(0, -suffix.length)
          }
          
          await writer.write(new TextEncoder().encode(basename + '\n'))
        }

        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
