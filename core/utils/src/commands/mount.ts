import path from 'path'
import chalk from 'chalk'
import { Fetch, InMemory, resolveMountConfig, SingleBuffer } from '@zenfs/core'
import { IndexedDB, WebStorage, WebAccess, /* XML */ } from '@zenfs/dom'
import { Iso, Zip } from '@zenfs/archives'
import { Dropbox, /* S3Bucket, */ GoogleDrive } from '@zenfs/cloud'

import type { Kernel, Process, Shell, Terminal, FstabEntry } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

/**
 * Parse a single fstab line
 * @param line - The line to parse
 * @returns Parsed entry or null if line is empty/comment
 */
function parseFstabLine(line: string): FstabEntry | null {
  const trimmed = line.trim()
  
  // Skip empty lines and comments
  if (trimmed === '' || trimmed.startsWith('#')) {
    return null
  }

  // Split by whitespace (space or tab)
  // Format: source target type [options]
  const parts = trimmed.split(/\s+/)
  
  if (parts.length < 3) {
    // Need at least source, target, and type
    return null
  }

  const source = parts[0] || ''
  const target = parts[1] || ''
  const type = parts[2] || ''
  const options = parts.slice(3).join(' ') || undefined

  // Validate required fields
  if (!target || !type) {
    return null
  }

  return {
    source: source || '',
    target,
    type,
    options
  }
}

/**
 * Parse a complete fstab file
 * @param content - The fstab file content
 * @returns Array of parsed fstab entries
 */
function parseFstabFile(content: string): FstabEntry[] {
  const lines = content.split('\n')
  const entries: FstabEntry[] = []

  for (const line of lines) {
    if (!line) continue
    const parsed = parseFstabLine(line)
    if (parsed) {
      entries.push(parsed)
    }
  }

  return entries
}

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: mount [OPTIONS] [SOURCE] TARGET
       mount [-a|--all]
       mount [-l|--list]

Mount a filesystem.

Options:
  -t, --type TYPE     filesystem type (fetch, indexeddb, webstorage, webaccess, memory, singlebuffer, zip, iso, dropbox, /* s3, */ googledrive)
  -o, --options OPTS   mount options (comma-separated key=value pairs)
  -a, --all           mount all filesystems listed in /etc/fstab
  -l, --list          list all mounted filesystems
  --help              display this help and exit

Filesystem types:
  fetch         mount a remote filesystem via HTTP fetch
  indexeddb     mount an IndexedDB-backed filesystem
  webstorage    mount a WebStorage-backed filesystem (localStorage or sessionStorage)
  webaccess     mount a filesystem using the File System Access API
  memory        mount an in-memory filesystem
  singlebuffer  mount a filesystem backed by a single buffer
  zip           mount a readonly filesystem from a zip archive (requires SOURCE file or URL)
  iso           mount a readonly filesystem from an ISO image (requires SOURCE file or URL)
  dropbox       mount a Dropbox filesystem (requires client configuration via -o client)
  googledrive   mount a Google Drive filesystem (requires apiKey via -o apiKey, optionally clientId for OAuth)

