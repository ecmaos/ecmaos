import path from 'path'
import type { Kernel, FileHandle, Shell, WasiStreamOptions } from '@ecmaos/types'


/**
 * Create WASI Preview 1 bindings
 * Preview 1 uses file descriptor-based I/O
 */
export default function createWasiPreview1Bindings({
  kernel,
  streams,
  args,
  hasAsyncify = false,
  memoryRequirements = { initial: 1 },
  shell,
  pid
}: {
  kernel: Kernel,
  streams: WasiStreamOptions,
  args: string[],
  hasAsyncify: boolean,
  memoryRequirements: { initial: number; maximum?: number },
  shell: Shell,
  pid?: number
}): { 
  imports: WebAssembly.Imports, 
  setMemory: (memory: WebAssembly.Memory) => void, 
  setInstance: (inst: WebAssembly.Instance) => void,
  flush: () => Promise<void>, 
  waitForInput: (timeoutMs?: number) => Promise<void>,
  getAsyncifyState: () => { pending: boolean, dataAddr: number },
  resetAsyncifyPending: () => void,
  setAsyncifyDataAddr: (addr: number) => void,
  waitForStdinData: () => Promise<void>,
  initializePreOpenedDirs: () => Promise<void>
} {
  const memoryOptions: { initial: number; maximum?: number } = { 
    initial: memoryRequirements.initial
  }
  // Only set maximum if specified in the import declaration
  // If not specified, the WASM module will use its own declared maximum
  if (memoryRequirements.maximum !== undefined) {
    // Cap maximum at 65536, which is the limit for WebAssembly.Memory
    memoryOptions.maximum = Math.min(memoryRequirements.maximum, 65536)
  }
  const initialMemory = new WebAssembly.Memory(memoryOptions)
  let activeMemory = initialMemory
  let wasmInstance: WebAssembly.Instance | null = null

  const encoder = new TextEncoder()
  const encodedArgs = args.map((arg) => encoder.encode(arg))
  const argsBufferSize = encodedArgs.reduce((total, bytes) => total + bytes.length + 1, 0)

  // Collect environment variables from the provided shell, or fall back to kernel shell
  const envEntries: Array<[string, string]> = []
  const activeShell = shell || kernel.shell
  if (activeShell && activeShell.env) {
    for (const [key, value] of activeShell.env.entries()) {
      envEntries.push([key, value])
    }
  }
  
  // Encode environment variables as "KEY=VALUE\0" strings
  const encodedEnvVars = envEntries.map(([key, value]) => {
    const envString = `${key}=${value}`
    return encoder.encode(envString)
  })
  
  // Calculate total buffer size needed for environment variables
  // Each env var is "KEY=VALUE\0" (null-terminated)
  const totalEnvironBufSize = encodedEnvVars.reduce((total, bytes) => total + bytes.length + 1, 0)

  const stdinReader = streams.stdin.getReader()
  const stdoutWriter = streams.stdout.getWriter()
  const stderrWriter = streams.stderr.getWriter()
  
  const stdinBuffer: Uint8Array[] = []
  let stdinBufferOffset = 0
  let stdinClosed = false
  
  let asyncifyPending = false
  let asyncifyDataAddr = 0

  interface FdEntry {
    handle: FileHandle
    path: string
    isDirectory: boolean
    position?: number
    preOpened?: boolean
  }

  const fdMap = new Map<number, FdEntry>()
  let nextFd = 4

  const mapFilesystemError = (error: Error): number => {
    const message = error.message.toLowerCase()
    const code = (error as { code?: string }).code

    if (code === 'ENOENT' || message.includes('not found') || message.includes('enoent')) return 2
    if (code === 'EIO' || message.includes('i/o error') || message.includes('eio')) return 5
    if (code === 'EBADF' || message.includes('bad file descriptor') || message.includes('ebadf')) return 8
    if (code === 'ENOTDIR' || message.includes('not a directory') || message.includes('enotdir')) return 54
    if (code === 'EISDIR' || message.includes('is a directory') || message.includes('eisdir')) return 55
    if (code === 'ENOTEMPTY' || message.includes('not empty') || message.includes('enotempty')) return 66
    if (code === 'EEXIST' || message.includes('already exists') || message.includes('eexist')) return 20
    if (code === 'EACCES' || message.includes('permission denied') || message.includes('eacces')) return 13
    if (code === 'ENOSYS' || message.includes('not implemented') || message.includes('enosys') || message.includes('not supported')) return 52

    return 5
  }

  const getFileHandle = (fd: number): FdEntry | null => {
    if (fd < 0 || fd > 2) {
      return fdMap.get(fd) || null
    }
    return null
  }

  const allocateFd = (handle: FileHandle, filePath: string, isDirectory: boolean, preOpened: boolean = false): number => {
    const fd = preOpened ? 3 : nextFd++
    fdMap.set(fd, { handle, path: filePath, isDirectory, position: 0, preOpened })
    return fd
  }

  const resolvePath = (dirfd: number, pathStr: string): string => {
    if (pathStr.startsWith('/')) {
      return pathStr
    }

    let basePath = '/'
    if (dirfd === 3) {
      basePath = '/'
    } else if (dirfd > 3) {
      const entry = fdMap.get(dirfd)
      if (!entry) {
        throw new Error('EBADF')
      }
      if (!entry.isDirectory) {
        throw new Error('ENOTDIR')
      }
      basePath = entry.path
    } else if (dirfd < 0) {
      basePath = '/'
    }

    return path.resolve(basePath, pathStr)
  }

  const readStringFromMemory = (ptr: number, len: number, memory: WebAssembly.Memory): string => {
    const bytes = new Uint8Array(memory.buffer, ptr, len)
    return new TextDecoder().decode(bytes)
  }

  const readNullTerminatedString = (ptr: number, memory: WebAssembly.Memory, maxLen: number = 4096): string => {
    const view = new DataView(memory.buffer)
    let len = 0
    while (len < maxLen && view.getUint8(ptr + len) !== 0) {
      len++
    }
    return readStringFromMemory(ptr, len, memory)
  }

  const writeStat64 = (stat: { mode: number; size: number; mtime: number; ctime: number; ino: number; dev: number; nlink: number; uid: number; gid: number; rdev: number; blksize: number; blocks: number; atime: number }, buf: number, memory: WebAssembly.Memory): void => {
    const view = new DataView(memory.buffer)
    let offset = buf

    view.setBigUint64(offset, BigInt(stat.dev), true)
    offset += 8
    view.setBigUint64(offset, BigInt(stat.ino), true)
    offset += 8
    view.setUint32(offset, stat.mode, true)
    offset += 4
    view.setUint32(offset, stat.nlink, true)
    offset += 4
    view.setUint32(offset, stat.uid, true)
    offset += 4
    view.setUint32(offset, stat.gid, true)
    offset += 4
    view.setBigUint64(offset, BigInt(stat.rdev), true)
    offset += 8
    view.setBigUint64(offset, BigInt(stat.size), true)
    offset += 8
    view.setUint32(offset, stat.blksize, true)
    offset += 4
    view.setBigUint64(offset, BigInt(stat.blocks), true)
    offset += 8
    view.setBigUint64(offset, BigInt(Math.floor(stat.atime / 1000)), true)
    offset += 8
    view.setBigUint64(offset, BigInt(Math.floor(stat.mtime / 1000)), true)
    offset += 8
    view.setBigUint64(offset, BigInt(Math.floor(stat.ctime / 1000)), true)
  }

  const writeFilestat = (stat: { size: number; mtime: number; ctime: number; atime: number; ino: number; dev: number; nlink: number; isDirectory: boolean; isFile: boolean }, buf: number, memory: WebAssembly.Memory): void => {
    const view = new DataView(memory.buffer)
    let offset = buf

    view.setBigUint64(offset, BigInt(stat.dev || 1), true)
    offset += 8
    view.setBigUint64(offset, BigInt(stat.ino || 1), true)
    offset += 8
    
    let filetype = 0
    if (stat.isDirectory) {
      filetype = 3
    } else if (stat.isFile) {
      filetype = 4
    }
    view.setUint8(offset, filetype)
    offset += 1
    
    for (let i = 0; i < 7; i++) {
      view.setUint8(offset + i, 0)
    }
    offset += 7
    
    view.setBigUint64(offset, BigInt(stat.nlink || 1), true)
    offset += 8
    view.setBigUint64(offset, BigInt(stat.size || 0), true)
    offset += 8
    view.setBigUint64(offset, BigInt(Math.floor((stat.atime || Date.now()) * 1000000)), true)
    offset += 8
    view.setBigUint64(offset, BigInt(Math.floor((stat.mtime || Date.now()) * 1000000)), true)
    offset += 8
    view.setBigUint64(offset, BigInt(Math.floor((stat.ctime || Date.now()) * 1000000)), true)
  }

  const initializePreOpenedDirs = async () => {
    try {
      const fsSync = shell.context.fs
      if (fsSync.existsSync('/')) {
        const rootStat = fsSync.statSync('/')
        if (rootStat.isDirectory()) {
          // Create a dummy FileHandle for the root directory
          // Directories can't be opened as files, so we use fd: -1
          const rootHandle: FileHandle = {
            fd: -1,
            async close() {},
            async readFile() { throw new Error('Cannot read directory as file') },
            async writeFile() { throw new Error('Cannot write directory as file') },
            async truncate() { throw new Error('Cannot truncate directory') }
          } as FileHandle
          allocateFd(rootHandle, '/', true, true)
        } else {
          kernel.log.warn('Root path is not a directory')
        }
      } else {
        kernel.log.warn('Root directory does not exist')
      }
      } catch {
        // Root directory may not be accessible, continue without pre-opening
      }
  }

  const pumpStdin = async () => {
    try {
      while (true) {
        const { done, value } = await stdinReader.read()
        if (done) {
          stdinClosed = true
          break
        }
        if (value && value.length > 0) {
          stdinBuffer.push(value)
        }
      }
    } catch {
      stdinClosed = true
    }
  }

  pumpStdin().catch(() => {
    stdinClosed = true
  })

  let stdoutWriteQueue: Promise<void> = Promise.resolve()
  let stderrWriteQueue: Promise<void> = Promise.resolve()
  
  const queueWrite = (writer: WritableStreamDefaultWriter<Uint8Array>, data: Uint8Array, isStdout: boolean) => {
    const queue = isStdout ? stdoutWriteQueue : stderrWriteQueue
    const newQueue = queue.then(async () => {
      try {
        await writer.write(data)
      } catch {
        // Stream may be closed
      }
    })
    if (isStdout) {
      stdoutWriteQueue = newQueue
    } else {
      stderrWriteQueue = newQueue
    }
  }
  
  const flush = async () => {
    await stdoutWriteQueue
    await stderrWriteQueue
  }
  
  const waitForInput = async (timeoutMs: number = 10): Promise<void> => {
    const start = Date.now()
    while (stdinBuffer.length === 0 && !stdinClosed && Date.now() - start < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }
  
  const readFromStdinBuffer = (buf: number, bufLen: number, consume: boolean = true): number => {
    let totalRead = 0
    let currentOffset = stdinBufferOffset
    
    while (stdinBuffer.length > 0 && totalRead < bufLen) {
      const chunk = stdinBuffer[0]
      if (!chunk) break
      
      const remaining = bufLen - totalRead
      const toRead = Math.min(chunk.length - currentOffset, remaining)
      
      const target = new Uint8Array(activeMemory.buffer, buf + totalRead, toRead)
      target.set(chunk.slice(currentOffset, currentOffset + toRead))
      
      totalRead += toRead
      currentOffset += toRead
      
      if (currentOffset >= chunk.length) {
        if (consume && stdinBuffer.length > 0) {
          stdinBuffer.shift()
        }
        currentOffset = 0
      }
    }
    
    if (consume) {
      stdinBufferOffset = currentOffset
    }
    
    return totalRead
  }

  let pendingRead: { resolve: () => void, promise: Promise<void> } | null = null
  
  const waitForStdinData = (): Promise<void> => {
    if (pendingRead) {
      return pendingRead.promise
    }
    
    let resolve: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    
    pendingRead = { resolve: resolve!, promise }
    
    const checkForData = async () => {
      while (stdinBuffer.length === 0 && !stdinClosed) {
        await new Promise(r => setTimeout(r, 10))
      }
      if (pendingRead) {
        pendingRead.resolve()
        pendingRead = null
      }
    }
    
    checkForData()
    return promise
  }

  const ignore = (...args: unknown[]) => { void args }

  const envImports: Record<string, unknown> = {
    memory: initialMemory,
    // Common syscall functions for Emscripten-compiled programs
    __syscall_faccessat: (dirfd: number, pathPtr: number, mode: number, flags: number): number => {
      ignore(mode, flags)
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        let effectiveDirfd = dirfd
        if (pathStr.startsWith('/')) {
          effectiveDirfd = 3
        } else if (dirfd === -100) {
          effectiveDirfd = 3
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          effectiveDirfd = 3
        }
        const resolvedPath = resolvePath(effectiveDirfd, pathStr)
        const fsSync = shell.context.fs
        
        if (!fsSync.existsSync(resolvedPath)) {
          return -2
        }
        
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_fcntl64: (...args: number[]): number => {
      ignore(...args)
      // fcntl64 - file control operations
      return 0
    },
    __syscall_read: (fd: number, buf: number, count: number): number => {
      try {
        if (fd === 0) {
          const read = readFromStdinBuffer(buf, count, true)
          return read
        }

        const entry = getFileHandle(fd)
        if (!entry || entry.isDirectory) {
          return -1
        }

        // Special handling for /proc/self/stat - ensure it exists and has correct content
        if (entry.path === '/proc/self/stat') {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          const currentProcess = kernel.processes.get(currentPid) || null
          const statFields = [
            currentPid,
            '(ecmaos)',
            'R',
            currentProcess?.parent || 0,
            currentPid, currentPid, 0, currentPid, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Date.now(),
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
          ]
          const statContent = statFields.join(' ') + '\n' // Add newline at end like Linux
          const encoder = new TextEncoder()
          const contentBytes = encoder.encode(statContent)
          const currentPos = entry.position || 0
          const bytesToRead = Math.min(count, contentBytes.length - currentPos)
          
          if (bytesToRead > 0 && currentPos < contentBytes.length) {
            const target = new Uint8Array(activeMemory.buffer, buf, bytesToRead)
            target.set(contentBytes.slice(currentPos, currentPos + bytesToRead))
            if (entry.position !== undefined) {
              entry.position = currentPos + bytesToRead
            }
            return bytesToRead
          }
          return 0 // EOF
        }

        const fsSync = shell.context.fs
        const currentPos = entry.position || 0
        const buffer = Buffer.allocUnsafe(count)
        try {
          const bytesRead = fsSync.readSync(entry.handle.fd, buffer, 0, count, currentPos)

          if (bytesRead > 0) {
            const target = new Uint8Array(activeMemory.buffer, buf, bytesRead)
            target.set(buffer.slice(0, bytesRead))
            if (entry.position !== undefined) {
              entry.position = currentPos + bytesRead
            }
          }

          return bytesRead
        } catch {
          return -1
        }
      } catch {
        return -1
      }
    },

    __syscall_write: (fd: number, buf: number, count: number): number => {
      try {
        if (fd === 1 || fd === 2) {
          const data = new Uint8Array(activeMemory.buffer, buf, count)
          const isStdout = fd === 1
          const writer = isStdout ? stdoutWriter : stderrWriter
          queueWrite(writer, data, isStdout)
          return count
        }

        const entry = getFileHandle(fd)
        if (!entry || entry.isDirectory) {
          return -1
        }

        const fsSync = shell.context.fs
        const currentPos = entry.position || 0
        const data = new Uint8Array(activeMemory.buffer, buf, count)
        const bytesWritten = fsSync.writeSync(entry.handle.fd, data, 0, count, currentPos)

        if (entry.position !== undefined) {
          entry.position = currentPos + bytesWritten
        }

        return bytesWritten
      } catch {
        return -1
      }
    },

    __syscall_close: (fd: number): number => {
      if (fd < 0 || fd > 2) {
        const entry = getFileHandle(fd)
        if (!entry) {
          return -1
        }

          try {
            if (!entry.isDirectory && entry.handle.fd !== -1) {
              const fsSync = shell.context.fs
              fsSync.closeSync(entry.handle.fd)
            }
            fdMap.delete(fd)
            return 0
          } catch {
            return -1
          }
      }

      return 0
    },

    __syscall_fstat64: (fd: number, statbuf: number): number => {
      try {
        if (fd < 0 || fd > 2) {
          const entry = getFileHandle(fd)
          if (!entry) {
            return -1
          }

          const fsSync = shell.context.fs
          const stat = fsSync.statSync(entry.path)
          writeStat64({
            mode: stat.mode || 0o644,
            size: stat.size || 0,
            mtime: stat.mtime?.getTime() || Date.now(),
            ctime: stat.ctime?.getTime() || Date.now(),
            ino: stat.ino || 1,
            dev: 1,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            blksize: 4096,
            blocks: Math.ceil((stat.size || 0) / 512),
            atime: stat.atime?.getTime() || Date.now()
          }, statbuf, activeMemory)
          return 0
        }

        const fsSync = shell.context.fs
        const pathStr = fd === 0 ? '/dev/stdin' : fd === 1 ? '/dev/stdout' : '/dev/stderr'
        if (fsSync.existsSync(pathStr)) {
          const stat = fsSync.statSync(pathStr)
          writeStat64({
            mode: stat.mode || 0o644,
            size: stat.size || 0,
            mtime: stat.mtime?.getTime() || Date.now(),
            ctime: stat.ctime?.getTime() || Date.now(),
            ino: stat.ino || 1,
            dev: 1,
            nlink: 1,
            uid: 0,
            gid: 0,
            rdev: 0,
            blksize: 4096,
            blocks: 0,
            atime: stat.atime?.getTime() || Date.now()
          }, statbuf, activeMemory)
          return 0
        }

        return -1
      } catch {
        return -1
      }
    },
    __syscall_getdents64: (fd: number, dirent: number, count: number): number => {
      try {
        const entry = getFileHandle(fd)
        if (!entry || !entry.isDirectory) {
          return -1
        }

        const fsSync = shell.context.fs
        const entries = fsSync.readdirSync(entry.path)
        const view = new DataView(activeMemory.buffer)
        let offset = 0
        let ino = 1

        for (const entryName of entries) {
          if (offset + 280 > count) break

          const entryPath = path.join(entry.path, entryName as string)
          let stat
          try {
            stat = fsSync.statSync(entryPath)
          } catch {
            continue
          }

          const nameBytes = new TextEncoder().encode(entryName as string)
          const reclen = Math.max(280, 19 + nameBytes.length + 1)
          if (offset + reclen > count) break

          const d_ino = BigInt(stat.ino || ino++)
          const d_off = BigInt(offset + reclen)
          const d_reclen = reclen
          const d_type = stat.isDirectory() ? 4 : (stat.isFile() ? 8 : 0)

          view.setBigUint64(dirent + offset, d_ino, true)
          offset += 8
          view.setBigUint64(dirent + offset, d_off, true)
          offset += 8
          view.setUint16(dirent + offset, d_reclen, true)
          offset += 2
          view.setUint8(dirent + offset, d_type)
          offset += 1
          const nameOffset = dirent + offset
          const nameView = new Uint8Array(activeMemory.buffer, nameOffset, nameBytes.length + 1)
          nameView.set(nameBytes)
          nameView[nameBytes.length] = 0
          offset += nameBytes.length + 1

          const padding = reclen - (19 + nameBytes.length + 1)
          offset += padding
        }

        return offset
      } catch {
        return -1
      }
    },
    __syscall_ioctl: (fd: number, request: number, ...rest: number[]): number => {
      // ioctl - device control
      // TIOCGWINSZ (0x5413) - get window size
      // TIOCGETA (0x5401) - get terminal attributes
      // TIOCGPGRP (0x5405) - get process group ID
      // For stdout/stderr, return success to indicate it's a TTY
      if ((fd === 1 || fd === 2) && (request === 0x5413 || request === 0x5401 || request === 0x5405)) {
        return 0
      }
      ignore(...rest)
      return -1
    },
    __syscall_lstat64: (pathPtr: number, statbuf: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        const resolvedPath = pathStr.startsWith('/') ? pathStr : path.resolve('/', pathStr)
        const fsSync = shell.context.fs
        const stat = fsSync.lstatSync(resolvedPath)
        writeStat64({
          mode: stat.mode || 0o644,
          size: stat.size || 0,
          mtime: stat.mtime?.getTime() || Date.now(),
          ctime: stat.ctime?.getTime() || Date.now(),
          ino: stat.ino || 1,
          dev: 1,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          blksize: 4096,
          blocks: Math.ceil((stat.size || 0) / 512),
          atime: stat.atime?.getTime() || Date.now()
        }, statbuf, activeMemory)
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_newfstatat: (dirfd: number, pathPtr: number, statbuf: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        let effectiveDirfd = dirfd
        if (pathStr.startsWith('/')) {
          effectiveDirfd = 3
        } else if (dirfd === -100) {
          effectiveDirfd = 3
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          effectiveDirfd = 3
        }
        const resolvedPath = resolvePath(effectiveDirfd, pathStr)

        // Ensure /proc/self/stat exists before trying to stat it
        if (resolvedPath === '/proc/self/stat' || resolvedPath.startsWith('/proc/self/')) {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          if (resolvedPath === '/proc/self/stat') {
            const currentProcess = kernel.processes.get(currentPid) || null
            const statFields = [
              currentPid,
              '(ecmaos)',
              'R',
              currentProcess?.parent || 0,
              currentPid, currentPid, 0, currentPid, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Date.now(),
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            ]
            const statContent = statFields.join(' ') + '\n' // Add newline at end like Linux
            const fsSync = shell.context.fs
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
            }
          }
        }

        const fsSync = shell.context.fs
        const stat = fsSync.statSync(resolvedPath)
        writeStat64({
          mode: stat.mode || 0o644,
          size: stat.size || 0,
          mtime: stat.mtime?.getTime() || Date.now(),
          ctime: stat.ctime?.getTime() || Date.now(),
          ino: stat.ino || 1,
          dev: 1,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          blksize: 4096,
          blocks: Math.ceil((stat.size || 0) / 512),
          atime: stat.atime?.getTime() || Date.now()
        }, statbuf, activeMemory)
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_openat: (dirfd: number, pathPtr: number, flags: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        let effectiveDirfd = dirfd
        
        if (pathStr.startsWith('/')) {
          effectiveDirfd = 3
        } else if (dirfd === -100) {
          effectiveDirfd = 3
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          effectiveDirfd = 3
        }
        
        const resolvedPath = resolvePath(effectiveDirfd, pathStr)
        const fsSync = shell.context.fs

        // Handle /proc/self/stat dynamically - create it with the current process's PID
        if (resolvedPath === '/proc/self/stat' || resolvedPath.startsWith('/proc/self/')) {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          if (resolvedPath === '/proc/self/stat') {
            // Create /proc/self/stat with the current process's PID
            const currentProcess = kernel.processes.get(currentPid) || null
            const statFields = [
              currentPid,                    // 1: pid
              '(ecmaos)',                    // 2: comm (command name in parentheses)
              'R',                           // 3: state (R=running)
              currentProcess?.parent || 0,   // 4: ppid (parent process ID)
              currentPid,                    // 5: pgrp (process group ID)
              currentPid,                    // 6: session (session ID)
              0,                             // 7: tty_nr (controlling terminal)
              currentPid,                    // 8: tpgid (terminal process group)
              0,                             // 9: flags
              0, 0, 0, 0,                    // 10-13: minflt, cminflt, majflt, cmajflt
              0, 0, 0, 0,                    // 14-17: utime, stime, cutime, cstime
              0,                             // 18: priority
              0,                             // 19: nice
              1,                             // 20: num_threads
              0,                             // 21: itrealvalue
              Date.now(),                    // 22: starttime (jiffies since boot - using ms)
              0,                             // 23: vsize (virtual memory size)
              0,                             // 24: rss (resident set size)
              0,                             // 25: rsslim
              0, 0, 0, 0, 0,                 // 26-30: startcode, endcode, startstack, kstkesp, kstkeip
              0, 0, 0, 0,                    // 31-34: signal, blocked, sigignore, sigcatch
              0, 0, 0,                       // 35-37: wchan, nswap, cnswap
              0,                             // 38: exit_signal
              0,                             // 39: processor
              0,                             // 40: rt_priority
              0,                             // 41: policy
              0,                             // 42: delayacct_blkio_ticks
              0, 0,                          // 43-44: guest_time, cguest_time
              0, 0, 0, 0,                    // 45-48: start_data, end_data, start_brk, arg_start
              0, 0, 0,                       // 49-51: arg_end, env_start, env_end
              0                              // 52: exit_code
            ]
            const statContent = statFields.join(' ')
            
            try {
              // Ensure /proc/self directory exists
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              // Write the stat file with current process info
              fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
            }
          } else if (resolvedPath === '/proc/self/exe') {
            // Handle /proc/self/exe symlink
            const currentProcess = kernel.processes.get(currentPid) || null
            const exePath = currentProcess?.command || '/bin/ecmaos'
            
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              if (fsSync.existsSync('/proc/self/exe')) {
                fsSync.unlinkSync('/proc/self/exe')
              }
              fsSync.symlinkSync(exePath, '/proc/self/exe')
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/exe: ${(error as Error).message}`)
            }
          }
        }

        const O_WRONLY = 1
        const O_RDWR = 2
        const O_CREAT = 0x40
        const O_EXCL = 0x80
        const O_TRUNC = 0x200
        const O_APPEND = 0x400
        const O_DIRECTORY = 0x10000

        const accessMode = flags & 3
        let zenfsFlags = 'r'
        const create = (flags & O_CREAT) !== 0
        const directory = (flags & O_DIRECTORY) !== 0
        const excl = (flags & O_EXCL) !== 0
        const trunc = (flags & O_TRUNC) !== 0
        const append = (flags & O_APPEND) !== 0

        if (directory) {
          zenfsFlags = 'r'
        } else if (accessMode === O_RDWR) {
          if (trunc) {
            zenfsFlags = 'w+'
          } else if (append) {
            zenfsFlags = 'a+'
          } else if (create) {
            zenfsFlags = 'r+'
          } else {
            zenfsFlags = 'r+'
          }
        } else if (accessMode === O_WRONLY) {
          if (trunc || create) {
            zenfsFlags = 'w'
          } else if (append) {
            zenfsFlags = 'a'
          } else {
            zenfsFlags = 'w'
          }
        } else {
          zenfsFlags = 'r'
        }

        const exists = fsSync.existsSync(resolvedPath)

        if (directory) {
          if (!exists) {
            return -2
          }
          const stat = fsSync.statSync(resolvedPath)
          if (!stat.isDirectory()) {
            return -54
          }
        }

        if (excl && exists) {
          return -20
        }

        if (!exists && !create && !directory) {
          return -2
        }

        if (create && !exists && !directory) {
          const dir = path.dirname(resolvedPath)
          if (!fsSync.existsSync(dir)) {
            try {
              fsSync.mkdirSync(dir, { recursive: true })
            } catch (mkdirError) {
              kernel.log.debug(`Failed to create parent directory ${dir}: ${(mkdirError as Error).message}`)
              return -mapFilesystemError(mkdirError as Error)
            }
          }
          if (zenfsFlags === 'r' || zenfsFlags === 'r+') {
            zenfsFlags = 'w'
          }
        }

        // Ensure /proc/self/stat exists and is readable before opening
        if (resolvedPath === '/proc/self/stat') {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          if (!fsSync.existsSync('/proc/self/stat') || !fsSync.statSync('/proc/self/stat').isFile()) {
            // Recreate it if it doesn't exist or is invalid
            const currentProcess = kernel.processes.get(currentPid) || null
            const statFields = [
              currentPid,
              '(ecmaos)',
              'R',
              currentProcess?.parent || 0,
              currentPid, currentPid, 0, currentPid, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Date.now(),
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            ]
            const statContent = statFields.join(' ')
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444, flag: 'w' })
            } catch (error) {
              kernel.log.warn(`Failed to ensure /proc/self/stat exists: ${(error as Error).message}`)
            }
          }
        }

          try {
            const handle = fsSync.openSync(resolvedPath, zenfsFlags)
            const stat = fsSync.statSync(resolvedPath)
            const fd = allocateFd(handle as unknown as FileHandle, resolvedPath, stat.isDirectory())
            
            return fd
          } catch (openError) {
            const error = openError as Error
            kernel.log.debug(`openSync failed for ${resolvedPath} with flags ${zenfsFlags}: ${error.message}`)
            return -mapFilesystemError(error)
          }
      } catch (error) {
        kernel.log.debug(`__syscall_openat failed for path: ${(error as Error).message}`)
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_rmdir: (...args: number[]): number => {
      ignore(...args)
      // rmdir - remove directory
      return -1
    },
    __syscall_stat64: (pathPtr: number, statbuf: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        const resolvedPath = pathStr.startsWith('/') ? pathStr : path.resolve('/', pathStr)
        
        // Ensure /proc/self/stat exists before trying to stat it
        if (resolvedPath === '/proc/self/stat' || resolvedPath.startsWith('/proc/self/')) {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          if (resolvedPath === '/proc/self/stat') {
            const currentProcess = kernel.processes.get(currentPid) || null
            const statFields = [
              currentPid,
              '(ecmaos)',
              'R',
              currentProcess?.parent || 0,
              currentPid, currentPid, 0, currentPid, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Date.now(),
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            ]
            const statContent = statFields.join(' ') + '\n' // Add newline at end like Linux
            const fsSync = shell.context.fs
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
            }
          }
        }
        
        const fsSync = shell.context.fs
        const stat = fsSync.statSync(resolvedPath)
        writeStat64({
          mode: stat.mode || 0o644,
          size: stat.size || 0,
          mtime: stat.mtime?.getTime() || Date.now(),
          ctime: stat.ctime?.getTime() || Date.now(),
          ino: stat.ino || 1,
          dev: 1,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: 0,
          blksize: 4096,
          blocks: Math.ceil((stat.size || 0) / 512),
          atime: stat.atime?.getTime() || Date.now()
        }, statbuf, activeMemory)
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_unlinkat: (dirfd: number, pathPtr: number, flags: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        let effectiveDirfd = dirfd
        if (pathStr.startsWith('/')) {
          effectiveDirfd = 3
        } else if (dirfd === -100) {
          effectiveDirfd = 3
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          effectiveDirfd = 3
        }
        const resolvedPath = resolvePath(effectiveDirfd, pathStr)
        const fsSync = shell.context.fs

        if (!fsSync.existsSync(resolvedPath)) {
          return -2
        }

        const AT_REMOVEDIR = 0x200
        if ((flags & AT_REMOVEDIR) !== 0) {
          let stat
          try {
            stat = fsSync.statSync(resolvedPath)
          } catch {
            return -2
          }
          if (!stat.isDirectory()) {
            return -54
          }
          try {
            fsSync.rmdirSync(resolvedPath)
          } catch (error) {
            return -mapFilesystemError(error as Error)
          }
        } else {
          if (!fsSync.existsSync(resolvedPath)) {
            return -2
          }
          let stat
          try {
            stat = fsSync.statSync(resolvedPath)
          } catch (error) {
            const errno = mapFilesystemError(error as Error)
            return errno === 2 ? -2 : -errno
          }
          if (!fsSync.existsSync(resolvedPath)) {
            return -2
          }
          if (stat.isDirectory()) {
            return -55
          }
          if (!fsSync.existsSync(resolvedPath)) {
            return -2
          }
          try {
            fsSync.unlinkSync(resolvedPath)
          } catch (error) {
            return -mapFilesystemError(error as Error)
          }
        }
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_fchmod: (fd: number, mode: number): number => {
      try {
        if (fd < 0 || fd > 2) {
          const entry = getFileHandle(fd)
          if (!entry || entry.isDirectory) {
            return -1
          }

          const fsSync = shell.context.fs
          if (typeof fsSync.chmodSync !== 'function') {
            return 0
          }
          try {
            fsSync.chmodSync(entry.path, mode)
            return 0
          } catch (chmodError) {
            const error = chmodError as Error
            kernel.log.debug(`chmodSync error for ${entry.path}: ${error.message}, treating as success (virtual filesystem)`)
            // In a virtual filesystem, permissions are advisory at best
            // Always return success for chmod operations
            return 0
          }
        }

        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_chmod: (pathPtr: number, mode: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        const resolvedPath = pathStr.startsWith('/') ? pathStr : path.resolve('/', pathStr)
        const fsSync = shell.context.fs
        
        kernel.log.debug(`__syscall_chmod called for ${resolvedPath} with mode ${mode.toString(8)}`)
        
        if (typeof fsSync.chmodSync !== 'function') {
          kernel.log.debug(`chmodSync not available, returning success`)
          return 0
        }
        try {
          fsSync.chmodSync(resolvedPath, mode)
          kernel.log.debug(`chmodSync succeeded for ${resolvedPath}`)
          return 0
        } catch (chmodError) {
          const error = chmodError as Error
          kernel.log.debug(`chmodSync error for ${resolvedPath}: ${error.message}, treating as success (virtual filesystem)`)
          // In a virtual filesystem, permissions are advisory at best
          // Always return success for chmod operations, even if the underlying FS doesn't support it
          return 0
        }
      } catch (error) {
        kernel.log.warn(`__syscall_chmod exception: ${(error as Error).message}`)
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_mkdir: (pathPtr: number, mode: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        const resolvedPath = pathStr.startsWith('/') ? pathStr : path.resolve('/', pathStr)
        const fsSync = shell.context.fs
        if (fsSync.existsSync(resolvedPath)) {
          return -20
        }
        fsSync.mkdirSync(resolvedPath, { mode, recursive: true })
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_mkdirat: (dirfd: number, pathPtr: number, mode: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        let effectiveDirfd = dirfd
        if (pathStr.startsWith('/')) {
          effectiveDirfd = 3
        } else if (dirfd === -100) {
          effectiveDirfd = 3
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          effectiveDirfd = 3
        }
        const resolvedPath = resolvePath(effectiveDirfd, pathStr)
        const fsSync = shell.context.fs
        if (fsSync.existsSync(resolvedPath)) {
          return -20
        }
        fsSync.mkdirSync(resolvedPath, { mode, recursive: true })
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_rmdirat: (...args: number[]): number => {
      ignore(...args)
      // rmdirat - remove directory relative to directory file descriptor
      return -1
    },
    __syscall_fstatat64: (...args: number[]): number => {
      ignore(...args)
      // fstatat64 - get file status relative to directory
      return -1
    },
    __syscall_fchmodat: (dirfd: number, pathPtr: number, mode: number, flags: number): number => {
      try {
        const pathStr = readNullTerminatedString(pathPtr, activeMemory)
        let effectiveDirfd = dirfd
        if (pathStr.startsWith('/')) {
          effectiveDirfd = 3
        } else if (dirfd === -100) {
          effectiveDirfd = 3
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          effectiveDirfd = 3
        }
        const resolvedPath = resolvePath(effectiveDirfd, pathStr)
        const fsSync = shell.context.fs
        // flags can include AT_SYMLINK_NOFOLLOW (0x100) but we ignore it for now
        ignore(flags)
        
        kernel.log.debug(`__syscall_fchmodat called for ${resolvedPath} (dirfd=${dirfd}) with mode ${mode.toString(8)}`)
        
        if (typeof fsSync.chmodSync !== 'function') {
          kernel.log.debug(`chmodSync not available, returning success`)
          return 0
        }
        try {
          fsSync.chmodSync(resolvedPath, mode)
          kernel.log.debug(`chmodSync succeeded for ${resolvedPath}`)
          return 0
        } catch (chmodError) {
          const error = chmodError as Error
          kernel.log.debug(`chmodSync error for ${resolvedPath}: ${error.message}, treating as success (virtual filesystem)`)
          // In a virtual filesystem, permissions are advisory at best
          // Always return success for chmod operations, even if the underlying FS doesn't support it
          return 0
        }
      } catch (error) {
        kernel.log.warn(`__syscall_fchmodat exception: ${(error as Error).message}`)
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_fchownat: (...args: number[]): number => {
      ignore(...args)
      // fchownat - change file ownership relative to directory
      return 0
    },
    __syscall_readlink: (...args: number[]): number => {
      ignore(...args)
      // readlink - read symbolic link
      return -1
    },
    __syscall_readlinkat: (...args: number[]): number => {
      ignore(...args)
      // readlinkat - read symbolic link relative to directory file descriptor
      return -1
    },
    __syscall_symlinkat: (...args: number[]): number => {
      ignore(...args)
      // symlinkat - create symbolic link relative to directory file descriptor
      return -1
    },
    __syscall_linkat: (...args: number[]): number => {
      ignore(...args)
      // linkat - create hard link relative to directory file descriptors
      return -1
    },
    __syscall_renameat: (...args: number[]): number => {
      ignore(...args)
      // renameat - rename file relative to directory file descriptors
      return -1
    },
    __syscall_symlink: (...args: number[]): number => {
      ignore(...args)
      // symlink - create symbolic link
      return -1
    },
    __syscall_rename: (oldPathPtr: number, newPathPtr: number): number => {
      try {
        const oldPathStr = readNullTerminatedString(oldPathPtr, activeMemory)
        const newPathStr = readNullTerminatedString(newPathPtr, activeMemory)
        const oldPath = oldPathStr.startsWith('/') ? oldPathStr : path.resolve('/', oldPathStr)
        const newPath = newPathStr.startsWith('/') ? newPathStr : path.resolve('/', newPathStr)
        
        const fsSync = shell.context.fs
        if (!fsSync.existsSync(oldPath)) {
          return -2
        }
        fsSync.renameSync(oldPath, newPath)
        return 0
      } catch (error) {
        return -mapFilesystemError(error as Error)
      }
    },
    __syscall_ftruncate64: (...args: number[]): number => {
      ignore(...args)
      // ftruncate64 - truncate file to specified length
      return -1
    },
    __syscall_utimensat: (...args: number[]): number => {
      ignore(...args)
      // utimensat - change file timestamps
      return 0
    },
    __syscall_fchown32: (...args: number[]): number => {
      ignore(...args)
      // fchown32 - change file ownership
      return 0
    },
    __syscall_chown32: (...args: number[]): number => {
      ignore(...args)
      // chown32 - change file ownership
      return 0
    },
    __syscall_lchown32: (...args: number[]): number => {
      ignore(...args)
      // lchown32 - change file ownership (no follow symlinks)
      return 0
    },
    __syscall_fchown: (...args: number[]): number => {
      ignore(...args)
      // fchown - change file ownership
      return 0
    },
    __syscall_chown: (...args: number[]): number => {
      ignore(...args)
      // chown - change file ownership
      return 0
    },
    __syscall_lchown: (...args: number[]): number => {
      ignore(...args)
      // lchown - change file ownership (no follow symlinks)
      return 0
    },
    __syscall_getcwd: (buf: number, size: number): number => {
      // getcwd - get current working directory
      // Write the current directory to the buffer
      const cwd = '/'
      const encoder = new TextEncoder()
      const cwdBytes = encoder.encode(cwd)
      
      if (cwdBytes.length + 1 > size) {
        // Buffer too small
        return -1
      }
      
      const view = new Uint8Array(activeMemory.buffer, buf, cwdBytes.length + 1)
      view.set(cwdBytes)
      view[cwdBytes.length] = 0 // null terminator
      
      return cwdBytes.length + 1
    },
    __syscall_getdents: (...args: number[]): number => {
      ignore(...args)
      // getdents - get directory entries (legacy)
      return 0
    },
    __syscall_getpid: (): number => {
      // getpid - get process ID
      // Try to get the actual process ID from the kernel
      if (pid !== undefined) {
        return pid
      }
      // Fallback: get the most recent process or default to 1
      const allProcesses = Array.from(kernel.processes.all.values())
      const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
      return lastProcess?.pid || 1
    },
    __syscall_getpid64: (): number => {
      // getpid64 - get process ID (64-bit variant)
      if (pid !== undefined) {
        return pid
      }
      const allProcesses = Array.from(kernel.processes.all.values())
      const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
      return lastProcess?.pid || 1
    },
    __syscall_getuid32: (): number => {
      // getuid32 - get user ID (32-bit)
      return 0
    },
    __syscall_getgid32: (): number => {
      // getgid32 - get group ID (32-bit)
      return 0
    },
    __syscall_geteuid32: (): number => {
      // geteuid32 - get effective user ID (32-bit)
      return 0
    },
    __syscall_getegid32: (): number => {
      // getegid32 - get effective group ID (32-bit)
      return 0
    },
    // Emscripten utility functions
    emscripten_date_now: (): number => {
      // Returns current time in milliseconds since epoch
      return Date.now()
    },
    emscripten_get_now: (): number => {
      // Returns current time in milliseconds (alias for date_now)
      return Date.now()
    },
    emscripten_get_heap_max: (): number => {
      // Returns maximum heap size in bytes
      // Return the maximum memory size (65536 pages * 64KB per page)
      return 65536 * 64 * 1024
    },
    emscripten_resize_heap: (requestedSize: number): number => {
      // Resize the heap to requested size
      // In WebAssembly, memory grows automatically, so we just return success
      ignore(requestedSize)
      return 1 // Success
    },
    emscripten_console_log: (ptr: number): void => {
      // Log a string from memory
      if (ptr === 0) return
      const view = new DataView(activeMemory.buffer)
      let len = 0
      while (view.getUint8(ptr + len) !== 0 && ptr + len < activeMemory.buffer.byteLength) {
        len++
      }
      const bytes = new Uint8Array(activeMemory.buffer, ptr, len)
      const str = new TextDecoder().decode(bytes)
      kernel.log.info(str)
      const encoded = new TextEncoder().encode(str + '\n')
      queueWrite(stdoutWriter, encoded, true)
    },
    emscripten_console_warn: (ptr: number): void => {
      // Warn a string from memory
      if (ptr === 0) return
      const view = new DataView(activeMemory.buffer)
      let len = 0
      while (view.getUint8(ptr + len) !== 0 && ptr + len < activeMemory.buffer.byteLength) {
        len++
      }
      const bytes = new Uint8Array(activeMemory.buffer, ptr, len)
      const str = new TextDecoder().decode(bytes)
      kernel.log.warn(str)
    },
    emscripten_console_error: (ptr: number): void => {
      // Error a string from memory
      if (ptr === 0) return
      const view = new DataView(activeMemory.buffer)
      let len = 0
      while (view.getUint8(ptr + len) !== 0 && ptr + len < activeMemory.buffer.byteLength) {
        len++
      }
      const bytes = new Uint8Array(activeMemory.buffer, ptr, len)
      const str = new TextDecoder().decode(bytes)
      kernel.log.error(str)
    },
    // Emscripten timezone functions
    _tzset_js: (): void => {
      // Set timezone from environment
      // This is a no-op in our environment
      ignore()
    },
    _localtime_js: (time: number, tmPtr: number): void => {
      // Convert time to local time structure
      const date = new Date(time * 1000)
      const view = new DataView(activeMemory.buffer)
      // Write tm structure: sec, min, hour, mday, mon, year, wday, yday, isdst
      view.setInt32(tmPtr, date.getSeconds(), true)
      view.setInt32(tmPtr + 4, date.getMinutes(), true)
      view.setInt32(tmPtr + 8, date.getHours(), true)
      view.setInt32(tmPtr + 12, date.getDate(), true)
      view.setInt32(tmPtr + 16, date.getMonth(), true)
      view.setInt32(tmPtr + 20, date.getFullYear() - 1900, true)
      view.setInt32(tmPtr + 24, date.getDay(), true)
      view.setInt32(tmPtr + 28, Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / 86400000), true)
      view.setInt32(tmPtr + 32, 0, true) // isdst (daylight saving time)
    },
    _gmtime_js: (time: number, tmPtr: number): void => {
      // Convert time to UTC time structure
      const date = new Date(time * 1000)
      const view = new DataView(activeMemory.buffer)
      // Write tm structure: sec, min, hour, mday, mon, year, wday, yday, isdst
      view.setInt32(tmPtr, date.getUTCSeconds(), true)
      view.setInt32(tmPtr + 4, date.getUTCMinutes(), true)
      view.setInt32(tmPtr + 8, date.getUTCHours(), true)
      view.setInt32(tmPtr + 12, date.getUTCDate(), true)
      view.setInt32(tmPtr + 16, date.getUTCMonth(), true)
      view.setInt32(tmPtr + 20, date.getUTCFullYear() - 1900, true)
      view.setInt32(tmPtr + 24, date.getUTCDay(), true)
      view.setInt32(tmPtr + 28, Math.floor((date.getTime() - new Date(date.getUTCFullYear(), 0, 1).getTime()) / 86400000), true)
      view.setInt32(tmPtr + 32, 0, true) // isdst (no DST in UTC)
    },
    _mktime_js: (tmPtr: number): number => {
      // Convert local time structure to time_t
      const view = new DataView(activeMemory.buffer)
      const sec = view.getInt32(tmPtr, true)
      const min = view.getInt32(tmPtr + 4, true)
      const hour = view.getInt32(tmPtr + 8, true)
      const mday = view.getInt32(tmPtr + 12, true)
      const mon = view.getInt32(tmPtr + 16, true)
      const year = view.getInt32(tmPtr + 20, true) + 1900
      
      const date = new Date(year, mon, mday, hour, min, sec)
      return Math.floor(date.getTime() / 1000)
    },
    // Emscripten memory management functions
    _munmap_js: (_addr: number, _len: number): number => {
      ignore(_addr, _len)
      // Unmap memory pages
      // In WebAssembly, memory is managed automatically, so this is a no-op
      return 0
    },
    _mmap_js: (_addr: number, _len: number, _prot: number, _flags: number, _fd: number, _offset: number): number => {
      ignore(_addr, _len, _prot, _flags, _fd, _offset)
      // Map memory pages
      // In WebAssembly, we can't actually map memory, so return a dummy address
      // The WASM module will handle memory allocation through its own memory
      return 0
    },
    _mremap_js: (_oldAddr: number, _oldLen: number, _newLen: number, _flags: number, _newAddr: number): number => {
      ignore(_oldAddr, _oldLen, _newLen, _flags, _newAddr)
      // Remap memory pages
      // In WebAssembly, memory is managed automatically, so this is a no-op
      return 0
    },
    _msync_js: (_addr: number, _len: number, _flags: number): number => {
      ignore(_addr, _len, _flags)
      // Sync memory-mapped pages
      // In WebAssembly, memory is automatically synced, so this is a no-op
      return 0
    }
  }
  
  if (hasAsyncify) {
    envImports.asyncify_start_unwind = () => {
      // Called when WASM wants to suspend
    }
    
    envImports.asyncify_stop_unwind = () => {
      // Return promise that resolves when data is available
      if (stdinBuffer.length === 0 && !stdinClosed) {
        return waitForStdinData()
      }
      return Promise.resolve()
    }
    
    envImports.asyncify_start_rewind = () => {
      // Called when resuming
    }
    
    envImports.asyncify_stop_rewind = () => {
      // Cleanup after resume
    }
  }

  const wasiPreview1 = {
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number): number => {
      if (fd === 1 || fd === 2) {
        let currentState = 0
        if (hasAsyncify && wasmInstance) {
          const exports = wasmInstance.exports
          const getState = exports.asyncify_get_state as (() => number) | undefined
          if (getState) currentState = getState()
        }
        
        if (currentState === 2) {
          // During rewind, actually write the data (same as normal execution)
        }
        
        const view = new DataView(activeMemory.buffer)
        let totalWritten = 0
        let offset = iovs

        for (let i = 0; i < iovsLen; i++) {
          const buf = view.getUint32(offset, true)
          const bufLen = view.getUint32(offset + 4, true)
          offset += 8

          const data = new Uint8Array(activeMemory.buffer, buf, bufLen).slice()
          const isStdout = fd === 1
          const writer = isStdout ? stdoutWriter : stderrWriter
          queueWrite(writer, data, isStdout)
          totalWritten += bufLen
        }

        view.setUint32(nwritten, totalWritten, true)
        return 0
      }

      const entry = getFileHandle(fd)
      if (!entry || entry.isDirectory) {
        return 8
      }

      try {
        const fsSync = shell.context.fs
        const view = new DataView(activeMemory.buffer)
        let totalWritten = 0
        let offset = iovs
        const currentPos = entry.position || 0

        for (let i = 0; i < iovsLen; i++) {
          const buf = view.getUint32(offset, true)
          const bufLen = view.getUint32(offset + 4, true)
          offset += 8

          const data = new Uint8Array(activeMemory.buffer, buf, bufLen)
          const bytesWritten = fsSync.writeSync(entry.handle.fd, data, 0, bufLen, currentPos + totalWritten)
          totalWritten += bytesWritten
        }

        if (entry.position !== undefined) {
          entry.position = currentPos + totalWritten
        }

        view.setUint32(nwritten, totalWritten, true)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_read: (fd: number, iovs: number, iovsLen: number, nread: number): number => {
      if (fd === 0) {
        let currentState = 0
        if (hasAsyncify && wasmInstance) {
          const exports = wasmInstance.exports
          const getState = exports.asyncify_get_state as (() => number) | undefined
          if (getState) currentState = getState()
        }
        
        if (currentState === 2) {
          const view = new DataView(activeMemory.buffer)
          let totalRead = 0
          let offset = iovs

          for (let i = 0; i < iovsLen && stdinBuffer.length > 0; i++) {
            const buf = view.getUint32(offset, true)
            const bufLen = view.getUint32(offset + 4, true)
            offset += 8

            const read = readFromStdinBuffer(buf, bufLen, true)
            totalRead += read
            if (read < bufLen) break
          }

          view.setUint32(nread, totalRead, true)
          return 0
        }
        
        if (stdinBuffer.length === 0) {
          if (stdinClosed) {
            const view = new DataView(activeMemory.buffer)
            view.setUint32(nread, 0, true)
            return 0
          }
          
          if (hasAsyncify && wasmInstance && currentState === 0 && !asyncifyPending && asyncifyDataAddr !== 0) {
            const exports = wasmInstance.exports
            const startUnwind = exports.asyncify_start_unwind as ((addr: number) => void) | undefined
            
            if (startUnwind) {
              const view = new DataView(activeMemory.buffer)
              view.setUint32(nread, 0, true)
              asyncifyPending = true
              startUnwind(asyncifyDataAddr)
              return 0
            }
          }
          
          return 6
        }
        
        const view = new DataView(activeMemory.buffer)
        let totalRead = 0
        let offset = iovs

        for (let i = 0; i < iovsLen; i++) {
          const buf = view.getUint32(offset, true)
          const bufLen = view.getUint32(offset + 4, true)
          offset += 8

          const read = readFromStdinBuffer(buf, bufLen)
          totalRead += read
          if (read < bufLen) break
        }

        view.setUint32(nread, totalRead, true)
        return 0
      }

      const entry = getFileHandle(fd)
      if (!entry || entry.isDirectory) {
        return 8
      }
      
      // Special handling for /proc/self/stat - return content directly from memory
      if (entry.path === '/proc/self/stat') {
        const currentPid = pid !== undefined ? pid : (() => {
          const allProcesses = Array.from(kernel.processes.all.values())
          const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
          return lastProcess?.pid || 1
        })()
        
        const currentProcess = kernel.processes.get(currentPid) || null
        const statFields = [
          currentPid,
          '(ecmaos)',
          'R',
          currentProcess?.parent || 0,
          currentPid, currentPid, 0, currentPid, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Math.floor(Date.now() / 1000), // starttime in seconds (approximation)
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ]
        const statContent = statFields.join(' ') + '\n' // Add newline at end like Linux
        const encoder = new TextEncoder()
        const contentBytes = encoder.encode(statContent)
        const currentPos = entry.position || 0
        
        const view = new DataView(activeMemory.buffer)
        let totalRead = 0
        let offset = iovs
        
        for (let i = 0; i < iovsLen && (currentPos + totalRead) < contentBytes.length; i++) {
          const buf = view.getUint32(offset, true)
          const bufLen = view.getUint32(offset + 4, true)
          offset += 8
          
          const remaining = contentBytes.length - (currentPos + totalRead)
          const bytesToRead = Math.min(bufLen, remaining)
          
          if (bytesToRead > 0) {
            const target = new Uint8Array(activeMemory.buffer, buf, bytesToRead)
            target.set(contentBytes.slice(currentPos + totalRead, currentPos + totalRead + bytesToRead))
            totalRead += bytesToRead
          }
          
          if (bytesToRead < bufLen || (currentPos + totalRead) >= contentBytes.length) {
            break
          }
        }
        
        if (entry.position !== undefined) {
          entry.position = currentPos + totalRead
        }
        
        view.setUint32(nread, totalRead, true)
        return 0
      }

      try {
        const fsSync = shell.context.fs
        const view = new DataView(activeMemory.buffer)
        let totalRead = 0
        let offset = iovs
        const currentPos = entry.position || 0

        for (let i = 0; i < iovsLen; i++) {
          const buf = view.getUint32(offset, true)
          const bufLen = view.getUint32(offset + 4, true)
          offset += 8

          const buffer = Buffer.allocUnsafe(bufLen)
          const bytesRead = fsSync.readSync(entry.handle.fd, buffer, 0, bufLen, currentPos + totalRead)
          
          if (bytesRead === 0) break

          const target = new Uint8Array(activeMemory.buffer, buf, bytesRead)
          target.set(buffer.slice(0, bytesRead))
          totalRead += bytesRead

          if (bytesRead < bufLen) break
        }

        if (entry.position !== undefined) {
          entry.position = currentPos + totalRead
        }

        view.setUint32(nread, totalRead, true)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_seek: (fd: number, offset: bigint, whence: number, newOffset: number): number => {
      if (fd < 0 || fd > 2) {
        const entry = getFileHandle(fd)
        if (!entry || entry.isDirectory) {
          return 8
        }

        try {
          const fsSync = shell.context.fs
          const stat = fsSync.statSync(entry.path)
          const fileSize = stat.size
          let newPos = 0

          const SEEK_SET = 0
          const SEEK_CUR = 1
          const SEEK_END = 2

          const offsetNum = Number(offset)
          const currentPos = entry.position || 0

          if (whence === SEEK_SET) {
            newPos = offsetNum
          } else if (whence === SEEK_CUR) {
            newPos = currentPos + offsetNum
          } else if (whence === SEEK_END) {
            newPos = fileSize + offsetNum
          } else {
            return 28
          }

          if (newPos < 0) {
            newPos = 0
          }

          entry.position = newPos

          const view = new DataView(activeMemory.buffer)
          view.setBigUint64(newOffset, BigInt(newPos), true)
          return 0
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
      }

      return 70
    },

    fd_close: (fd: number): number => {
      if (fd < 0 || fd > 2) {
        const entry = getFileHandle(fd)
        if (!entry) {
          return 8
        }

        try {
          if (!entry.isDirectory && entry.handle.fd !== -1) {
            const fsSync = shell.context.fs
            fsSync.closeSync(entry.handle.fd)
          }
          fdMap.delete(fd)
          return 0
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
      }

      return 0
    },

    fd_readdir: (fd: number, buf: number, bufLen: number, cookie: bigint, bufused: number): number => {
      const entry = getFileHandle(fd)
      if (!entry || !entry.isDirectory) {
        return 8
      }

      try {
        const fsSync = shell.context.fs
        if (!fsSync.existsSync(entry.path)) {
          return 2
        }
        const stat = fsSync.statSync(entry.path)
        if (!stat.isDirectory()) {
          return 54
        }
        const entries = fsSync.readdirSync(entry.path)
        const cookieNum = Number(cookie)
        
        if (cookieNum >= entries.length) {
          const view = new DataView(activeMemory.buffer)
          view.setUint32(bufused, 0, true)
          return 0
        }

        let offset = 0
        const view = new DataView(activeMemory.buffer)
        const encoder = new TextEncoder()

        for (let i = cookieNum; i < entries.length && offset < bufLen; i++) {
          const entryName = entries[i] as string
          const entryPath = path.join(entry.path, entryName)
          
          let stat
          try {
            stat = fsSync.statSync(entryPath)
          } catch {
            continue
          }

          const nameBytes = encoder.encode(entryName)
          const direntSize = 24 + nameBytes.length + 1

          if (offset + direntSize > bufLen) {
            break
          }

          const dNext = BigInt(i + 1)
          const dIno = BigInt(stat.ino || i + 1)
          const dNamlen = nameBytes.length
          const dType = stat.isDirectory() ? 3 : (stat.isFile() ? 4 : 0)

          view.setBigUint64(buf + offset, dNext, true)
          view.setBigUint64(buf + offset + 8, dIno, true)
          view.setUint32(buf + offset + 16, dNamlen, true)
          view.setUint8(buf + offset + 20, dType)
          offset += 24

          const nameView = new Uint8Array(activeMemory.buffer, buf + offset, nameBytes.length + 1)
          nameView.set(nameBytes)
          nameView[nameBytes.length] = 0
          offset += nameBytes.length + 1
        }

        view.setUint32(bufused, offset, true)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_sync: (_fd: number): number => {
      ignore(_fd)
      flush().catch(() => {})
      return 0
    },

    fd_fdstat_get: (fd: number, buf: number): number => {
      const view = new DataView(activeMemory.buffer)

      if (fd === 0) {
        view.setUint8(buf, 2)
        view.setUint8(buf + 1, 0)
        view.setUint16(buf + 2, 0, true)
        view.setBigUint64(buf + 8, 0x1n, true)
        view.setBigUint64(buf + 16, 0n, true)
        return 0
      }

      if (fd === 1 || fd === 2) {
        view.setUint8(buf, 2)
        view.setUint8(buf + 1, 0)
        view.setUint16(buf + 2, 0, true)
        view.setBigUint64(buf + 8, 0x2n, true)
        view.setBigUint64(buf + 16, 0n, true)
        return 0
      }

      const entry = getFileHandle(fd)
      if (!entry) {
        return 8
      }

      try {
        const fsSync = shell.context.fs
        let fileType = 0
        let rightsBase = 0n
        let rightsInheriting = 0n

        if (entry.isDirectory) {
          fileType = 3
          rightsBase = 0x1n | 0x2n | 0x40n
          rightsInheriting = 0x1n | 0x2n | 0x40n
        } else {
          fileType = 4
          const stat = fsSync.statSync(entry.path)
          rightsBase = 0x1n
          if (stat.mode & 0o222) {
            rightsBase |= 0x2n
          }
          rightsInheriting = 0n
        }

        view.setUint8(buf, fileType)
        view.setUint8(buf + 1, 0)
        view.setUint16(buf + 2, 0, true)
        view.setBigUint64(buf + 8, rightsBase, true)
        view.setBigUint64(buf + 16, rightsInheriting, true)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_fdstat_set_flags: (_fd: number, _flags: number): number => {
      ignore(_fd, _flags)
      return 0
    },

    fd_filestat_get: (fd: number, buf: number): number => {
      try {
        if (fd === 0 || fd === 1 || fd === 2) {
          const stat = {
            dev: 1,
            ino: 1,
            nlink: 1,
            size: 0,
            atime: Date.now(),
            mtime: Date.now(),
            ctime: Date.now(),
            isDirectory: false,
            isFile: true
          }
          writeFilestat(stat, buf, activeMemory)
          return 0
        }

        const entry = getFileHandle(fd)
        if (!entry) {
          return 8
        }

        const fsSync = shell.context.fs
        const stat = fsSync.statSync(entry.path)
        writeFilestat({
          dev: 1,
          ino: stat.ino || 1,
          nlink: 1,
          size: stat.size || 0,
          atime: stat.atime?.getTime() || Date.now(),
          mtime: stat.mtime?.getTime() || Date.now(),
          ctime: stat.ctime?.getTime() || Date.now(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile()
        }, buf, activeMemory)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_filestat_set_size: (fd: number, size: bigint): number => {
      if (fd < 0 || fd > 2) {
        const entry = getFileHandle(fd)
        if (!entry || entry.isDirectory) {
          return 8
        }

        try {
          const fsSync = shell.context.fs
          const sizeNum = Number(size)
          
          // Get current file size
          const stat = fsSync.statSync(entry.path)
          const currentSize = stat.size || 0
          
          if (sizeNum === currentSize) {
            // No change needed
            return 0
          }
          
          if (sizeNum < currentSize) {
            // Truncate: read the file, write back only the first sizeNum bytes
            const buffer = fsSync.readFileSync(entry.path)
            const truncated = buffer.slice(0, sizeNum)
            fsSync.writeFileSync(entry.path, truncated)
          } else {
            // Extend: append zeros to reach the desired size
            const buffer = fsSync.readFileSync(entry.path)
            const extension = Buffer.alloc(sizeNum - currentSize, 0)
            fsSync.writeFileSync(entry.path, Buffer.concat([buffer, extension]))
          }
          
          // Update position if it's beyond the new size
          if (entry.position !== undefined && entry.position > sizeNum) {
            entry.position = sizeNum
          }
          
          return 0
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
      }

      // Cannot truncate stdin/stdout/stderr
      return 70
    },

    path_filestat_get: (dirfd: number, _flags: number, pathPtr: number, pathLen: number, buf: number): number => {
      try {
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const resolvedPath = resolvePath(dirfd, pathStr)
        
        // Ensure /proc/self/stat exists before trying to stat it
        if (resolvedPath === '/proc/self/stat' || resolvedPath.startsWith('/proc/self/')) {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          if (resolvedPath === '/proc/self/stat') {
            const currentProcess = kernel.processes.get(currentPid) || null
            const statFields = [
              currentPid,
              '(ecmaos)',
              'R',
              currentProcess?.parent || 0,
              currentPid, currentPid, 0, currentPid, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Date.now(),
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            ]
            const statContent = statFields.join(' ') + '\n' // Add newline at end like Linux
            const fsSync = shell.context.fs
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
            }
          }
        }

        const fsSync = shell.context.fs
        const stat = fsSync.statSync(resolvedPath)
        writeFilestat({
          dev: 1,
          ino: stat.ino || 1,
          nlink: 1,
          size: stat.size || 0,
          atime: stat.atime?.getTime() || Date.now(),
          mtime: stat.mtime?.getTime() || Date.now(),
          ctime: stat.ctime?.getTime() || Date.now(),
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile()
        }, buf, activeMemory)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    path_filestat_set_times: (dirfd: number, flags: number, pathPtr: number, pathLen: number, atim: bigint, mtim: bigint, fstFlags: number): number => {
      ignore(dirfd, flags, pathPtr, pathLen, atim, mtim, fstFlags)
      return 0
    },

    path_filestat_set_permissions: (dirfd: number, pathPtr: number, pathLen: number, mode: number): number => {
      try {
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const resolvedPath = resolvePath(dirfd, pathStr)
        const fsSync = shell.context.fs
        if (typeof fsSync.chmodSync !== 'function') {
          return 0
        }
        try {
          fsSync.chmodSync(resolvedPath, mode)
          return 0
        } catch (chmodError) {
          const error = chmodError as Error
          const errorMsg = error.message.toLowerCase()
          const errorCode = (error as { code?: string }).code?.toLowerCase() || ''
          
          if (errorMsg.includes('not supported') || 
              errorMsg.includes('not implemented') ||
              errorMsg.includes('operation not supported') ||
              errorCode === 'enosys' ||
              errorCode === 'enotsup') {
            return 0
          }
          
          kernel.log.warn(`chmodSync failed for ${resolvedPath}: ${error.message}`)
          return mapFilesystemError(error)
        }
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_filestat_set_permissions: (fd: number, mode: number): number => {
      try {
        if (fd < 0 || fd > 2) {
          const entry = getFileHandle(fd)
          if (!entry || entry.isDirectory) {
            return 8
          }

          const fsSync = shell.context.fs
          if (typeof fsSync.chmodSync !== 'function') {
            return 0
          }
          try {
            fsSync.chmodSync(entry.path, mode)
            return 0
          } catch (chmodError) {
            const error = chmodError as Error
            const errorMsg = error.message.toLowerCase()
            const errorCode = (error as { code?: string }).code?.toLowerCase() || ''
            
            if (errorMsg.includes('not supported') || 
                errorMsg.includes('not implemented') ||
                errorMsg.includes('operation not supported') ||
                errorCode === 'enosys' ||
                errorCode === 'enotsup') {
              return 0
            }
            
            kernel.log.warn(`chmodSync failed for ${entry.path}: ${error.message}`)
            return mapFilesystemError(error)
          }
        }

        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_advise: (_fd: number, _offset: bigint, _len: bigint, _advice: number): number => {
      ignore(_fd, _offset, _len, _advice)
      return 0
    },

    fd_allocate: (_fd: number, _offset: bigint, _len: bigint): number => {
      ignore(_fd, _offset, _len)
      return 0
    },

    fd_datasync: (_fd: number): number => {
      ignore(_fd)
      flush().catch(() => {})
      return 0
    },

    fd_pread: (fd: number, iovs: number, iovsLen: number, offset: bigint, nread: number): number => {
      const entry = getFileHandle(fd)
      if (!entry || entry.isDirectory) {
        return 8
      }

      try {
        const fsSync = shell.context.fs
        const view = new DataView(activeMemory.buffer)
        let totalRead = 0
        let iovOffset = iovs
        const readOffset = Number(offset)

        for (let i = 0; i < iovsLen; i++) {
          const buf = view.getUint32(iovOffset, true)
          const bufLen = view.getUint32(iovOffset + 4, true)
          iovOffset += 8

          const buffer = Buffer.allocUnsafe(bufLen)
          const bytesRead = fsSync.readSync(entry.handle.fd, buffer, 0, bufLen, readOffset + totalRead)
          
          if (bytesRead === 0) break

          const target = new Uint8Array(activeMemory.buffer, buf, bytesRead)
          target.set(buffer.slice(0, bytesRead))
          totalRead += bytesRead

          if (bytesRead < bufLen) break
        }

        view.setUint32(nread, totalRead, true)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_pwrite: (fd: number, iovs: number, iovsLen: number, offset: bigint, nwritten: number): number => {
      const entry = getFileHandle(fd)
      if (!entry || entry.isDirectory) {
        return 8
      }

      try {
        const fsSync = shell.context.fs
        const view = new DataView(activeMemory.buffer)
        let totalWritten = 0
        let iovOffset = iovs
        const writeOffset = Number(offset)

        for (let i = 0; i < iovsLen; i++) {
          const buf = view.getUint32(iovOffset, true)
          const bufLen = view.getUint32(iovOffset + 4, true)
          iovOffset += 8

          const data = new Uint8Array(activeMemory.buffer, buf, bufLen)
          const bytesWritten = fsSync.writeSync(entry.handle.fd, data, 0, bufLen, writeOffset + totalWritten)
          totalWritten += bytesWritten
        }

        view.setUint32(nwritten, totalWritten, true)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    fd_renumber: (from: number, to: number): number => {
      if (from < 0 || from > 2 || to < 0 || to > 2) {
        const fromEntry = getFileHandle(from)
        if (!fromEntry) {
          return 8
        }
        
        if (to < 0 || to > 2) {
          const toEntry = getFileHandle(to)
          if (toEntry) {
            try {
              const fsSync = shell.context.fs
              fsSync.closeSync(toEntry.handle.fd)
            } catch {
              // Ignore close errors
            }
          }
          
          fdMap.set(to, fromEntry)
          fdMap.delete(from)
        }
        return 0
      }
      return 8
    },

    fd_tell: (fd: number, offset: number): number => {
      if (fd < 0 || fd > 2) {
        const entry = getFileHandle(fd)
        if (!entry) {
          return 8
        }

        const view = new DataView(activeMemory.buffer)
        view.setBigUint64(offset, BigInt(entry.position || 0), true)
        return 0
      }

      const view = new DataView(activeMemory.buffer)
      view.setBigUint64(offset, 0n, true)
      return 0
    },

    poll_oneoff: (_in: number, _out: number, _nsubscriptions: number, _nevents: number): number => {
      ignore(_in, _out, _nsubscriptions, _nevents)
      return 52
    },

    fd_prestat_get: (fd: number, buf: number): number => {
      const entry = fdMap.get(fd)
      if (!entry || !entry.preOpened || !entry.isDirectory) {
        return 8
      }

      const view = new DataView(activeMemory.buffer)
      view.setUint8(buf, 0)
      const nameLen = entry.path.length
      view.setUint32(buf + 4, nameLen, true)
      return 0
    },

    fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number): number => {
      const entry = fdMap.get(fd)
      if (!entry || !entry.preOpened || !entry.isDirectory) {
        return 8
      }

      const pathBytes = new TextEncoder().encode(entry.path)
      if (pathBytes.length > pathLen) {
        return 52
      }

      const view = new Uint8Array(activeMemory.buffer, pathPtr, pathBytes.length)
      view.set(pathBytes)
      return 0
    },

    environ_sizes_get: (environCount: number, environBufSize: number): number => {
      const view = new DataView(activeMemory.buffer)
      view.setUint32(environCount, envEntries.length, true)
      view.setUint32(environBufSize, totalEnvironBufSize, true)
      return 0
    },

    environ_get: (environ: number, environBuf: number): number => {
      try {
        const view = new DataView(activeMemory.buffer)
        let bufOffset = environBuf
        
        // Write each environment variable string to the buffer
        for (const encodedEnv of encodedEnvVars) {
          // Write pointer to the string in the environ array
          view.setUint32(environ, bufOffset, true)
          environ += 4
          
          // Write the "KEY=VALUE\0" string to the buffer
          const target = new Uint8Array(activeMemory.buffer, bufOffset, encodedEnv.length + 1)
          target.set(encodedEnv)
          target[encodedEnv.length] = 0 // null terminator
          bufOffset += encodedEnv.length + 1
        }
        
        // Write null pointer to terminate the environ array
        view.setUint32(environ, 0, true)
        
        return 0
      } catch (error) {
        kernel.log.warn(`Failed to write environment variables: ${(error as Error).message}`)
        return 8 // EBADF or similar error
      }
    },

    args_sizes_get: (argCount: number, argBufSize: number): number => {
      const view = new DataView(activeMemory.buffer)
      view.setUint32(argCount, args.length, true)
      view.setUint32(argBufSize, argsBufferSize, true)
      return 0
    },

    args_get: (argv: number, argvBuf: number): number => {
      const view = new DataView(activeMemory.buffer)
      let argvOffset = argv
      let bufOffset = argvBuf

      for (const argBytes of encodedArgs) {
        view.setUint32(argvOffset, bufOffset, true)
        argvOffset += 4

        const target = new Uint8Array(activeMemory.buffer, bufOffset, argBytes.length)
        target.set(argBytes)
        bufOffset += argBytes.length

        const terminator = new Uint8Array(activeMemory.buffer, bufOffset, 1)
        terminator[0] = 0
        bufOffset += 1
      }

      return 0
    },

    proc_exit: (code: number): never => {
      flush().catch(() => {
        // Ignore flush errors
      })
      throw new Error(`WASI proc_exit(${code})`)
    },

    path_open: (dirfd: number, _dirflags: number, pathPtr: number, pathLen: number, oflags: number, fsRightsBase: bigint, _fsRightsInheriting: bigint, _fdFlags: number, openedFd: number): number => {
      try {
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const isAbsolute = pathStr.startsWith('/')
        
        if (!isAbsolute) {
          if (dirfd !== 3 && dirfd > 3) {
            const entry = fdMap.get(dirfd)
            if (!entry || !entry.preOpened || !entry.isDirectory) {
              return 8
            }
          } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
            return 8
          }
        } else {
          if (dirfd !== 3 && dirfd > 3) {
            const entry = fdMap.get(dirfd)
            if (entry && (!entry.preOpened || !entry.isDirectory)) {
              return 8
            }
          }
        }
        
        const resolvedPath = resolvePath(dirfd, pathStr)
        
        // Ensure /proc/self/stat exists before trying to open it
        if (resolvedPath === '/proc/self/stat' || resolvedPath.startsWith('/proc/self/')) {
          const currentPid = pid !== undefined ? pid : (() => {
            const allProcesses = Array.from(kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          if (resolvedPath === '/proc/self/stat') {
            const currentProcess = kernel.processes.get(currentPid) || null
            const statFields = [
              currentPid,
              '(ecmaos)',
              'R',
              currentProcess?.parent || 0,
              currentPid, currentPid, 0, currentPid, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, Date.now(),
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
            ]
            const statContent = statFields.join(' ') + '\n' // Add newline at end like Linux
            const fsSync = shell.context.fs
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
            }
          } else if (resolvedPath === '/proc/self/exe') {
            const currentProcess = kernel.processes.get(currentPid) || null
            const exePath = currentProcess?.command || '/bin/ecmaos'
            const fsSync = shell.context.fs
            try {
              if (!fsSync.existsSync('/proc/self')) {
                fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
              }
              if (fsSync.existsSync('/proc/self/exe')) {
                fsSync.unlinkSync('/proc/self/exe')
              }
              fsSync.symlinkSync(exePath, '/proc/self/exe')
            } catch (error) {
              kernel.log.warn(`Failed to create /proc/self/exe: ${(error as Error).message}`)
            }
          }
        }

        const O_CREAT = 0x0001
        const O_DIRECTORY = 0x0002
        const O_EXCL = 0x0004
        const O_TRUNC = 0x0008
        const O_APPEND = 0x0010

        let zenfsFlags = 'r'
        const create = (oflags & O_CREAT) !== 0
        const directory = (oflags & O_DIRECTORY) !== 0
        const excl = (oflags & O_EXCL) !== 0
        const trunc = (oflags & O_TRUNC) !== 0
        const append = (oflags & O_APPEND) !== 0

        const hasRead = (fsRightsBase & 0x1n) !== 0n
        const hasWrite = (fsRightsBase & 0x2n) !== 0n

        if (directory) {
          zenfsFlags = 'r'
        } else if (hasWrite && hasRead) {
          if (trunc) {
            zenfsFlags = 'w+'
          } else if (append) {
            zenfsFlags = 'a+'
          } else if (create) {
            zenfsFlags = 'r+'
          } else {
            zenfsFlags = 'r+'
          }
        } else if (hasWrite) {
          if (trunc || create) {
            zenfsFlags = 'w'
          } else if (append) {
            zenfsFlags = 'a'
          } else {
            zenfsFlags = 'w'
          }
        } else {
          zenfsFlags = 'r'
        }

        try {
          const fsSync = shell.context.fs
          const exists = fsSync.existsSync(resolvedPath)
          
          if (directory) {
            if (!exists) {
              return 2
            }
            const stat = fsSync.statSync(resolvedPath)
            if (!stat.isDirectory()) {
              return 54
            }
            // For directories, we don't use openSync - return a directory handle
            const dirHandle = { fd: -1 } as unknown as FileHandle
            const newFd = allocateFd(dirHandle, resolvedPath, true)
            const view = new DataView(activeMemory.buffer)
            view.setUint32(openedFd, newFd, true)
            return 0
          }

          if (excl && exists) {
            return 20
          }

          if (!exists && !create) {
            return 2
          }

          if (!exists && create) {
            if (zenfsFlags === 'r' || zenfsFlags === 'r+') {
              zenfsFlags = 'w'
            } else if (zenfsFlags.startsWith('a')) {
              zenfsFlags = 'w'
            }
            // Create parent directory if it doesn't exist
            const dir = path.dirname(resolvedPath)
            if (!fsSync.existsSync(dir)) {
              fsSync.mkdirSync(dir, { recursive: true })
            }
          }

          if (exists && !hasRead && hasWrite) {
            if (zenfsFlags === 'w' || zenfsFlags === 'a') {
              zenfsFlags = 'r+'
            }
          }

          // Check if parent directory exists when opening in write mode
          // For existing files, just verify the parent exists
          if (!directory && (hasWrite || create) && exists) {
            const dir = path.dirname(resolvedPath)
            const dirExists = fsSync.existsSync(dir)
            if (!dirExists) {
              return 2
            }
            const dirStat = fsSync.statSync(dir)
            if (!dirStat.isDirectory()) {
              return 54
            }
          }

          try {
            const handleFd = fsSync.openSync(resolvedPath, zenfsFlags)
            const stat = fsSync.statSync(resolvedPath)
            // Wrap the numeric fd in a FileHandle-like object
            const handle = { fd: handleFd } as unknown as FileHandle
            const fd = allocateFd(handle, resolvedPath, stat.isDirectory())

            const view = new DataView(activeMemory.buffer)
            view.setUint32(openedFd, fd, true)
            return 0
          } catch (openError) {
            const error = openError as Error
            kernel.log.debug(`path_open openSync failed for ${resolvedPath} with flags ${zenfsFlags}: ${error.message}`)
            return mapFilesystemError(error)
          }
        } catch (err) {
          kernel.log.debug(`path_open failed: ${(err as Error).message}`)
          return mapFilesystemError(err as Error)
        }
      } catch (err) {
        kernel.log.debug(`path_open outer catch: ${(err as Error).message}`)
        return mapFilesystemError(err as Error)
      }
    },

    path_create_directory: (dirfd: number, pathPtr: number, pathLen: number): number => {
      try {
        if (dirfd !== 3 && dirfd > 3) {
          const entry = fdMap.get(dirfd)
          if (!entry || !entry.preOpened || !entry.isDirectory) {
            return 8
          }
        } else if (dirfd < 0 || (dirfd > 0 && dirfd < 3)) {
          return 8
        }
        
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const resolvedPath = resolvePath(dirfd, pathStr)

        const fsSync = shell.context.fs
        fsSync.mkdirSync(resolvedPath, { recursive: false })
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    path_readlink: (dirfd: number, pathPtr: number, pathLen: number, buf: number, bufLen: number, bufused: number): number => {
      try {
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const resolvedPath = resolvePath(dirfd, pathStr)

        const fsSync = shell.context.fs
        const linkTarget = fsSync.readlinkSync(resolvedPath)
        const linkTargetStr = typeof linkTarget === 'string' ? linkTarget : linkTarget.toString()
        const linkBytes = new TextEncoder().encode(linkTargetStr)

        if (linkBytes.length > bufLen) {
          return 52
        }

        const view = new Uint8Array(activeMemory.buffer, buf, linkBytes.length)
        view.set(linkBytes)

        const usedView = new DataView(activeMemory.buffer)
        usedView.setUint32(bufused, linkBytes.length, true)
        return 0
      } catch (err) {
        return mapFilesystemError(err as Error)
      }
    },

    path_symlink: (oldPathPtr: number, oldPathLen: number, dirfd: number, newPathPtr: number, newPathLen: number): number => {
      try {
        const oldPath = readStringFromMemory(oldPathPtr, oldPathLen, activeMemory)
        const newPathStr = readStringFromMemory(newPathPtr, newPathLen, activeMemory)
        const newPath = resolvePath(dirfd, newPathStr)

        const fsSync = shell.context.fs
        fsSync.symlinkSync(oldPath, newPath)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    path_unlink_file: (dirfd: number, pathPtr: number, pathLen: number): number => {
      try {
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const resolvedPath = resolvePath(dirfd, pathStr)

        const fsSync = shell.context.fs
        
        if (!fsSync.existsSync(resolvedPath)) {
          return 2
        }
        
        let stat
        try {
          stat = fsSync.statSync(resolvedPath)
        } catch (error) {
          const errno = mapFilesystemError(error as Error)
          if (errno === 2 || !fsSync.existsSync(resolvedPath)) {
            return 2
          }
          return errno
        }
        
        if (!fsSync.existsSync(resolvedPath)) {
          return 2
        }
        
        if (stat.isDirectory()) {
          return 54
        }
        
        if (!stat.isFile()) {
          return 2
        }
        
        if (!fsSync.existsSync(resolvedPath)) {
          return 2
        }
        
        try {
          fsSync.unlinkSync(resolvedPath)
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
        
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    path_remove_directory: (dirfd: number, pathPtr: number, pathLen: number): number => {
      try {
        const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
        const resolvedPath = resolvePath(dirfd, pathStr)

        const fsSync = shell.context.fs
        if (!fsSync.existsSync(resolvedPath)) {
          return 2
        }
        const stat = fsSync.statSync(resolvedPath)
        if (!stat.isDirectory()) {
          return 54
        }
        fsSync.rmdirSync(resolvedPath)
        return 0
      } catch (err) {
        return mapFilesystemError(err as Error)
      }
    },

    path_rename: (oldDirfd: number, oldPathPtr: number, oldPathLen: number, newDirfd: number, newPathPtr: number, newPathLen: number): number => {
      try {
        const oldPathStr = readStringFromMemory(oldPathPtr, oldPathLen, activeMemory)
        const newPathStr = readStringFromMemory(newPathPtr, newPathLen, activeMemory)
        const oldPath = resolvePath(oldDirfd, oldPathStr)
        const newPath = resolvePath(newDirfd, newPathStr)

        const fsSync = shell.context.fs
        fsSync.renameSync(oldPath, newPath)
        return 0
      } catch (error) {
        return mapFilesystemError(error as Error)
      }
    },

    clock_time_get: (_clockId: number, _precision: bigint, time: number): number => {
      ignore(_clockId, _precision)
      const view = new DataView(activeMemory.buffer)
      const now = BigInt(Date.now()) * 1000000n
      view.setBigUint64(time, now, true)
      return 0
    },

    clock_res_get: (_clockId: number, resolution: number): number => {
      ignore(_clockId)
      const view = new DataView(activeMemory.buffer)
      const res = 1n
      view.setBigUint64(resolution, res, true)
      return 0
    },

    random_get: (buf: number, bufLen: number): number => {
      const view = new Uint8Array(activeMemory.buffer, buf, bufLen)
      crypto.getRandomValues(view)
      return 0
    }
  }

  const imports: WebAssembly.Imports = {
    memory: initialMemory as unknown as WebAssembly.ModuleImports,
    wasi_snapshot_preview1: wasiPreview1,
    env: envImports
  } as WebAssembly.Imports

  return {
    imports,
    setMemory: (memory: WebAssembly.Memory) => { activeMemory = memory },
    setInstance: (inst: WebAssembly.Instance) => { wasmInstance = inst },
    flush,
    waitForInput,
    getAsyncifyState: () => ({ pending: asyncifyPending, dataAddr: asyncifyDataAddr }),
    resetAsyncifyPending: () => { asyncifyPending = false },
    setAsyncifyDataAddr: (addr: number) => { asyncifyDataAddr = addr },
    waitForStdinData,
    initializePreOpenedDirs
  }
}