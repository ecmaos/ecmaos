import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'
import { createTarPacker, createTarDecoder } from 'modern-tar'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: tar [OPTION]... [FILE]...
Create, extract, or list tar archives.

  -c, --create    create a new archive
  -x, --extract   extract files from an archive
  -t, --list      list the contents of an archive
  -f, --file      use archive file (required for create, optional for extract/list - uses stdin if omitted)
  -z              filter the archive through gzip
  -v, --verbose   verbosely list files processed
  -C, --directory change to directory before extracting
  -h, --help      display this help and exit`
  writelnStderr(process, terminal, usage)
}

interface TarOptions {
  create: boolean
  extract: boolean
  list: boolean
  file: string | null
  gzip: boolean
  verbose: boolean
  directory: string | null
}

function parseArgs(argv: string[]): { options: TarOptions; files: string[] } {
  const options: TarOptions = {
    create: false,
    extract: false,
    list: false,
    file: null,
    gzip: false,
    verbose: false,
    directory: null
  }

  const files: string[] = []
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]
    if (!arg || typeof arg !== 'string') {
      i++
      continue
    }

    if (arg === '--help' || arg === '-h') {
      i++
      continue
    } else if (arg === '-c' || arg === '--create') {
      options.create = true
      i++
    } else if (arg === '-x' || arg === '--extract') {
      options.extract = true
      i++
    } else if (arg === '-t' || arg === '--list') {
      options.list = true
      i++
    } else if (arg === '-f' || arg === '--file') {
      if (i + 1 < argv.length) {
        i++
        const nextArg = argv[i]
        options.file = (typeof nextArg === 'string' ? nextArg : null) || null
      } else {
        options.file = null
      }
      i++
    } else if (arg === '-z') {
      options.gzip = true
      i++
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true
      i++
    } else if (arg === '-C' || arg === '--directory') {
      if (i + 1 < argv.length) {
        i++
        const nextArg = argv[i]
        options.directory = (typeof nextArg === 'string' ? nextArg : null) || null
      } else {
        options.directory = null
      }
      i++
    } else if (arg.startsWith('-')) {
      // Handle combined flags like -czf
      const flagString = arg.slice(1)
      let flagIndex = 0
      while (flagIndex < flagString.length) {
        const flag = flagString[flagIndex]
        if (flag === 'c') {
          options.create = true
          flagIndex++
        } else if (flag === 'x') {
          options.extract = true
          flagIndex++
        } else if (flag === 't') {
          options.list = true
          flagIndex++
        } else if (flag === 'f') {
          // -f needs to be followed by filename
          // Check if there's a path in the same string after 'f'
          const remaining = flagString.slice(flagIndex + 1)
          if (remaining.length > 0 && !remaining.startsWith('-')) {
            // Path is in the same string
            options.file = remaining
            flagIndex = flagString.length // Done processing this arg
          } else if (i + 1 < argv.length) {
            // Check next argument
            const nextArg = argv[i + 1]
            if (typeof nextArg === 'string' && !nextArg.startsWith('-')) {
              i++
              options.file = nextArg
              flagIndex++
            } else {
              flagIndex++
            }
          } else {
            flagIndex++
          }
        } else if (flag === 'z') {
          options.gzip = true
          flagIndex++
        } else if (flag === 'v') {
          options.verbose = true
          flagIndex++
        } else if (flag === 'C') {
          // -C needs to be followed by directory
          // Check if there's a path in the same string after 'C'
          const remaining = flagString.slice(flagIndex + 1)
          if (remaining.length > 0 && !remaining.startsWith('-')) {
            // Path is in the same string (e.g., -xz-C/tmp/dir)
            options.directory = remaining
            flagIndex = flagString.length // Done processing this arg
          } else if (i + 1 < argv.length) {
            // Check next argument
            const nextArg = argv[i + 1]
            if (typeof nextArg === 'string' && !nextArg.startsWith('-')) {
              i++
              options.directory = nextArg
              flagIndex++
            } else {
              flagIndex++
            }
          } else {
            flagIndex++
          }
        } else {
          // Unknown flag, skip it
          flagIndex++
        }
      }
      i++
    } else {
      files.push(arg)
      i++
    }
  }

  return { options, files }
}

async function collectFiles(
  shell: Shell,
  filePaths: string[],
  basePath: string = ''
): Promise<Array<{ path: string; fullPath: string; isDirectory: boolean }>> {
  const result: Array<{ path: string; fullPath: string; isDirectory: boolean }> = []

  for (const filePath of filePaths) {
    const fullPath = path.resolve(shell.cwd, filePath)
    try {
      const stat = await shell.context.fs.promises.stat(fullPath)
      
      if (stat.isDirectory()) {
        // Add directory entry
        const relativePath = path.join(basePath, filePath)
        result.push({
          path: relativePath.endsWith('/') ? relativePath : relativePath + '/',
          fullPath,
          isDirectory: true
        })

        // Recursively collect directory contents
        const entries = await shell.context.fs.promises.readdir(fullPath)
        const subFiles: string[] = []
        for (const entry of entries) {
          subFiles.push(path.join(fullPath, entry))
        }
        const subResults = await collectFiles(shell, subFiles.map(f => path.relative(shell.cwd, f)), path.join(basePath, filePath))
        result.push(...subResults)
      } else {
        // Add file entry
        result.push({
          path: path.join(basePath, filePath),
          fullPath,
          isDirectory: false
        })
      }
    } catch (error) {
      // Skip files that can't be accessed
      continue
    }
  }

  return result
}

async function createArchive(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  archivePath: string,
  filePaths: string[],
  options: TarOptions
): Promise<number> {
  if (filePaths.length === 0) {
    await writelnStderr(process, terminal, 'tar: no files specified')
    return 1
  }

  try {
    const fullArchivePath = path.resolve(shell.cwd, archivePath)
    
    // Collect all files to archive
    const filesToArchive = await collectFiles(shell, filePaths)

    if (filesToArchive.length === 0) {
      await writelnStderr(process, terminal, 'tar: no files to archive')
      return 1
    }

    // Create tar packer
    const { readable: tarStream, controller } = createTarPacker()

    // Apply gzip compression if requested
    let finalStream: ReadableStream<Uint8Array> = tarStream
    if (options.gzip) {
      finalStream = tarStream.pipeThrough(new CompressionStream('gzip') as any)
    }

    // Start writing the archive in the background
    const writePromise = (async () => {
      const archiveHandle = await shell.context.fs.promises.open(fullArchivePath, 'w')
      const writer = archiveHandle.writableWebStream?.()?.getWriter()
      
      if (!writer) {
        // Fallback: read stream and write in chunks
        const reader = finalStream.getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            await archiveHandle.writeFile(value)
          }
        } finally {
          reader.releaseLock()
          await archiveHandle.close()
        }
      } else {
        try {
          const reader = finalStream.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              await writer.write(value)
            }
          } finally {
            reader.releaseLock()
          }
          await writer.close()
        } finally {
          writer.releaseLock()
          await archiveHandle.close()
        }
      }
    })()

    // Add entries to the tar archive
    for (const file of filesToArchive) {
      if (file.isDirectory) {
        // Add directory entry
        const dirName = file.path.endsWith('/') ? file.path : file.path + '/'
        controller.add({
          name: dirName,
          type: 'directory',
          size: 0
        })
        if (options.verbose) {
          await writelnStdout(process, terminal, dirName)
        }
      } else {
        try {
          const handle = await shell.context.fs.promises.open(file.fullPath, 'r')
          const stat = await shell.context.fs.promises.stat(file.fullPath)
          
          // Create a readable stream from the file
          const fileStream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                const chunkSize = 64 * 1024 // 64KB chunks
                let offset = 0
                
                while (offset < stat.size) {
                  const buffer = new Uint8Array(chunkSize)
                  const readSize = Math.min(chunkSize, stat.size - offset)
                  await handle.read(buffer, 0, readSize, offset)
                  const chunk = buffer.subarray(0, readSize)
                  controller.enqueue(chunk)
                  offset += readSize
                }
                controller.close()
              } catch (error) {
                controller.error(error)
              } finally {
                await handle.close()
              }
            }
          })

          // Add file entry to tar
          const entryStream = controller.add({
            name: file.path,
            type: 'file',
            size: stat.size
          })

          // Copy file stream to entry stream
          const fileReader = fileStream.getReader()
          const entryWriter = entryStream.getWriter()
          try {
            while (true) {
              const { done, value } = await fileReader.read()
              if (done) break
              await entryWriter.write(value)
            }
            await entryWriter.close()
          } finally {
            fileReader.releaseLock()
            entryWriter.releaseLock()
          }

          if (options.verbose) {
            await writelnStdout(process, terminal, file.path)
          }
        } catch (error) {
          await writelnStderr(process, terminal, `tar: ${file.path}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }
    }

    // Finalize the tar archive
    controller.finalize()

    // Wait for writing to complete
    await writePromise


    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `tar: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function extractArchive(
  kernel: Kernel,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  archivePath: string | null,
  options: TarOptions
): Promise<number> {
  try {
    // Create readable stream from archive file or stdin
    let archiveStream: ReadableStream<Uint8Array>
    
    if (archivePath) {
      // Read from file
      const fullArchivePath = path.resolve(shell.cwd, archivePath)
      
      // Check if archive exists
      try {
        await shell.context.fs.promises.stat(fullArchivePath)
      } catch {
        await writelnStderr(process, terminal, `tar: ${archivePath}: Cannot open: No such file or directory`)
        return 1
      }

      // Read archive file
      const archiveHandle = await shell.context.fs.promises.open(fullArchivePath, 'r')
      const stat = await shell.context.fs.promises.stat(fullArchivePath)
      
      if (archiveHandle.readableWebStream) {
        archiveStream = archiveHandle.readableWebStream() as any as ReadableStream<Uint8Array>
      } else {
        // Fallback: create stream manually
        archiveStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              const chunkSize = 64 * 1024 // 64KB chunks
              let offset = 0
              
              while (offset < stat.size) {
                const buffer = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - offset)
                await archiveHandle.read(buffer, 0, readSize, offset)
                const chunk = buffer.subarray(0, readSize)
                controller.enqueue(chunk)
                offset += readSize
              }
              controller.close()
            } catch (error) {
              controller.error(error)
            } finally {
              await archiveHandle.close()
            }
          }
        })
      }
    } else {
      // Read from stdin
      if (!process || !process.stdin) {
        await writelnStderr(process, terminal, 'tar: no input provided')
        return 1
      }
      archiveStream = process.stdin
    }

    // Apply gzip decompression if requested
    let tarStream: ReadableStream<Uint8Array> = archiveStream
    if (options.gzip) {
      tarStream = archiveStream.pipeThrough(new DecompressionStream('gzip') as any) as ReadableStream<Uint8Array>
    }

    // Extract using modern-tar decoder
    let hasError = false
    let interrupted = false
    const interruptHandler = () => { interrupted = true }
    kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

    try {
      const decoder = createTarDecoder()
      const entriesStream = tarStream.pipeThrough(decoder)
      const entriesReader = entriesStream.getReader()

      try {
        while (true) {
          if (interrupted) break
          const { done, value: entry } = await entriesReader.read()
          if (done) break
          if (!entry) continue
          
          if (options.verbose) {
            await writelnStdout(process, terminal, entry.header.name)
          }

          try {
            // Normalize the entry name: strip leading slashes and resolve relative to extraction directory
            let entryName = entry.header.name
            // Remove leading slashes to make it relative
            while (entryName.startsWith('/')) {
              entryName = entryName.slice(1)
            }
            // Skip empty entries (like just "/")
            if (!entryName) {
              await entry.body.cancel()
              continue
            }

            // Determine extraction base directory
            const extractBase = options.directory 
              ? path.resolve(shell.cwd, options.directory)
              : shell.cwd
            
            const targetPath = path.resolve(extractBase, entryName)
            
            // Security check: ensure target path is within extract base (prevent directory traversal)
            const resolvedBase = path.resolve(extractBase)
            const resolvedTarget = path.resolve(targetPath)
            if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
              await writelnStderr(process, terminal, `tar: ${entry.header.name}: path outside extraction directory`)
              await entry.body.cancel()
              hasError = true
              continue
            }
            
            if (entry.header.type === 'directory' || entry.header.name.endsWith('/')) {
              // Create directory
              try {
                await shell.context.fs.promises.mkdir(targetPath, { recursive: true })
              } catch (error) {
                // Directory might already exist, ignore
              }
              // Drain the body stream for directories
              await entry.body.cancel()
            } else if (entry.header.type === 'file') {
              // Extract file
              const dirPath = path.dirname(targetPath)
              try {
                await shell.context.fs.promises.mkdir(dirPath, { recursive: true })
              } catch {
                // Directory might already exist
              }

              // Read file content from entry stream
              const chunks: Uint8Array[] = []
              const reader = entry.body.getReader()
              try {
                while (true) {
                  const { done, value } = await reader.read()
                  if (done) break
                  if (value) chunks.push(value)
                }
              } finally {
                reader.releaseLock()
              }

              // Combine chunks and write file
              const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
              const fileData = new Uint8Array(totalLength)
              let offset = 0
              for (const chunk of chunks) {
                fileData.set(chunk, offset)
                offset += chunk.length
              }

              await shell.context.fs.promises.writeFile(targetPath, fileData)
            } else {
              // For other entry types (symlinks, etc.), drain the body
              await entry.body.cancel()
            }
          } catch (error) {
            await writelnStderr(process, terminal, `tar: ${entry.header.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
            hasError = true
            // Drain the body stream on error
            try {
              await entry.body.cancel()
            } catch {
              // Ignore cancel errors
            }
          }
        }
      } finally {
        entriesReader.releaseLock()
      }
    } finally {
      kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
    }

    return hasError ? 1 : 0
  } catch (error) {
    await writelnStderr(process, terminal, `tar: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function listArchive(
  kernel: Kernel,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  archivePath: string | null,
  options: TarOptions
): Promise<number> {
  try {
    // Create readable stream from archive file or stdin
    let archiveStream: ReadableStream<Uint8Array>
    
    if (archivePath) {
      // Read from file
      const fullArchivePath = path.resolve(shell.cwd, archivePath)
      
      // Check if archive exists
      try {
        await shell.context.fs.promises.stat(fullArchivePath)
      } catch {
        await writelnStderr(process, terminal, `tar: ${archivePath}: Cannot open: No such file or directory`)
        return 1
      }

      // Read archive file
      const archiveHandle = await shell.context.fs.promises.open(fullArchivePath, 'r')
      const stat = await shell.context.fs.promises.stat(fullArchivePath)
      
      if (archiveHandle.readableWebStream) {
        archiveStream = archiveHandle.readableWebStream() as any as ReadableStream<Uint8Array>
      } else {
        // Fallback: create stream manually
        archiveStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              const chunkSize = 64 * 1024 // 64KB chunks
              let offset = 0
              
              while (offset < stat.size) {
                const buffer = new Uint8Array(chunkSize)
                const readSize = Math.min(chunkSize, stat.size - offset)
                await archiveHandle.read(buffer, 0, readSize, offset)
                const chunk = buffer.subarray(0, readSize)
                controller.enqueue(chunk)
                offset += readSize
              }
              controller.close()
            } catch (error) {
              controller.error(error)
            } finally {
              await archiveHandle.close()
            }
          }
        })
      }
    } else {
      // Read from stdin
      if (!process || !process.stdin) {
        await writelnStderr(process, terminal, 'tar: no input provided')
        return 1
      }
      archiveStream = process.stdin
    }

    // Apply gzip decompression if requested
    let tarStream: ReadableStream<Uint8Array> = archiveStream
    if (options.gzip) {
      tarStream = archiveStream.pipeThrough(new DecompressionStream('gzip') as any) as ReadableStream<Uint8Array>
    }

    // List contents using modern-tar decoder
    let hasError = false
    let interrupted = false
    const interruptHandler = () => { interrupted = true }
    kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

    try {
      const decoder = createTarDecoder()
      const entriesStream = tarStream.pipeThrough(decoder)
      const entriesReader = entriesStream.getReader()

      try {
        while (true) {
          if (interrupted) break
          const { done, value: entry } = await entriesReader.read()
          if (done) break
          if (!entry) continue
          
          await writelnStdout(process, terminal, entry.header.name)
          // Drain the body stream since we're just listing
          await entry.body.cancel()
        }
      } finally {
        entriesReader.releaseLock()
      }
    } catch (error) {
      await writelnStderr(process, terminal, `tar: ${error instanceof Error ? error.message : 'Unknown error'}`)
      hasError = true
    } finally {
      kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
    }

    return hasError ? 1 : 0
  } catch (error) {
    await writelnStderr(process, terminal, `tar: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tar',
    description: 'Create, extract, or list tar archives',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const { options, files } = parseArgs(argv)

      // Validate operation mode
      const operationCount = [options.create, options.extract, options.list].filter(Boolean).length
      if (operationCount === 0) {
        await writelnStderr(process, terminal, 'tar: You must specify one of the -c, -x, or -t options')
        await writelnStderr(process, terminal, "Try 'tar --help' for more information.")
        return 1
      }

      if (operationCount > 1) {
        await writelnStderr(process, terminal, 'tar: You may not specify more than one of -c, -x, or -t')
        return 1
      }

      // Validate file option for create (create always needs a file)
      if (options.create && !options.file) {
        await writelnStderr(process, terminal, 'tar: option requires an argument -- f')
        await writelnStderr(process, terminal, "Try 'tar --help' for more information.")
        return 1
      }

      // For extract and list, if no file is specified, use stdin

      // Expand glob patterns in file list
      const expandGlob = async (pattern: string): Promise<string[]> => {
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

      // Expand glob patterns in file list (shell should have already expanded them, but keep as fallback)
      const expandedFiles: string[] = []
      for (const filePattern of files) {
        if (typeof filePattern !== 'string') {
          // Skip non-string entries (shouldn't happen, but handle gracefully)
          continue
        }
        
        // Check if this looks like a glob pattern (shell should have expanded it, but handle as fallback)
        const expanded = await expandGlob(filePattern)
        if (expanded.length === 0) {
          // If glob doesn't match anything, include the pattern as-is (might be a literal path)
          expandedFiles.push(filePattern)
        } else {
          expandedFiles.push(...expanded)
        }
      }

      // Execute operation
      if (options.create) {
        if (!options.file) {
          await writelnStderr(process, terminal, 'tar: option requires an argument -- f')
          return 1
        }
        return await createArchive(shell, terminal, process, options.file, expandedFiles, options)
      } else if (options.extract) {
        return await extractArchive(kernel, shell, terminal, process, options.file, options)
      } else if (options.list) {
        return await listArchive(kernel, shell, terminal, process, options.file, options)
      }

      return 1
    }
  })
}
