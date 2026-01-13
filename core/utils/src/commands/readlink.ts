import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: readlink [OPTION]... FILE...
Print value of a symbolic link or canonical file name.

  -f, --canonicalize      canonicalize by following every symlink in every component
  -e, --canonicalize-existing  canonicalize by following every symlink in every component that exists
  -m, --canonicalize-missing   canonicalize by following every symlink in every component, without requirements on components existence
  --help                  display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'readlink',
    description: 'Print value of a symbolic link or canonical file name',
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

      let canonicalize = false
      let canonicalizeExisting = false
      let canonicalizeMissing = false
      const files: string[] = []

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-f' || arg === '--canonicalize') {
          canonicalize = true
        } else if (arg === '-e' || arg === '--canonicalize-existing') {
          canonicalizeExisting = true
        } else if (arg === '-m' || arg === '--canonicalize-missing') {
          canonicalizeMissing = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('f')) canonicalize = true
          if (flags.includes('e')) canonicalizeExisting = true
          if (flags.includes('m')) canonicalizeMissing = true
          const invalidFlags = flags.filter(f => !['f', 'e', 'm'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `readlink: invalid option -- '${invalidFlags[0]}'`)
            await writelnStderr(process, terminal, "Try 'readlink --help' for more information.")
            return 1
          }
        } else {
          files.push(arg)
        }
      }

      if (files.length === 0) {
        await writelnStderr(process, terminal, 'readlink: missing operand')
        await writelnStderr(process, terminal, "Try 'readlink --help' for more information.")
        return 1
      }

      let hasError = false

      for (const file of files) {
        const fullPath = path.resolve(shell.cwd, file)

        try {
          if (canonicalize || canonicalizeExisting || canonicalizeMissing) {
            const resolved = path.resolve(fullPath)
            await writelnStdout(process, terminal, resolved)
          } else {
            const linkTarget = await shell.context.fs.promises.readlink(fullPath)
            await writelnStdout(process, terminal, linkTarget)
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          if (errorMessage.includes('not a symlink') || errorMessage.includes('EINVAL')) {
            await writelnStderr(process, terminal, `readlink: ${file}: invalid symlink`)
          } else if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
            await writelnStderr(process, terminal, `readlink: ${file}: No such file or directory`)
          } else {
            await writelnStderr(process, terminal, `readlink: ${file}: ${errorMessage}`)
          }
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