Mount options:
  baseUrl=URL        base URL for fetch operations (fetch type)
  size=BYTES         buffer size in bytes for singlebuffer type (default: 1048576)
  storage=TYPE       storage type for webstorage (localStorage or sessionStorage, default: localStorage)
  client=JSON        client configuration as JSON string (dropbox type)
  apiKey=KEY         Google API key (googledrive type, required)
  clientId=ID        Google OAuth client ID (googledrive type, optional)
  scope=SCOPE        OAuth scope (googledrive type, default: https://www.googleapis.com/auth/drive)
  cacheTTL=SECONDS   cache TTL in seconds for cloud backends (optional)

Examples:
  mount -t memory /mnt/tmp                    mount memory filesystem at /mnt/tmp
  mount -t indexeddb mydb /mnt/db             mount IndexedDB store 'mydb' at /mnt/db
  mount -t webstorage /mnt/storage            mount WebStorage filesystem using localStorage
  mount -t webstorage /mnt/storage -o storage=sessionStorage
  mount -t webaccess /mnt/access              mount File System Access API filesystem
  mount -t fetch /api /mnt/api                mount fetch filesystem at /mnt/api
  mount -t fetch /api /mnt/api -o baseUrl=https://example.com
  mount -t singlebuffer /mnt/buf              mount singlebuffer filesystem at /mnt/buf
  mount -t singlebuffer /mnt/buf -o size=2097152
  mount -t zip https://example.com/archive.zip /mnt/zip
  mount -t zip /tmp/archive.zip /mnt/zip
  mount -t iso https://example.com/image.iso /mnt/iso
  mount -t iso /tmp/image.iso /mnt/iso
  mount -t dropbox /mnt/dropbox -o client='{"accessToken":"..."}'
  mount -t googledrive /mnt/gdrive -o apiKey=YOUR_API_KEY
  mount -t googledrive /mnt/gdrive -o apiKey=YOUR_API_KEY,clientId=YOUR_CLIENT_ID
  mount -l                                    list all mounted filesystems`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'mount',
    description: 'Mount a filesystem',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let listMode = false
      let allMode = false
      let type: string | undefined
      let options: string | undefined
      const positionalArgs: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '-l' || arg === '--list') {
          listMode = true
        } else if (arg === '-a' || arg === '--all') {
          allMode = true
        } else if (arg === '-t' || arg === '--type') {
          if (i + 1 < argv.length) {
            type = argv[i + 1]
            i++
          } else {
            await writelnStderr(process, terminal, chalk.red('mount: option requires an argument -- \'t\''))
            return 1
          }
        } else if (arg === '-o' || arg === '--options') {
          if (i + 1 < argv.length) {
            options = argv[i + 1]
            i++
          } else {
            await writelnStderr(process, terminal, chalk.red('mount: option requires an argument -- \'o\''))
            return 1
          }
        } else if (arg && !arg.startsWith('-')) {
          positionalArgs.push(arg)
        }
      }

      if (listMode || (argv.length === 0 && !allMode)) {
        const mountList = Array.from(kernel.filesystem.mounts.entries())
        
        if (mountList.length === 0) {
          await writelnStdout(process, terminal, 'No filesystems mounted.')
          return 0
        }

        const mountRows = mountList.map(([target, mount]: [string, unknown]) => {
          const mountObj = mount as { store?: { constructor?: { name?: string } }; constructor?: { name?: string }; metadata?: () => { name?: string } }
          const store = mountObj.store
          const backendName = store?.constructor?.name || mountObj.constructor?.name || 'Unknown'
          const metadata = mountObj.metadata?.()
          const name = metadata?.name || backendName
          
          return {
            target: chalk.blue(target),
            type: chalk.gray(backendName.toLowerCase()),
            name: chalk.gray(name)
          }
        })
        
        for (const row of mountRows) {
          await writelnStdout(process, terminal, `${row.target.padEnd(30)} ${row.type.padEnd(15)} ${row.name}`)
        }

        return 0
      }

      if (allMode) {
        try {
          const fstabPath = '/etc/fstab'
          if (!(await shell.context.fs.promises.exists(fstabPath))) {
            await writelnStderr(process, terminal, chalk.yellow(`mount: ${fstabPath} not found`))
            return 1
          }

          const content = await shell.context.fs.promises.readFile(fstabPath, 'utf-8')
          const entries = parseFstabFile(content)
          
          if (entries.length === 0) {
            await writelnStdout(process, terminal, 'No entries found in /etc/fstab')
            return 0
          }

          await writelnStdout(process, terminal, `Mounting ${entries.length} filesystem(s) from /etc/fstab...`)
          
          let successCount = 0
          let failCount = 0

          for (const entry of entries) {
            try {
              const entryType = entry.type
              const entrySource = entry.source || ''
              const entryTarget = path.resolve('/', entry.target)
              const entryOptions = entry.options

              // Validate entry
              if (!entryType) {
                await writelnStderr(process, terminal, chalk.yellow(`mount: skipping entry for ${entryTarget}: missing type`))
                failCount++
                continue
              }

              if (!entryTarget) {
                await writelnStderr(process, terminal, chalk.yellow(`mount: skipping entry: missing target`))
                failCount++
                continue
              }

              // Check if filesystem type doesn't require source but one is provided
              const noSourceTypes = ['memory', 'singlebuffer', 'webstorage', 'webaccess', 'xml', 'dropbox', 'googledrive']
              if (entrySource && noSourceTypes.includes(entryType.toLowerCase())) {
                await writelnStderr(process, terminal, chalk.yellow(`mount: ${entryType} filesystem does not require a source, ignoring source for ${entryTarget}`))
              }

              // Check if filesystem type requires source but none is provided
              const requiresSourceTypes = ['zip', 'iso', 'fetch', 'indexeddb']
              if (!entrySource && requiresSourceTypes.includes(entryType.toLowerCase())) {
                await writelnStderr(process, terminal, chalk.yellow(`mount: skipping ${entryTarget}: ${entryType} filesystem requires a source`))
                failCount++
                continue
              }

              // Create target directory if needed
              const parentDir = path.dirname(entryTarget)
              if (parentDir !== entryTarget && !(await shell.context.fs.promises.exists(parentDir))) {
                await shell.context.fs.promises.mkdir(parentDir, { recursive: true })
              }

              if (!(await shell.context.fs.promises.exists(entryTarget))) {
                await shell.context.fs.promises.mkdir(entryTarget, { recursive: true })
              }

              // Parse mount options
              const mountOptions = entryOptions?.split(',').reduce((acc, option) => {
                const [key, value] = option.split('=')
                if (key && value) {
                  acc[key.trim()] = value.trim()
                }
                return acc
              }, {} as Record<string, string>) || {}

              // Perform the mount based on type
              switch (entryType.toLowerCase()) {
                case 'fetch': {
                  let fetchBaseUrl = mountOptions.baseUrl || ''
                  let indexUrl: string

                  if (entrySource && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entrySource)) {
                    indexUrl = entrySource
                  } else {
                    if (!fetchBaseUrl) {
                      throw new Error('fetch filesystem requires either a full URL as source or baseUrl option')
                    }
                    fetchBaseUrl = new URL(fetchBaseUrl).toString()
                    indexUrl = new URL(entrySource || 'index.json', fetchBaseUrl).toString()
                  }
                  
                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: Fetch,
                      index: indexUrl,
                      baseUrl: fetchBaseUrl,
                      disableAsyncCache: true,
                    })
                  )
                  break
                }
                case 'indexeddb':
                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: IndexedDB,
                      storeName: entrySource || entryTarget
                    })
                  )
                  break
                case 'webstorage': {
                  const storageType = mountOptions.storage?.toLowerCase() || 'localstorage'
                  let storage: Storage
                  
                  if (storageType === 'sessionstorage') {
                    if (typeof sessionStorage === 'undefined') {
                      throw new Error('sessionStorage is not available in this environment')
                    }
                    storage = sessionStorage
                  } else if (storageType === 'localstorage') {
                    if (typeof localStorage === 'undefined') {
                      throw new Error('localStorage is not available in this environment')
                    }
                    storage = localStorage
                  } else {
                    throw new Error(`invalid storage type '${storageType}'. Use 'localStorage' or 'sessionStorage'`)
                  }
                  
                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: WebStorage,
                      storage
                    } as { backend: typeof WebStorage; storage: Storage })
                  )
                  break
                }
                case 'webaccess': {
                  if (typeof window === 'undefined') {
                    throw new Error('File System Access API is not available in this environment')
                  }
                  
                  const win = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
                  if (!win.showDirectoryPicker) {
                    throw new Error('File System Access API is not available in this environment')
                  }
                  
                  // For fstab, we can't interactively pick a directory, so skip
                  await writelnStderr(process, terminal, chalk.yellow(`mount: skipping ${entryTarget}: webaccess requires interactive directory selection`))
                  failCount++
                  continue
                }
                case 'memory':
                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: InMemory
                    })
                  )
                  break
                case 'singlebuffer': {
                  const bufferSize = mountOptions.size 
                    ? parseInt(mountOptions.size, 10) 
                    : 1048576
                  
                  if (isNaN(bufferSize) || bufferSize <= 0) {
                    throw new Error('invalid buffer size for singlebuffer type')
                  }

                  let buffer: ArrayBuffer | SharedArrayBuffer
                  try {
                    buffer = new SharedArrayBuffer(bufferSize)
                  } catch {
                    buffer = new ArrayBuffer(bufferSize)
                  }

                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: SingleBuffer,
                      buffer
                    })
                  )
                  break
                }
                case 'zip': {
                  if (!entrySource) {
                    throw new Error('zip filesystem requires a source file or URL')
                  }

                  let arrayBuffer: ArrayBuffer

                  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entrySource)) {
                    const response = await fetch(entrySource)
                    if (!response.ok) {
                      throw new Error(`failed to fetch archive: ${response.status} ${response.statusText}`)
                    }
                    arrayBuffer = await response.arrayBuffer()
                  } else {
                    const sourcePath = path.resolve('/', entrySource)
                    if (!(await shell.context.fs.promises.exists(sourcePath))) {
                      throw new Error(`archive file not found: ${sourcePath}`)
                    }
                    const fileData = await shell.context.fs.promises.readFile(sourcePath)
                    arrayBuffer = new Uint8Array(fileData).buffer
                  }

                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: Zip,
                      data: arrayBuffer
                    })
                  )
                  break
                }
                case 'iso': {
                  if (!entrySource) {
                    throw new Error('iso filesystem requires a source file or URL')
                  }

                  let uint8Array: Uint8Array

                  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entrySource)) {
                    const response = await fetch(entrySource)
                    if (!response.ok) {
                      throw new Error(`failed to fetch ISO image: ${response.status} ${response.statusText}`)
                    }
                    const arrayBuffer = await response.arrayBuffer()
                    uint8Array = new Uint8Array(arrayBuffer)
                  } else {
                    const sourcePath = path.resolve('/', entrySource)
                    if (!(await shell.context.fs.promises.exists(sourcePath))) {
                      throw new Error(`ISO image file not found: ${sourcePath}`)
                    }
                    uint8Array = await shell.context.fs.promises.readFile(sourcePath)
                  }

                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: Iso,
                      data: uint8Array
                    })
                  )
                  break
                }
                case 'dropbox': {
                  if (!mountOptions.client) {
                    throw new Error('dropbox filesystem requires client configuration')
                  }

                  let clientConfig: { accessToken: string; [key: string]: unknown }
                  try {
                    clientConfig = JSON.parse(mountOptions.client)
                  } catch {
                    throw new Error('invalid JSON in client option')
                  }

                  if (!clientConfig.accessToken) {
                    throw new Error('client configuration must include accessToken')
                  }

                  const dropboxModule = await import('dropbox')
                  const DropboxClient = dropboxModule.Dropbox
                  const client = new DropboxClient(clientConfig)
                  const cacheTTL = mountOptions.cacheTTL ? parseInt(mountOptions.cacheTTL, 10) : undefined

                  await kernel.filesystem.fsSync.mount(
                    entryTarget,
                    await resolveMountConfig({
                      backend: Dropbox,
                      client,
                      ...(cacheTTL && !isNaN(cacheTTL) ? { cacheTTL } : {})
                    })
                  )
                  break
                }
                case 'googledrive': {
                  if (typeof window === 'undefined') {
                    throw new Error('Google Drive API requires a browser environment')
                  }

                  if (!mountOptions.apiKey) {
                    throw new Error('googledrive filesystem requires apiKey option')
                  }

                  // Google Drive mounting is complex and requires interactive auth
                  // For fstab, we'll skip it with a warning
                  await writelnStderr(process, terminal, chalk.yellow(`mount: skipping ${entryTarget}: googledrive requires interactive authentication`))
                  failCount++
                  continue
                }
                default:
                  throw new Error(`unknown filesystem type '${entryType}'`)
              }

              const successMessage = entrySource
                ? chalk.green(`Mounted ${entryType} filesystem from ${entrySource} to ${entryTarget}`)
                : chalk.green(`Mounted ${entryType} filesystem at ${entryTarget}`)
              await writelnStdout(process, terminal, successMessage)
              successCount++
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error'
              await writelnStderr(process, terminal, chalk.red(`mount: failed to mount ${entry.target}: ${errorMessage}`))
              failCount++
            }
          }

          await writelnStdout(process, terminal, `\nMount summary: ${successCount} succeeded, ${failCount} failed`)
          return failCount > 0 ? 1 : 0
        } catch (error) {
          await writelnStderr(process, terminal, chalk.red(`mount: failed to process /etc/fstab: ${error instanceof Error ? error.message : 'Unknown error'}`))
          return 1
        }
      }

      if (positionalArgs.length === 0) {
        await writelnStderr(process, terminal, chalk.red('mount: missing target argument'))
        await writelnStderr(process, terminal, 'Try \'mount --help\' for more information.')
        return 1
      }

      if (positionalArgs.length > 2) {
        await writelnStderr(process, terminal, chalk.red('mount: too many arguments'))
        await writelnStderr(process, terminal, 'Try \'mount --help\' for more information.')
        return 1
      }

      if (!type) {
        await writelnStderr(process, terminal, chalk.red('mount: filesystem type must be specified'))
        await writelnStderr(process, terminal, 'Try \'mount --help\' for more information.')
        return 1
      }

      const source = positionalArgs.length === 2 ? positionalArgs[0] : ''
      const targetArg = positionalArgs[positionalArgs.length - 1]
      
      if (!targetArg) {
        await writelnStderr(process, terminal, chalk.red('mount: missing target argument'))
        return 1
      }

      const target = path.resolve(shell.cwd, targetArg)

      if (positionalArgs.length === 2 && (type.toLowerCase() === 'memory' || type.toLowerCase() === 'singlebuffer' || type.toLowerCase() === 'webstorage' || type.toLowerCase() === 'webaccess' || type.toLowerCase() === 'xml' || type.toLowerCase() === 'dropbox' /* || type.toLowerCase() === 's3' */ || type.toLowerCase() === 'googledrive')) {
        await writelnStderr(process, terminal, chalk.yellow(`mount: ${type.toLowerCase()} filesystem does not require a source`))
        await writelnStderr(process, terminal, `Usage: mount -t ${type.toLowerCase()} TARGET`)
        return 1
      }

      if (positionalArgs.length === 1 && (type.toLowerCase() === 'zip' || type.toLowerCase() === 'iso')) {
        await writelnStderr(process, terminal, chalk.red(`mount: ${type.toLowerCase()} filesystem requires a source file or URL`))
        await writelnStderr(process, terminal, `Usage: mount -t ${type.toLowerCase()} SOURCE TARGET`)
        return 1
      }

      try {
        const parentDir = path.dirname(target)
        if (parentDir !== target && !(await shell.context.fs.promises.exists(parentDir))) {
          await shell.context.fs.promises.mkdir(parentDir, { recursive: true })
        }

        if (!(await shell.context.fs.promises.exists(target))) {
          await shell.context.fs.promises.mkdir(target, { recursive: true })
        }

        const mountOptions = options?.split(',').reduce((acc, option) => {
          const [key, value] = option.split('=')
          if (key && value) {
            acc[key.trim()] = value.trim()
          }
          return acc
        }, {} as Record<string, string>) || {}

        switch (type.toLowerCase()) {
          case 'fetch': {
            let fetchBaseUrl = new URL(mountOptions.baseUrl || '').toString()
            let indexUrl: string

            if (source && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source)) {
              indexUrl = source
            } else {
              indexUrl = new URL(source || 'index.json', fetchBaseUrl).toString()
            }
            
            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: Fetch,
                index: indexUrl,
                baseUrl: fetchBaseUrl,
                disableAsyncCache: true,
              })
            )
            break
          }
          case 'indexeddb':
            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: IndexedDB,
                storeName: source || target
              })
            )
            break
          case 'webstorage': {
            const storageType = mountOptions.storage?.toLowerCase() || 'localstorage'
            let storage: Storage
            
            if (storageType === 'sessionstorage') {
              if (typeof sessionStorage === 'undefined') {
                await writelnStderr(process, terminal, chalk.red('mount: sessionStorage is not available in this environment'))
                return 1
              }
              storage = sessionStorage
            } else if (storageType === 'localstorage') {
              if (typeof localStorage === 'undefined') {
                await writelnStderr(process, terminal, chalk.red('mount: localStorage is not available in this environment'))
                return 1
              }
              storage = localStorage
            } else {
              await writelnStderr(process, terminal, chalk.red(`mount: invalid storage type '${storageType}'. Use 'localStorage' or 'sessionStorage'`))
              return 1
            }
            
            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: WebStorage,
                storage
              } as { backend: typeof WebStorage; storage: Storage })
            )
            break
          }
          case 'webaccess': {
            if (typeof window === 'undefined') {
              await writelnStderr(process, terminal, chalk.red('mount: File System Access API is not available in this environment'))
              return 1
            }
            
            const win = window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
            if (!win.showDirectoryPicker) {
              await writelnStderr(process, terminal, chalk.red('mount: File System Access API is not available in this environment'))
              return 1
            }
            
            try {
              const directoryHandle = await win.showDirectoryPicker()
              
              await kernel.filesystem.fsSync.mount(
                target,
                await resolveMountConfig({
                  backend: WebAccess,
                  handle: directoryHandle
                } as { backend: typeof WebAccess; handle: FileSystemDirectoryHandle })
              )
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') {
                await writelnStderr(process, terminal, chalk.yellow('mount: directory selection cancelled'))
                return 1
              }
              throw error
            }
            break
          }
          // TODO: Some more work needs to be done with the XML backend
          // case 'xml': {
          //   if (typeof document === 'undefined') {
          //     await writelnStderr(process, terminal, chalk.red('mount: XML backend requires DOM APIs (document) which are not available in this environment'))
          //     return 1
          //   }
            
          //   let root: Element | undefined
            
          //   if (mountOptions.root) {
          //     const rootSelector = mountOptions.root
          //     const element = document.querySelector(rootSelector)
          //     if (!element) {
          //       await writelnStderr(process, terminal, chalk.yellow(`mount: root element '${rootSelector}' not found, creating new element`))
          //       root = new DOMParser().parseFromString('<fs></fs>', 'application/xml').documentElement
          //       root.setAttribute('id', 'xmlfs-' + Math.random().toString(36).substring(2, 15))
          //       root.setAttribute('style', 'display: none')
          //     } else {
          //       root = element as Element
          //     }
          //   } else {
          //     root = new DOMParser().parseFromString('<fs></fs>', 'application/xml').documentElement
          //     root.setAttribute('id', 'xmlfs-' + Math.random().toString(36).substring(2, 15))
          //     root.setAttribute('style', 'display: none')
          //   }
            
          //   if (!root) throw new Error('Failed to create root element')

          //   const rootNode = document.createElement('file')
          //   rootNode.setAttribute('paths', JSON.stringify(['/']))
          //   rootNode.setAttribute('nlink', '1')
          //   rootNode.setAttribute('mode', (constants.S_IFDIR | 0o777).toString(16))
          //   rootNode.setAttribute('uid', (0).toString(16))
          //   rootNode.setAttribute('gid', (0).toString(16))
          //   rootNode.textContent = '[]'

          //   root.appendChild(rootNode)
            
          //   try {
          //     const config = {
          //       backend: XML,
          //       root
          //     } as { backend: typeof XML; root: Element }
              
          //     document.body.appendChild(root)
          //     const mountConfig = await resolveMountConfig(config)
          //     await kernel.filesystem.fsSync.mount(target, mountConfig)
          //   } catch (error) {
          //     const errorMessage = error instanceof Error ? error.message : String(error)
          //     await writelnStderr(process, terminal, chalk.red(`mount: failed to mount XML filesystem: ${errorMessage}`))
          //     if (error instanceof Error && error.stack) {
          //       await writelnStderr(process, terminal, chalk.gray(`Stack: ${error.stack}`))
          //     }
          //     return 1
          //   }
          //   break
          // }
          case 'memory':
            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: InMemory
              })
            )
            break
          case 'singlebuffer': {
            const bufferSize = mountOptions.size 
              ? parseInt(mountOptions.size, 10) 
              : 1048576
            
            if (isNaN(bufferSize) || bufferSize <= 0) {
              await writelnStderr(process, terminal, chalk.red('mount: invalid buffer size for singlebuffer type'))
              return 1
            }

            let buffer: ArrayBuffer | SharedArrayBuffer
            try {
              buffer = new SharedArrayBuffer(bufferSize)
            } catch {
              buffer = new ArrayBuffer(bufferSize)
            }

            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: SingleBuffer,
                buffer
              })
            )
            break
          }
          case 'zip': {
            if (!source) {
              await writelnStderr(process, terminal, chalk.red('mount: zip filesystem requires a source file or URL'))
              return 1
            }

            let arrayBuffer: ArrayBuffer

            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source)) {
              await writelnStdout(process, terminal, chalk.gray(`Fetching archive from ${source}...`))
              const response = await fetch(source)
              if (!response.ok) {
                await writelnStderr(process, terminal, chalk.red(`mount: failed to fetch archive: ${response.status} ${response.statusText}`))
                return 1
              }
              arrayBuffer = await response.arrayBuffer()
            } else {
              const sourcePath = path.resolve(shell.cwd, source)
              if (!(await shell.context.fs.promises.exists(sourcePath))) {
                await writelnStderr(process, terminal, chalk.red(`mount: archive file not found: ${sourcePath}`))
                return 1
              }
              await writelnStdout(process, terminal, chalk.gray(`Reading archive from ${sourcePath}...`))
              const fileData = await shell.context.fs.promises.readFile(sourcePath)
              arrayBuffer = new Uint8Array(fileData).buffer
            }

            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: Zip,
                data: arrayBuffer
              })
            )
            break
          }
          case 'iso': {
            if (!source) {
              await writelnStderr(process, terminal, chalk.red('mount: iso filesystem requires a source file or URL'))
              return 1
            }

            let uint8Array: Uint8Array

            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source)) {
              await writelnStdout(process, terminal, chalk.gray(`Fetching ISO image from ${source}...`))
              const response = await fetch(source)
              if (!response.ok) {
                await writelnStderr(process, terminal, chalk.red(`mount: failed to fetch ISO image: ${response.status} ${response.statusText}`))
                return 1
              }
              const arrayBuffer = await response.arrayBuffer()
              uint8Array = new Uint8Array(arrayBuffer)
            } else {
              const sourcePath = path.resolve(shell.cwd, source)
              if (!(await shell.context.fs.promises.exists(sourcePath))) {
                await writelnStderr(process, terminal, chalk.red(`mount: ISO image file not found: ${sourcePath}`))
                return 1
              }
              await writelnStdout(process, terminal, chalk.gray(`Reading ISO image from ${sourcePath}...`))
              uint8Array = await shell.context.fs.promises.readFile(sourcePath)
            }

            await kernel.filesystem.fsSync.mount(
              target,
              await resolveMountConfig({
                backend: Iso,
                data: uint8Array
              })
            )
            break
          }
          case 'dropbox': {
            if (!mountOptions.client) {
              await writelnStderr(process, terminal, chalk.red('mount: dropbox filesystem requires client configuration'))
              await writelnStderr(process, terminal, 'Usage: mount -t dropbox TARGET -o client=\'{"accessToken":"..."}\'')
              return 1
            }

            try {
              let clientConfig: { accessToken: string; [key: string]: unknown }
              try {
                clientConfig = JSON.parse(mountOptions.client)
              } catch {
                await writelnStderr(process, terminal, chalk.red('mount: invalid JSON in client option'))
                return 1
              }

              if (!clientConfig.accessToken) {
                await writelnStderr(process, terminal, chalk.red('mount: client configuration must include accessToken'))
                return 1
              }

              const dropboxModule = await import('dropbox')
              const DropboxClient = dropboxModule.Dropbox
              const client = new DropboxClient(clientConfig)
              const cacheTTL = mountOptions.cacheTTL ? parseInt(mountOptions.cacheTTL, 10) : undefined

              await kernel.filesystem.fsSync.mount(
                target,
                await resolveMountConfig({
                  backend: Dropbox,
                  client,
                  ...(cacheTTL && !isNaN(cacheTTL) ? { cacheTTL } : {})
                })
              )
            } catch (error) {
              await writelnStderr(process, terminal, chalk.red(`mount: failed to mount dropbox filesystem: ${error instanceof Error ? error.message : 'Unknown error'}`))
              return 1
            }
            break
          }
          /* case 's3': {
            if (!mountOptions.bucket) {
              await writelnStderr(process, terminal, chalk.red('mount: s3 filesystem requires bucket option'))
              await writelnStderr(process, terminal, 'Usage: mount -t s3 TARGET -o bucket=my-bucket')
              return 1
            }

            try {
              // Start with default config
              let clientConfigRaw: { region?: string; credentials?: { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string }; [key: string]: unknown } = {}

              // Parse client config if provided
              if (mountOptions.client) {
                try {
                  clientConfigRaw = JSON.parse(mountOptions.client)
                } catch {
                  await writelnStderr(process, terminal, chalk.red('mount: invalid JSON in client option'))
                  return 1
                }
              }

              // Set region: use from config, then env var, then default
              if (!clientConfigRaw.region) {
                clientConfigRaw.region = shell.env.get('AWS_DEFAULT_REGION') || 'us-east-1'
              }

              // Use environment variables as defaults if credentials not provided
              if (!clientConfigRaw.credentials) {
                const accessKeyId = shell.env.get('AWS_ACCESS_KEY_ID')
                const secretAccessKey = shell.env.get('AWS_SECRET_ACCESS_KEY')
                const sessionToken = shell.env.get('AWS_SESSION_TOKEN')

                if (accessKeyId && secretAccessKey) {
                  clientConfigRaw.credentials = {
                    accessKeyId,
                    secretAccessKey,
                    ...(sessionToken ? { sessionToken } : {})
                  }
                }
              } else {
                // Validate credentials if provided
                if (!clientConfigRaw.credentials.accessKeyId || !clientConfigRaw.credentials.secretAccessKey) {
                  await writelnStderr(process, terminal, chalk.yellow('mount: credentials object should include both accessKeyId and secretAccessKey'))
                  await writelnStderr(process, terminal, 'Note: If credentials are not provided, AWS SDK will use default credential chain (env vars, IAM role, etc.)')
                }
              }

              // Configure for browser environment if needed
              if (typeof window !== 'undefined') {
                // Ensure we're using fetch for browser requests
                if (!clientConfigRaw.requestHandler) {
                  // The AWS SDK v3 uses fetch by default in browsers, but we can explicitly set it
                  // This helps ensure CORS is handled properly
                  clientConfigRaw.requestHandler = undefined // Let SDK use default browser fetch
                }
              }

              const s3Module = await import('@aws-sdk/client-s3')
              const S3Client = s3Module.S3
              const client = new S3Client(clientConfigRaw as never)
              const bucketName = mountOptions.bucket
              const prefix = mountOptions.prefix
              const cacheTTL = mountOptions.cacheTTL ? parseInt(mountOptions.cacheTTL, 10) : undefined

              try {
                await kernel.filesystem.fsSync.mount(
                  target,
                  await resolveMountConfig({
                    backend: S3Bucket,
                    client,
                    bucketName,
                    ...(prefix ? { prefix } : {}),
                    ...(cacheTTL && !isNaN(cacheTTL) ? { cacheTTL } : {})
                  })
                )
              } catch (mountError) {
                const errorMessage = mountError instanceof Error ? mountError.message : String(mountError)
                // Provide helpful guidance for common S3 errors
                await writelnStderr(process, terminal, chalk.red(`mount: failed to mount s3 filesystem: ${errorMessage}`))
                await writelnStderr(process, terminal, chalk.yellow('\nS3 CORS configuration may be required:'))
                await writelnStderr(process, terminal, 'For browser access, your S3 bucket needs CORS configuration:')
                await writelnStderr(process, terminal, '  {')
                await writelnStderr(process, terminal, '    "CORSRules": [{')
                await writelnStderr(process, terminal, '      "AllowedOrigins": ["*"],')
                await writelnStderr(process, terminal, '      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],')
                await writelnStderr(process, terminal, '      "AllowedHeaders": ["*"],')
                await writelnStderr(process, terminal, '      "ExposeHeaders": ["ETag"],')
                await writelnStderr(process, terminal, '      "MaxAgeSeconds": 3000')
                await writelnStderr(process, terminal, '    }]')
                await writelnStderr(process, terminal, '  }')
                await writelnStderr(process, terminal, chalk.gray('\nAlso ensure your bucket policy allows the required operations.'))
                throw mountError
              }
            } catch (error) {
              await writelnStderr(process, terminal, chalk.red(`mount: failed to mount s3 filesystem: ${error instanceof Error ? error.message : 'Unknown error'}`))
              if (error instanceof Error && error.stack) {
                await writelnStderr(process, terminal, chalk.gray(error.stack))
              }
              return 1
            }
            break
          } */
          case 'googledrive': {
            try {
              if (typeof window === 'undefined') {
                await writelnStderr(process, terminal, chalk.red('mount: Google Drive API requires a browser environment'))
                return 1
              }

              if (!mountOptions.apiKey) {
                await writelnStderr(process, terminal, chalk.red('mount: googledrive filesystem requires apiKey option'))
                await writelnStderr(process, terminal, 'Usage: mount -t googledrive TARGET -o apiKey=YOUR_API_KEY')
                return 1
              }

              const win = window as unknown as { 
                gapi?: { 
                  load?: (module: string, callback: () => void) => void
                  client?: { 
                    init?: (config: { apiKey: string; clientId?: string; discoveryDocs?: string[]; scope?: string }) => Promise<void>
                    request?: (config: { path: string }) => Promise<unknown>
                    drive?: unknown
                  }
                }
              }

              // Load Google API script if not already loaded
              if (!win.gapi) {
                await writelnStdout(process, terminal, chalk.gray('Loading Google API client library...'))
                
                await new Promise<void>((resolve, reject) => {
                  const script = document.createElement('script')
                  script.src = 'https://apis.google.com/js/api.js'
                  script.onload = () => resolve()
                  script.onerror = () => reject(new Error('Failed to load Google API script'))
                  document.head.appendChild(script)
                })
              }

              // Wait for gapi to be available
              let attempts = 0
              while (!win.gapi && attempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100))
                attempts++
              }

              if (!win.gapi) {
                await writelnStderr(process, terminal, chalk.red('mount: Failed to load Google API client library'))
                return 1
              }

              // Initialize gapi.client
              if (!win.gapi.client || !win.gapi.client.drive) {
                await writelnStdout(process, terminal, chalk.gray('Initializing Google API client...'))
                
                const initConfig: { 
                  apiKey: string
                  clientId?: string
                  discoveryDocs?: string[]
                  scope?: string
                } = {
                  apiKey: mountOptions.apiKey
                }

                if (mountOptions.clientId) {
                  initConfig.clientId = mountOptions.clientId
                }

                const scope = mountOptions.scope || 'https://www.googleapis.com/auth/drive'
                initConfig.scope = scope
                initConfig.discoveryDocs = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']

                // Load the client module
                await new Promise<void>((resolve, reject) => {
                  if (!win.gapi?.load) {
                    reject(new Error('gapi.load is not available'))
                    return
                  }
                  win.gapi.load('client', () => {
                    if (!win.gapi?.client?.init) {
                      reject(new Error('gapi.client.init is not available'))
                      return
                    }
                    win.gapi.client.init(initConfig)
                      .then(() => resolve())
                      .catch(reject)
                  })
                })

                // Load the Drive API
                await new Promise<void>((resolve, reject) => {
                  if (!win.gapi?.client?.request) {
                    reject(new Error('gapi.client.request is not available'))
                    return
                  }
                  // Drive API is loaded via discoveryDocs, but we need to ensure it's ready
                  // The Drive API should be available after init, but we'll wait a bit
                  setTimeout(() => {
                    const gapi = win.gapi
                    if (gapi?.client?.drive) {
                      resolve()
                    } else if (gapi?.client?.request) {
                      // Try to trigger Drive API loading by making a simple request
                      gapi.client.request({
                        path: 'https://www.googleapis.com/drive/v3/about?fields=user'
                      }).then(() => {
                        resolve()
                      }).catch(() => {
                        // Even if this fails, drive might still be available
                        if (gapi?.client?.drive) {
                          resolve()
                        } else {
                          reject(new Error('Failed to load Drive API'))
                        }
                      })
                    } else {
                      reject(new Error('gapi.client.request is not available'))
                    }
                  }, 500)
                })
              }

              if (!win.gapi?.client?.drive) {
                await writelnStderr(process, terminal, chalk.red('mount: Google Drive API is not available'))
                await writelnStderr(process, terminal, 'Please ensure the Drive API is enabled in your Google Cloud project')
                return 1
              }

              // Handle OAuth authentication if clientId is provided
              if (mountOptions.clientId) {
                await writelnStdout(process, terminal, chalk.gray('Checking authentication status...'))
                
                const driveScope = mountOptions.scope || 'https://www.googleapis.com/auth/drive'
                
                // Check if user is already signed in
                try {
                  const client = win.gapi?.client
                  if (client?.request) {
                    await (client.request as (config: { path: string }) => Promise<unknown>)({
                      path: 'https://www.googleapis.com/drive/v3/about?fields=user'
                    })
                  }
                } catch (error) {
                  // User needs to authenticate
                  await writelnStdout(process, terminal, chalk.yellow('Authentication required. Please sign in to Google...'))
                  
                  const authInstance = (win.gapi as unknown as { auth2?: { getAuthInstance?: () => { signIn: () => Promise<unknown> } } }).auth2
                  if (authInstance?.getAuthInstance) {
                    const auth = authInstance.getAuthInstance()
                    await auth.signIn()
                  } else {
                    // Fallback: try to trigger auth flow
                    await new Promise<void>((resolve, reject) => {
                      if (!win.gapi?.load) {
                        reject(new Error('gapi.load is not available'))
                        return
                      }
                      win.gapi.load('auth2', () => {
                        const auth2 = (win.gapi as unknown as { auth2?: { init: (config: unknown) => Promise<unknown>; getAuthInstance: () => { signIn: () => Promise<unknown> } } }).auth2
                        if (auth2?.init) {
                          auth2.init({
                            client_id: mountOptions.clientId,
                            scope: driveScope
                          }).then(() => {
                            if (auth2.getAuthInstance) {
                              const auth = auth2.getAuthInstance()
                              auth.signIn().then(() => resolve()).catch(reject)
                            } else {
                              resolve()
                            }
                          }).catch(reject)
                        } else {
                          resolve()
                        }
                      })
                    })
                  }
                }
              }

              const drive = win.gapi.client.drive
              const cacheTTL = mountOptions.cacheTTL ? parseInt(mountOptions.cacheTTL, 10) : undefined

              await kernel.filesystem.fsSync.mount(
                target,
                await resolveMountConfig({
                  backend: GoogleDrive,
                  drive: drive as never, // gapi.client.drive type from global
                  ...(cacheTTL && !isNaN(cacheTTL) ? { cacheTTL } : {})
                })
              )
            } catch (error) {
              await writelnStderr(process, terminal, chalk.red(`mount: failed to mount googledrive filesystem: ${error instanceof Error ? error.message : 'Unknown error'}`))
              if (error instanceof Error && error.stack) {
                await writelnStderr(process, terminal, chalk.gray(error.stack))
              }
              return 1
            }
            break
          }
          default:
            await writelnStderr(process, terminal, chalk.red(`mount: unknown filesystem type '${type}'`))
            await writelnStderr(process, terminal, 'Supported types: fetch, indexeddb, webstorage, webaccess, memory, singlebuffer, zip, iso, dropbox, s3, googledrive')
            return 1
        }

        const successMessage = source
          ? chalk.green(`Mounted ${type} filesystem from ${source} to ${target}`)
          : chalk.green(`Mounted ${type} filesystem at ${target}`)
        await writelnStdout(process, terminal, successMessage)
        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`mount: failed to mount filesystem: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }
  })
}
