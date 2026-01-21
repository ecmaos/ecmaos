import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: mkdir [OPTION]... DIRECTORY...
Create the DIRECTORY(ies), if they do not already exist.

Mandatory arguments to long options are mandatory for short options too.
  -m, --mode=MODE   set file mode (as in chmod), not a=rwx - umask
  -p, --parents     no error if existing, make parent directories as needed,
                    with their file modes unaffected by any -m option.
  -v, --verbose     print a message for each created directory
      --help        display this help and exit`
  writelnStderr(process, terminal, usage)
}

function parseNumericMode(mode: string): number | null {
  if (/^0?[0-7]{1,4}$/.test(mode)) {
    return parseInt(mode, 8)
  }
  if (/^0o[0-7]{1,4}$/i.test(mode)) {
    return parseInt(mode.slice(2), 8)
  }
  return null
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'mkdir',
    description: 'Create a directory',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let parents = false
      let verbose = false
      let mode: number | undefined = undefined
      const directories: string[] = []

      let i = 0
      while (i < argv.length) {
        const arg = argv[i]
        if (!arg) {
          i++
          continue
        }

        if (arg === '--') {
          i++
          while (i < argv.length) {
            const dirArg = argv[i]
            if (dirArg) {
              directories.push(dirArg)
            }
            i++
          }
          break
        }

        if (arg.startsWith('--')) {
          if (arg === '--parents') {
            parents = true
          } else if (arg === '--verbose') {
            verbose = true
          } else if (arg.startsWith('--mode=')) {
            const modeStr = arg.slice(7)
            const parsedMode = parseNumericMode(modeStr)
            if (parsedMode === null) {
              await writelnStderr(process, terminal, `mkdir: invalid mode '${modeStr}'`)
              return 1
            }
            mode = parsedMode
          } else if (arg === '--help' || arg === '-h') {
            printUsage(process, terminal)
            return 0
          } else {
            await writelnStderr(process, terminal, `mkdir: unrecognized option '${arg}'`)
            await writelnStderr(process, terminal, "Try 'mkdir --help' for more information.")
            return 1
          }
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            const flag = arg[j]
            if (!flag) continue

            if (flag === 'p') {
              parents = true
            } else if (flag === 'v') {
              verbose = true
            } else if (flag === 'm') {
              if (j + 1 < arg.length) {
                const modeStr = arg.slice(j + 1)
                const parsedMode = parseNumericMode(modeStr)
                if (parsedMode === null) {
                  await writelnStderr(process, terminal, `mkdir: invalid mode '${modeStr}'`)
                  return 1
                }
                mode = parsedMode
                break
              } else if (i + 1 < argv.length) {
                const modeStr = argv[i + 1]
                if (!modeStr) {
                  await writelnStderr(process, terminal, "mkdir: option requires an argument -- 'm'")
                  await writelnStderr(process, terminal, "Try 'mkdir --help' for more information.")
                  return 1
                }
                const parsedMode = parseNumericMode(modeStr)
                if (parsedMode === null) {
                  await writelnStderr(process, terminal, `mkdir: invalid mode '${modeStr}'`)
                  return 1
                }
                mode = parsedMode
                i++
                break
              } else {
                await writelnStderr(process, terminal, "mkdir: option requires an argument -- 'm'")
                await writelnStderr(process, terminal, "Try 'mkdir --help' for more information.")
                return 1
              }
            } else {
              await writelnStderr(process, terminal, `mkdir: invalid option -- '${flag}'`)
              await writelnStderr(process, terminal, "Try 'mkdir --help' for more information.")
              return 1
            }
          }
        } else {
          directories.push(arg)
        }
        i++
      }

      if (directories.length === 0) {
        await writelnStderr(process, terminal, 'mkdir: missing operand')
        await writelnStderr(process, terminal, "Try 'mkdir --help' for more information.")
        return 1
      }

      let hasError = false

      for (const target of directories) {
        if (!target) continue

        const fullPath = path.resolve(shell.cwd, target)
        
        try {
          const mkdirOptions: { recursive?: boolean; mode?: number } = {}
          if (parents) {
            mkdirOptions.recursive = true
          }
          if (mode !== undefined) {
            mkdirOptions.mode = mode
          }

          let existedBefore = false
          if (parents) {
            try {
              await shell.context.fs.promises.stat(fullPath)
              existedBefore = true
            } catch {
              existedBefore = false
            }
          }

          await shell.context.fs.promises.mkdir(fullPath, mkdirOptions)

          if (verbose && !existedBefore) {
            const relativePath = path.relative(shell.cwd, fullPath) || target
            await writelnStdout(process, terminal, `mkdir: created directory '${relativePath}'`)
          }
        } catch (error) {
          const err = error as { code?: string; message?: string }
          if (parents && err.code === 'EEXIST') {
            continue
          } else {
            const errorMessage = error instanceof Error ? error.message : String(error)
            await writelnStderr(process, terminal, `mkdir: ${target}: ${errorMessage}`)
            hasError = true
          }
        }
      }

      return hasError ? 1 : 0
    }
  })
}
