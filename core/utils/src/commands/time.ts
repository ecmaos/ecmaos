import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'
import path from 'path'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: time COMMAND [ARG]...
Run COMMAND and print a summary of the real, user, and system time used.

  --help  display this help and exit

Note: This is a simplified version that measures real (wall clock) time.`
  writelnStderr(process, terminal, usage)
}

function formatTime(seconds: number): string {
  if (seconds < 1) {
    return `${(seconds * 1000).toFixed(0)}ms`
  }
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`
  }
  const mins = Math.floor(seconds / 60)
  const secs = (seconds % 60).toFixed(2)
  return `${mins}m${secs}s`
}

async function resolveCommand(shell: Shell, command: string): Promise<string | undefined> {
  const DefaultShellPath = '$HOME/bin:/bin:/usr/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/sbin'
  
  if (command.startsWith('./')) {
    const cwdCommand = path.join(shell.cwd, command.slice(2))
    if (await shell.context.fs.promises.exists(cwdCommand)) {
      return cwdCommand
    }
    return undefined
  }

  const paths = shell.env.get('PATH')?.split(':') || DefaultShellPath.split(':')
  const resolvedCommand = path.resolve(command)

  if (await shell.context.fs.promises.exists(resolvedCommand)) {
    return resolvedCommand
  }

  for (const pathDir of paths) {
    const expandedPath = pathDir.replace(/\$([A-Z_]+)/g, (_, name) => shell.env.get(name) || '')
    const fullPath = `${expandedPath}/${command}`
    if (await shell.context.fs.promises.exists(fullPath)) return fullPath
  }

  return undefined
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'time',
    description: 'Measure command execution time',
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

      if (argv.length === 0 || !argv[0]) {
        await writelnStderr(process, terminal, 'time: missing command')
        await writelnStderr(process, terminal, "Try 'time --help' for more information.")
        return 1
      }

      const command = argv[0]
      const commandArgs = argv.slice(1)

      const resolvedCommand = await resolveCommand(shell, command)
      if (!resolvedCommand) {
        await writelnStderr(process, terminal, `time: command not found: ${command}`)
        return 127
      }

      const startTime = performance.now()

      const subcommandStdout = new WritableStream<Uint8Array>({
        write: async (chunk) => {
          const writer = process.stdout.getWriter()
          try {
            await writer.write(chunk)
          } finally {
            writer.releaseLock()
          }
        }
      })

      const subcommandStderr = new WritableStream<Uint8Array>({
        write: async (chunk) => {
          const writer = process.stderr.getWriter()
          try {
            await writer.write(chunk)
          } finally {
            writer.releaseLock()
          }
        }
      })

      try {
        const exitCode = await kernel.execute({
          command: resolvedCommand,
          args: commandArgs,
          shell: shell,
          terminal: terminal,
          stdin: process.stdin,
          stdout: subcommandStdout,
          stderr: subcommandStderr
        })

        const endTime = performance.now()
        const elapsedSeconds = (endTime - startTime) / 1000

        await writelnStderr(process, terminal, `\nreal    ${formatTime(elapsedSeconds)}`)
        await writelnStderr(process, terminal, `user    ${formatTime(elapsedSeconds)}`)
        await writelnStderr(process, terminal, `sys     ${formatTime(0)}`)

        return exitCode
      } catch (error) {
        const endTime = performance.now()
        const elapsedSeconds = (endTime - startTime) / 1000

        await writelnStderr(process, terminal, `\nreal    ${formatTime(elapsedSeconds)}`)
        await writelnStderr(process, terminal, `user    ${formatTime(elapsedSeconds)}`)
        await writelnStderr(process, terminal, `sys     ${formatTime(0)}`)

        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `time: ${errorMessage}`)
        return 1
      }
    }
  })
}
