import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: cp [OPTION]... SOURCE... DEST
Copy SOURCE to DEST, or multiple SOURCE(s) to DIRECTORY.

  -r, -R, --recursive   copy directories recursively
  -v, --verbose         explain what is being done
  --help                display this help and exit`
  writelnStderr(process, terminal, usage)
}

async function copyRecursive(
  fs: typeof import('@zenfs/core').fs.promises,
  sourcePath: string,
  destPath: string,
  verbose: boolean,
  process: Process | undefined,
  terminal: Terminal,
  relativeSource: string,
  relativeDest: string
): Promise<void> {
  const stats = await fs.stat(sourcePath)

  if (stats.isDirectory()) {
    try {
      await fs.mkdir(destPath)
      if (verbose) await writelnStdout(process, terminal, `'${relativeSource}' -> '${relativeDest}'`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }

    const entries = await fs.readdir(sourcePath)
    for (const entry of entries) {
      const srcEntry = path.join(sourcePath, entry)
      const destEntry = path.join(destPath, entry)
      const srcRelative = path.join(relativeSource, entry)
      const destRelative = path.join(relativeDest, entry)
      await copyRecursive(fs, srcEntry, destEntry, verbose, process, terminal, srcRelative, destRelative)
    }
  } else {
    await fs.copyFile(sourcePath, destPath)
    if (verbose) await writelnStdout(process, terminal, `'${relativeSource}' -> '${relativeDest}'`)
  }
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

      let recursive = false
      let verbose = false
      const args: string[] = []

      for (const arg of argv) {
        if (arg.startsWith('-') && arg !== '--') {
          if (arg === '--recursive') {
            recursive = true
          } else if (arg === '--verbose') {
            verbose = true
          } else if (arg.length > 1) {
            for (let i = 1; i < arg.length; i++) {
              const flag = arg[i]
              if (flag === 'r' || flag === 'R') {
                recursive = true
              } else if (flag === 'v') {
                verbose = true
              } else {
                await writelnStderr(process, terminal, `cp: invalid option -- '${flag}'`)
                await writelnStderr(process, terminal, "Try 'cp --help' for more information.")
                return 1
              }
            }
          }
        } else if (arg && !arg.startsWith('-')) {
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
            const sourceStats = await shell.context.fs.promises.stat(sourcePath)

            if (sourceStats.isDirectory()) {
              if (!recursive) {
                await writelnStderr(process, terminal, `cp: -r not specified; omitting directory '${source}'`)
                hasError = true
                continue
              }
              const relativeSource = source
              const relativeDest = isDestinationDir 
                ? path.join(destination, path.basename(source))
                : destination
              await copyRecursive(
                shell.context.fs.promises,
                sourcePath,
                finalDestination,
                verbose,
                process,
                terminal,
                relativeSource,
                relativeDest
              )
            } else {
              await shell.context.fs.promises.copyFile(sourcePath, finalDestination)
              if (verbose) {
                const relativeSource = source
                const relativeDest = isDestinationDir 
                  ? path.join(destination, path.basename(source))
                  : destination
                await writelnStdout(process, terminal, `'${relativeSource}' -> '${relativeDest}'`)
              }
            }
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
