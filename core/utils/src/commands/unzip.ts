import path from 'path'
import * as zipjs from '@zip.js/zip.js'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'
import chalk from 'chalk'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: unzip [OPTION]... ZIPFILE [FILE]...
Extract files from a zip archive.

  -l, --list       list contents of zip file
  -d, --directory  extract files to directory
  -o, --overwrite  overwrite files without prompting
  -q, --quiet      quiet mode (suppress output)
  -v, --verbose    verbose mode
  -x, --exclude    exclude files from extraction
  -h, --help       display this help and exit

Examples:
  unzip archive.zip
  unzip -d /tmp archive.zip
  unzip -l archive.zip
  unzip -x "*.txt" archive.zip`
  writelnStderr(process, terminal, usage)
}

interface UnzipOptions {
  list: boolean
  directory: string | null
  overwrite: boolean
  quiet: boolean
  verbose: boolean
  exclude: string[]
}

function parseArgs(argv: string[]): { options: UnzipOptions; zipfile: string | null; files: string[] } {
  const options: UnzipOptions = {
    list: false,
    directory: null,
    overwrite: false,
    quiet: false,
    verbose: false,
    exclude: []
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
    } else if (arg === '-l' || arg === '--list') {
      options.list = true
      i++
    } else if (arg === '-d' || arg === '--directory') {
      if (i + 1 < argv.length) {
        i++
        options.directory = argv[i] || null
      }
      i++
    } else if (arg === '-o' || arg === '--overwrite') {
      options.overwrite = true
      i++
    } else if (arg === '-q' || arg === '--quiet') {
      options.quiet = true
      i++
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true
      i++
    } else if (arg === '-x' || arg === '--exclude') {
      if (i + 1 < argv.length) {
        i++
        const pattern = argv[i]
        if (pattern) {
          options.exclude.push(pattern)
        }
      }
      i++
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -oq
      const flags = arg.slice(1).split('')
      for (const flag of flags) {
        if (flag === 'l') options.list = true
        else if (flag === 'o') options.overwrite = true
        else if (flag === 'q') options.quiet = true
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

function matchesPattern(filename: string, pattern: string): boolean {
  // Simple glob pattern matching
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filename)
}

async function expandGlob(pattern: string, shell: Shell): Promise<string[]> {
  if (!pattern.includes('*') && !pattern.includes('?')) {
    return [pattern]
  }

  const lastSlashIndex = pattern.lastIndexOf('/')
  const searchDir = lastSlashIndex !== -1
    ? path.resolve(shell.cwd, pattern.substring(0, lastSlashIndex + 1))
    : shell.cwd
  const globPattern = lastSlashIndex !== -1
    ? pattern.substring(lastSlashIndex + 1)
    : pattern

  try {
    const entries = await shell.context.fs.promises.readdir(searchDir)
    const regexPattern = globPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)
    
    const matches = entries.filter(entry => regex.test(entry))
    
    if (lastSlashIndex !== -1) {
      const dirPart = pattern.substring(0, lastSlashIndex + 1)
      return matches.map(match => dirPart + match)
    }
    return matches
  } catch (error) {
    return []
  }
}

async function extractFromZip(
  zipfilePath: string,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  options: UnzipOptions,
  extractPath: string,
  files: string[]
): Promise<{ extractedCount: number; skippedCount: number; hasError: boolean }> {
  const zipData = await shell.context.fs.promises.readFile(zipfilePath)
  const blob = new Blob([new Uint8Array(zipData)])
  const zipReader = new zipjs.ZipReader(new zipjs.BlobReader(blob))
  const entries = await zipReader.getEntries()

  let extractedCount = 0
  let skippedCount = 0
  let hasError = false

  // Filter entries if specific files are requested
  const entriesToExtract = files.length > 0
    ? entries.filter(entry => files.some(file => entry.filename === file || entry.filename.startsWith(file + '/')))
    : entries

  for (const entry of entriesToExtract) {
    // Normalize the entry name: strip leading slashes and resolve relative to extraction directory
    let entryName = entry.filename
    // Remove leading slashes to make it relative
    while (entryName.startsWith('/')) {
      entryName = entryName.slice(1)
    }
    // Skip empty entries (like just "/")
    if (!entryName) {
      continue
    }

    // Check if entry should be excluded (use original filename for pattern matching)
    if (options.exclude.some(pattern => matchesPattern(entry.filename, pattern))) {
      if (options.verbose && !options.quiet) {
        await writelnStdout(process, terminal, `  skipping: ${entryName}`)
      }
      skippedCount++
      continue
    }

    const entryPath = path.resolve(extractPath, entryName)
    
    // Security check: ensure target path is within extract base (prevent directory traversal)
    const resolvedBase = path.resolve(extractPath)
    const resolvedTarget = path.resolve(entryPath)
    if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
      await writelnStderr(process, terminal, chalk.red(`unzip error: ${entry.filename}: path outside extraction directory`))
      hasError = true
      continue
    }

    const entryDir = path.dirname(entryPath)

    try {
      // Check if file already exists
      const exists = await shell.context.fs.promises.exists(entryPath)
      if (exists && !options.overwrite) {
        if (!options.quiet) {
          await writelnStderr(process, terminal, 
            chalk.yellow(`unzip: ${entryName} already exists - skipping (use -o to overwrite)`)
          )
        }
        skippedCount++
        continue
      }

      // Ensure directory exists
      if (entryDir !== extractPath) {
        await shell.context.fs.promises.mkdir(entryDir, { recursive: true })
      }

      if (entry.directory || entryName.endsWith('/')) {
        await shell.context.fs.promises.mkdir(entryPath, { recursive: true })
        if (options.verbose && !options.quiet) {
          await writelnStdout(process, terminal, `  creating: ${entryName}/`)
        }
      } else {
        const writer = new zipjs.Uint8ArrayWriter()
        const data = await entry.getData?.(writer)
        if (!data) {
          await writelnStderr(process, terminal, chalk.red(`unzip error: Failed to read ${entryName}`))
          hasError = true
          continue
        }
        await shell.context.fs.promises.writeFile(entryPath, data)
        if (!options.quiet) {
          await writelnStdout(process, terminal, `  inflating: ${entryName}`)
        }
      }
      extractedCount++
    } catch (error) {
      await writelnStderr(process, terminal, 
        chalk.red(`unzip error: ${entryName}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      )
      hasError = true
    }
  }

  await zipReader.close()
  return { extractedCount, skippedCount, hasError }
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
      chalk.red(`unzip error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    )
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'unzip',
    description: 'Extract zip archives',
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

      if (!zipfile) {
        await writelnStderr(process, terminal, chalk.red('unzip error: zipfile name required'))
        await writelnStderr(process, terminal, "Try 'unzip --help' for more information.")
        return 1
      }

      // The shell should have already expanded globs when they match files.
      // However, if a glob pattern doesn't match, the shell passes it as-is.
      // So we need to handle glob expansion as a fallback.
      // Also, when the shell expands a glob like "sample*.zip" to multiple files,
      // parseArgs treats the first as zipfile and the rest as "files".
      // We need to collect all zip files and separate them from files to extract.
      
      const zipfiles: string[] = []
      const filesToExtract: string[] = []
      
      // Process the zipfile argument
      const zipfilePath = path.resolve(shell.cwd, zipfile)
      const zipfileExists = await shell.context.fs.promises.exists(zipfilePath)
      
      if (zipfileExists) {
        // File exists, use it as-is
        zipfiles.push(zipfile)
      } else if (zipfile.includes('*') || zipfile.includes('?')) {
        // Contains glob chars and doesn't exist - expand it
        const expanded = await expandGlob(zipfile, shell)
        if (expanded.length === 0) {
          // No matches - this is an error
          await writelnStderr(process, terminal, chalk.red(`unzip error: ${zipfile}: No such file or directory`))
          return 1
        }
        zipfiles.push(...expanded)
      } else {
        // Doesn't exist and no glob chars - error
        await writelnStderr(process, terminal, chalk.red(`unzip error: ${zipfile}: No such file or directory`))
        return 1
      }
      
      // Process the files arguments
      // Standard unzip behavior: arguments ending with .zip are zip files to extract from
      // Other arguments are files to extract from within the zip
      for (const file of files) {
        if (file.toLowerCase().endsWith('.zip')) {
          // This looks like a zip file
          const filePath = path.resolve(shell.cwd, file)
          const fileExists = await shell.context.fs.promises.exists(filePath)
          
          if (fileExists) {
            zipfiles.push(file)
          } else if (file.includes('*') || file.includes('?')) {
            // Contains glob chars - expand it
            const expanded = await expandGlob(file, shell)
            if (expanded.length === 0) {
              await writelnStderr(process, terminal, chalk.red(`unzip error: ${file}: No such file or directory`))
              // Continue processing other files
            } else {
              zipfiles.push(...expanded)
            }
          } else {
            await writelnStderr(process, terminal, chalk.red(`unzip error: ${file}: No such file or directory`))
            // Continue processing other files
          }
        } else {
          // This is a file to extract from within the zip
          filesToExtract.push(file)
        }
      }
      
      if (zipfiles.length === 0) {
        await writelnStderr(process, terminal, chalk.red(`unzip error: No zip files to process`))
        return 1
      }
      
      const actualFiles = filesToExtract

      // List mode - only process first zip file
      if (options.list) {
        if (!zipfiles[0]) {
          await writelnStderr(process, terminal, chalk.red(`unzip error: No zip files to list`))
          return 1
        }

        const zipfilePath = path.resolve(shell.cwd, zipfiles[0])
        const exists = await shell.context.fs.promises.exists(zipfilePath)

        if (!exists) {
          await writelnStderr(process, terminal, chalk.red(`unzip error: ${zipfiles[0]}: No such file or directory`))
          return 1
        }

        return await listZipContents(zipfilePath, shell, terminal, process)
      }

      // Extract mode - process all zip files
      const extractPath = options.directory 
        ? path.resolve(shell.cwd, options.directory)
        : shell.cwd

      // Ensure extract directory exists
      try {
        const extractPathStat = await shell.context.fs.promises.stat(extractPath).catch(() => null)
        if (!extractPathStat) {
          await shell.context.fs.promises.mkdir(extractPath, { recursive: true })
        } else if (!extractPathStat.isDirectory()) {
          await writelnStderr(process, terminal, chalk.red(`unzip error: ${options.directory}: Not a directory`))
          return 1
        }
      } catch (error) {
        await writelnStderr(process, terminal, 
          chalk.red(`unzip error: Cannot create directory ${extractPath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        )
        return 1
      }

      let totalExtracted = 0
      let totalSkipped = 0
      let hasError = false

      for (const zipfileItem of zipfiles) {
        const zipfilePath = path.resolve(shell.cwd, zipfileItem)
        const exists = await shell.context.fs.promises.exists(zipfilePath)
        if (!exists) {
          await writelnStderr(process, terminal, chalk.red(`unzip error: ${zipfileItem}: No such file or directory`))
          hasError = true
          continue
        }

        try {
          const result = await extractFromZip(zipfilePath, shell, terminal, process, options, extractPath, actualFiles)
          totalExtracted += result.extractedCount
          totalSkipped += result.skippedCount
          if (result.hasError) {
            hasError = true
          }

          if (!options.quiet) {
            await writelnStdout(process, terminal, `\nArchive:  ${path.basename(zipfilePath)}`)
            await writelnStdout(process, terminal, `  ${result.extractedCount} file${result.extractedCount !== 1 ? 's' : ''} extracted`)
            if (result.skippedCount > 0) {
              await writelnStdout(process, terminal, `  ${result.skippedCount} file${result.skippedCount !== 1 ? 's' : ''} skipped`)
            }
          }
        } catch (error) {
          await writelnStderr(process, terminal, 
            chalk.red(`unzip error: ${zipfileItem}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          )
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
