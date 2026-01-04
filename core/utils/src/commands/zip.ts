import path from 'path'
import * as zipjs from '@zip.js/zip.js'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'
import chalk from 'chalk'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: zip [OPTION]... ZIPFILE FILE...
Create a zip archive containing the specified files and directories.

  -r, --recurse    recurse into directories
  -l, --list       list contents of zip file
  -v, --verbose    verbose mode
  -h, --help       display this help and exit

Examples:
  zip archive.zip file1.txt file2.txt
  zip -r archive.zip directory/
  zip -l archive.zip`
  writelnStderr(process, terminal, usage)
}

interface ZipOptions {
  recurse: boolean
  list: boolean
  verbose: boolean
}

function parseArgs(argv: string[]): { options: ZipOptions; zipfile: string | null; files: string[] } {
  const options: ZipOptions = {
    recurse: false,
    list: false,
    verbose: false
  }

  const files: string[] = []
  let zipfile: string | null = null
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]
    if (!arg) {
      i++
      continue
    }

    if (arg === '--help' || arg === '-h') {
      i++
      continue
    } else if (arg === '-r' || arg === '--recurse') {
      options.recurse = true
      i++
    } else if (arg === '-l' || arg === '--list') {
      options.list = true
      i++
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true
      i++
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -rv
      const flags = arg.slice(1).split('')
      for (const flag of flags) {
        if (flag === 'r') options.recurse = true
        else if (flag === 'l') options.list = true
        else if (flag === 'v') options.verbose = true
      }
      i++
    } else {
      // First non-option argument is the zipfile
      if (!zipfile) {
        zipfile = arg
      } else {
        files.push(arg)
      }
      i++
    }
  }

  return { options, zipfile, files }
}

async function addDirectory(
  zipWriter: zipjs.ZipWriter<Blob>,
  dirPath: string,
  basePath: string,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  verbose: boolean
): Promise<void> {
  const entries = await shell.context.fs.promises.readdir(dirPath)

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry)
    const relativePath = path.relative(basePath, entryPath)
    const entryStat = await shell.context.fs.promises.stat(entryPath)

    if (entryStat.isFile()) {
      const fileData = await shell.context.fs.promises.readFile(entryPath)
      const reader = new zipjs.Uint8ArrayReader(fileData)
      await zipWriter.add(relativePath, reader)
      if (verbose) {
        await writelnStdout(process, terminal, `  adding: ${relativePath}`)
      }
    } else if (entryStat.isDirectory()) {
      await addDirectory(zipWriter, entryPath, basePath, shell, terminal, process, verbose)
    }
  }
}

async function listZipContents(
  zipfilePath: string,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined
): Promise<number> {
  try {
    const zipData = await shell.context.fs.promises.readFile(zipfilePath)
    const blob = new Blob([new Uint8Array(zipData)])
    const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(blob))
    const entries = await zipReader.getEntries()

    if (entries.length === 0) {
      await writelnStdout(process, terminal, 'Archive:  ' + path.basename(zipfilePath))
      await writelnStdout(process, terminal, '  Empty archive')
      await zipReader.close()
      return 0
    }

    // Calculate column widths
    let maxLength = 0
    let maxSize = 0
    for (const entry of entries) {
      if (entry.filename.length > maxLength) maxLength = entry.filename.length
      const size = entry.uncompressedSize || 0
      if (size > maxSize) maxSize = size
    }

    const sizeWidth = Math.max(12, String(maxSize).length)
    const nameWidth = Math.max(20, maxLength)

    await writelnStdout(process, terminal, `Archive:  ${path.basename(zipfilePath)}`)
    await writelnStdout(process, terminal, '')
    await writelnStdout(process, terminal, 
      `  Length      Date  Time    Name`.padEnd(nameWidth + sizeWidth + 20)
    )
    await writelnStdout(process, terminal, 
      `  ${'-'.repeat(sizeWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(5)}  ${'-'.repeat(nameWidth)}`
    )

    let totalLength = 0
    for (const entry of entries) {
      const length = entry.uncompressedSize || 0
      totalLength += length

      let date = '--'
      let time = '--'
      
      if (entry.lastModDate) {
        const d = new Date(entry.lastModDate)
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const year = String(d.getFullYear()).slice(-2)
        date = `${month}-${day}-${year}`
        
        const hours = String(d.getHours()).padStart(2, '0')
        const minutes = String(d.getMinutes()).padStart(2, '0')
        time = `${hours}:${minutes}`
      }

      const name = entry.directory ? entry.filename + '/' : entry.filename
      const lengthStr = entry.directory ? '' : String(length).padStart(sizeWidth)
      
      await writelnStdout(process, terminal,
        `  ${lengthStr.padEnd(sizeWidth)}  ${date.padEnd(10)}  ${time.padEnd(5)}  ${name}`
      )
    }

    await writelnStdout(process, terminal, 
      `  ${'-'.repeat(sizeWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(5)}  ${'-'.repeat(nameWidth)}`
    )
    await writelnStdout(process, terminal, 
      `  ${String(totalLength).padStart(sizeWidth)}                      ${entries.length} file${entries.length !== 1 ? 's' : ''}`
    )

    await zipReader.close()
    return 0
  } catch (error) {
    await writelnStderr(process, terminal, 
      chalk.red(`zip error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    )
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'zip',
    description: 'Create zip archives',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const { options, zipfile, files } = parseArgs(argv)

      // List mode
      if (options.list) {
        if (!zipfile) {
          await writelnStderr(process, terminal, chalk.red('zip error: zipfile name required'))
          await writelnStderr(process, terminal, "Try 'zip --help' for more information.")
          return 1
        }

        const zipfilePath = path.resolve(shell.cwd, zipfile)
        const exists = await shell.context.fs.promises.exists(zipfilePath)
        if (!exists) {
          await writelnStderr(process, terminal, chalk.red(`zip error: ${zipfile}: No such file or directory`))
          return 1
        }

        return await listZipContents(zipfilePath, shell, terminal, process)
      }

      // Create mode
      if (!zipfile) {
        await writelnStderr(process, terminal, chalk.red('zip error: zipfile name required'))
        await writelnStderr(process, terminal, "Try 'zip --help' for more information.")
        return 1
      }

      if (files.length === 0) {
        await writelnStderr(process, terminal, chalk.red('zip error: nothing to do'))
        await writelnStderr(process, terminal, "Try 'zip --help' for more information.")
        return 1
      }

      const outputPath = path.resolve(shell.cwd, zipfile)
      let zipWriter: zipjs.ZipWriter<Blob> | null = null
      let hasError = false

      try {
        zipWriter = new zipjs.ZipWriter(new zipjs.BlobWriter())

        for (const inputPath of files) {
          const fullPath = path.resolve(shell.cwd, inputPath)
          
          try {
            const exists = await shell.context.fs.promises.exists(fullPath)
            if (!exists) {
              await writelnStderr(process, terminal, chalk.red(`zip warning: ${inputPath}: No such file or directory`))
              hasError = true
              continue
            }

            const fileStat = await shell.context.fs.promises.stat(fullPath)

            if (fileStat.isFile()) {
              // Add single file
              const relativePath = path.relative(shell.cwd, fullPath)
              const fileData = await shell.context.fs.promises.readFile(fullPath)
              const reader = new zipjs.Uint8ArrayReader(fileData)
              await zipWriter.add(relativePath, reader)
              if (options.verbose) {
                await writelnStdout(process, terminal, `  adding: ${relativePath}`)
              }
            } else if (fileStat.isDirectory()) {
              if (options.recurse) {
                // Add directory and contents recursively
                await addDirectory(zipWriter, fullPath, shell.cwd, shell, terminal, process, options.verbose)
                if (options.verbose) {
                  await writelnStdout(process, terminal, `  adding: ${path.relative(shell.cwd, fullPath)}/`)
                }
              } else {
                await writelnStderr(process, terminal, chalk.yellow(`zip warning: ${inputPath}: is a directory (not added). Use -r to recurse into directories`))
                hasError = true
              }
            } else {
              await writelnStderr(process, terminal, chalk.red(`zip error: ${inputPath}: Not a file or directory`))
              hasError = true
            }
          } catch (err: unknown) {
            await writelnStderr(process, terminal, 
              chalk.red(`zip error: ${inputPath}: ${err instanceof Error ? err.message : 'Unknown error'}`)
            )
            hasError = true
          }
        }

        // Write the zip file
        const blob = await zipWriter.close()
        zipWriter = null // Clear reference after closing
        await shell.context.fs.promises.writeFile(outputPath, new Uint8Array(await blob.arrayBuffer()))
        
        if (options.verbose) {
          await writelnStdout(process, terminal, `  zipfile: ${zipfile}`)
        }

        return hasError ? 1 : 0
      } catch (err: unknown) {
        await writelnStderr(process, terminal, 
          chalk.red(`zip error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        )
        return 1
      } finally {
        if (zipWriter) {
          await zipWriter.close()
        }
      }
    }
  })
}
