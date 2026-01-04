import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cp [OPTION]... SOURCE... DEST
Copy SOURCE to DEST, or multiple SOURCE(s) to DIRECTORY.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'cp',
    description: 'Copy files',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const args: string[] = []
      for (const arg of argv) {
        if (arg && !arg.startsWith('-')) {
          args.push(arg)
        }
      }

      if (args.length < 2) {
        await writelnStderr(process, terminal, 'cp: missing file operand')
        await writelnStderr(process, terminal, "Try 'cp --help' for more information.")
        return 1
      }

      const sources = args.slice(0, -1)
      const destination = args[args.length - 1]

      if (!destination) {
        await writelnStderr(process, terminal, 'cp: missing destination file operand')
        return 1
      }

      let hasError = false

      try {
        const destinationStats = await shell.context.fs.promises.stat(path.resolve(shell.cwd, destination)).catch(() => null)
        const isDestinationDir = destinationStats?.isDirectory()

        if (sources.length > 1 && !isDestinationDir) {
          await writelnStderr(process, terminal, `cp: target '${destination}' is not a directory`)
          return 1
        }

        for (const source of sources) {
          if (!source) continue

          const sourcePath = path.resolve(shell.cwd, source)
          const finalDestination = isDestinationDir 
            ? path.join(path.resolve(shell.cwd, destination), path.basename(source))
            : path.resolve(shell.cwd, destination)

          try {
            await shell.context.fs.promises.copyFile(sourcePath, finalDestination)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            await writelnStderr(process, terminal, `cp: ${source}: ${errorMessage}`)
            hasError = true
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `cp: ${errorMessage}`)
        hasError = true
      }

      return hasError ? 1 : 0
    }
  })
}
