import { WASIShim } from '@bytecodealliance/preview2-shim/instantiation'
import type { Kernel, WasmOptions, Wasm as IWasm, FileHandle, Shell } from '@ecmaos/types'
import path from 'path'

export interface WasiStreamOptions {
  stdin: ReadableStream<Uint8Array>
  stdout: WritableStream<Uint8Array>
  stderr: WritableStream<Uint8Array>
}

export interface WasiComponentResult {
  instance: WebAssembly.Instance
  exitCode: Promise<number>
}

export class Wasm implements IWasm {
  private _kernel: Kernel
  private _modules: Map<string, { module: WebAssembly.Module; instance: WebAssembly.Instance }> = new Map()

  get modules() { return this._modules }

  constructor(options: WasmOptions) {
    this._kernel = options.kernel
  }

  /**
   * Load an emscripten JS file compiled using -sSINGLE_FILE
   */
  async loadEmscripten(path: string) {
    const contents = await this._kernel.filesystem.fs.readFile(path, 'utf-8')
    const script = document.createElement('script')
    script.textContent = contents
    document.head.appendChild(script)
  }

  /**
   * Detect WASI version and requirements
   * Returns 'preview1', 'preview2', or null
   */
  async detectWasiVersion(wasmBytes: Uint8Array): Promise<'preview1' | 'preview2' | null> {
    try {
      const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer
      const module = await WebAssembly.compile(buffer)
      const imports = WebAssembly.Module.imports(module)
      
      for (const imp of imports) {
        const moduleName = imp.module
        if (moduleName === 'wasi_snapshot_preview1') {
          return 'preview1'
        }
        if (moduleName.startsWith('wasi:')) {
          return 'preview2'
        }
      }
      return null
    } catch (error) {
      this._kernel.log.warn(`Failed to detect WASI version: ${(error as Error).message}`)
      return null
    }
  }

  async detectAsyncify(wasmBytes: Uint8Array): Promise<{ 
    hasAsyncify: boolean
    hasExports: boolean
    hasImports: boolean
    exportNames: string[]
    importNames: string[]
  }> {
    try {
      const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer
      const module = await WebAssembly.compile(buffer)
      const imports = WebAssembly.Module.imports(module)
      const exports = WebAssembly.Module.exports(module)
      
      const asyncifyImportNames = imports
        .filter((imp) => imp.name.includes('asyncify'))
        .map((imp) => `${imp.module}.${imp.name}`)
      
      const asyncifyExportNames = exports
        .filter((exp) => exp.name.includes('asyncify'))
        .map((exp) => exp.name)
      
      const hasImports = asyncifyImportNames.length > 0
      const hasExports = asyncifyExportNames.length > 0
      const hasAsyncify = hasImports || hasExports
      
      return { hasAsyncify, hasExports, hasImports, exportNames: asyncifyExportNames, importNames: asyncifyImportNames }
    } catch {
      return { hasAsyncify: false, hasExports: false, hasImports: false, exportNames: [], importNames: [] }
    }
  }

  /**
   * Detect if a WASM module was compiled with Asyncify
   * Checks for asyncify-related imports
   */
  /**
   * Detect if a WASM module requires WASI bindings
   * Checks for WASI-related imports in the module
   */
  async detectWasiRequirements(wasmBytes: Uint8Array): Promise<boolean> {
    const version = await this.detectWasiVersion(wasmBytes)
    return version !== null
  }

  /**
   * Detect if a WASM module imports memory from a specific module
   * Returns the initial and maximum pages required, or null if not imported
   */
  async detectMemoryImport(wasmBytes: Uint8Array, moduleName: string): Promise<{ initial: number; maximum?: number } | null> {
    try {
      const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer
      const module = await WebAssembly.compile(buffer)
      const imports = WebAssembly.Module.imports(module)
      
      let hasMemoryImport = false
      for (const imp of imports) {
        if (imp.module === moduleName && imp.name === 'memory' && imp.kind === 'memory') {
          hasMemoryImport = true
          break
        }
      }
      
      if (!hasMemoryImport) {
        return null
      }
      
      // Parse WASM binary to extract memory type (initial pages)
      // WASM binary format: magic (4) + version (4) + sections...
      // Import section (id=2) contains imports with their types
      const view = new DataView(buffer)
      let offset = 8 // Skip magic and version
      
      while (offset < buffer.byteLength) {
        const sectionId = view.getUint8(offset)
        offset++
        
        if (sectionId === 0) {
          // Custom section: size + name length + name + payload
          const sectionSize = this.readLEB128(view, offset)
          offset += sectionSize.bytesRead
          const sectionEnd = offset + sectionSize.value
          
          // Skip name
          const nameLen = this.readLEB128(view, offset)
          offset += nameLen.bytesRead + nameLen.value
          
          // Skip to end of section
          offset = sectionEnd
        } else if (sectionId === 2) {
          // Import section
          const sectionSize = this.readLEB128(view, offset)
          const sectionEnd = offset + sectionSize.bytesRead + sectionSize.value
          offset += sectionSize.bytesRead
          
          const importCount = this.readLEB128(view, offset)
          offset += importCount.bytesRead
          
          for (let i = 0; i < importCount.value; i++) {
            // Read module name
            const moduleNameLen = this.readLEB128(view, offset)
            offset += moduleNameLen.bytesRead
            const moduleNameBytes = new Uint8Array(buffer, offset, moduleNameLen.value)
            offset += moduleNameLen.value
            const currentModuleName = new TextDecoder().decode(moduleNameBytes)
            
            // Read import name
            const importNameLen = this.readLEB128(view, offset)
            offset += importNameLen.bytesRead
            const importNameBytes = new Uint8Array(buffer, offset, importNameLen.value)
            offset += importNameLen.value
            const currentImportName = new TextDecoder().decode(importNameBytes)
            
            // Read import kind
            const kind = view.getUint8(offset)
            offset++
            
            if (currentModuleName === moduleName && currentImportName === 'memory' && kind === 2) {
              // Memory type: flags (1 byte) + initial (LEB128) + optional maximum (LEB128)
              const flags = view.getUint8(offset)
              offset++
              
              const initial = this.readLEB128(view, offset)
              offset += initial.bytesRead
              
              // If flags has bit 0 set, there's a maximum value
              let maximum: number | undefined
              if ((flags & 0x01) !== 0) {
                const max = this.readLEB128(view, offset)
                offset += max.bytesRead
                maximum = max.value
              }
              
              return { initial: initial.value, maximum }
            } else {
              // Skip this import's descriptor based on kind
              offset = this.skipImportDescriptor(view, offset, kind)
            }
          }
          
          offset = sectionEnd
        } else {
          // Other section, skip it
          const sectionSize = this.readLEB128(view, offset)
          offset += sectionSize.bytesRead
          offset += sectionSize.value
        }
      }
      
      // If we found the import but couldn't parse the type, use default
      // Don't set maximum - let the WASM module use its own declared maximum
      return { initial: 128 }
    } catch (error) {
      this._kernel.log.warn(`Failed to detect memory import: ${(error as Error).message}`)
      // If parsing fails but we detected the import, use safe default
      // Don't set maximum - let the WASM module use its own declared maximum
      return { initial: 128 }
    }
  }

  /**
   * Read LEB128 unsigned integer from DataView
   */
  private readLEB128(view: DataView, offset: number): { value: number; bytesRead: number } {
    let result = 0
    let shift = 0
    let bytesRead = 0
    
    while (true) {
      const byte = view.getUint8(offset + bytesRead)
      bytesRead++
      result |= (byte & 0x7f) << shift
      
      if ((byte & 0x80) === 0) {
        break
      }
      
      shift += 7
      if (shift >= 32) {
        throw new Error('LEB128 value too large')
      }
    }
    
    return { value: result, bytesRead }
  }

  /**
   * Skip an import descriptor based on its kind
   * Returns the new offset after the descriptor
   */
  private skipImportDescriptor(view: DataView, offset: number, kind: number): number {
    switch (kind) {
      case 0: {
        // Function: type index (LEB128)
        const typeIdx = this.readLEB128(view, offset)
        return offset + typeIdx.bytesRead
      }
      case 1: {
        // Table: element type (1 byte) + limits
        offset++ // element type
        const flags = view.getUint8(offset)
        offset++
        const initial = this.readLEB128(view, offset)
        offset += initial.bytesRead
        if ((flags & 0x01) !== 0) {
          const max = this.readLEB128(view, offset)
          offset += max.bytesRead
        }
        return offset
      }
      case 2: {
        // Memory: limits (flags + initial + optional max)
        const flags = view.getUint8(offset)
        offset++
        const initial = this.readLEB128(view, offset)
        offset += initial.bytesRead
        if ((flags & 0x01) !== 0) {
          const max = this.readLEB128(view, offset)
          offset += max.bytesRead
        }
        return offset
      }
      case 3: {
        // Global: valtype (1 byte) + mutability (1 byte)
        return offset + 2
      }
      default:
        return offset
    }
  }

  /**
   * Create WASI Preview 1 bindings
   * Preview 1 uses file descriptor-based I/O
   */
  private createWasiPreview1Bindings(
    streams: WasiStreamOptions, 
    args: string[], 
    hasAsyncify: boolean = false,
    memoryRequirements: { initial: number; maximum?: number } = { initial: 1 },
    shell?: Shell,
    pid?: number
  ): { 
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
    const activeShell = shell || this._kernel.shell
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
      if (code === 'ENOSYS' || message.includes('not implemented') || message.includes('enosys')) return 52

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
        const fsSync = this._kernel.filesystem.fsSync
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
            this._kernel.log.warn('Root path is not a directory')
          }
        } else {
          this._kernel.log.warn('Root directory does not exist')
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
      __syscall_faccessat: (...args: number[]): number => {
        ignore(...args)
        // faccessat checks file access permissions
        // Return -1 (ENOENT) to indicate file not found / not accessible
        return -1
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
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            const currentProcess = this._kernel.processes.get(currentPid) || null
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

          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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
                const fsSync = this._kernel.filesystem.fsSync
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

            const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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
          const fsSync = this._kernel.filesystem.fsSync
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
        } catch {
          return -1
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
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            if (resolvedPath === '/proc/self/stat') {
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
              const fsSync = this._kernel.filesystem.fsSync
              try {
                if (!fsSync.existsSync('/proc/self')) {
                  fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
                }
                fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
              } catch (error) {
                this._kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
              }
            }
          }

          const fsSync = this._kernel.filesystem.fsSync
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
        } catch {
          return -1
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
          const fsSync = this._kernel.filesystem.fsSync

          // Handle /proc/self/stat dynamically - create it with the current process's PID
          if (resolvedPath === '/proc/self/stat' || resolvedPath.startsWith('/proc/self/')) {
            const currentPid = pid !== undefined ? pid : (() => {
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            if (resolvedPath === '/proc/self/stat') {
              // Create /proc/self/stat with the current process's PID
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
                this._kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
              }
            } else if (resolvedPath === '/proc/self/exe') {
              // Handle /proc/self/exe symlink
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
                this._kernel.log.warn(`Failed to create /proc/self/exe: ${(error as Error).message}`)
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
              return -1
            }
            const stat = fsSync.statSync(resolvedPath)
            if (!stat.isDirectory()) {
              return -1
            }
          }

          if (excl && exists) {
            return -1
          }

          if (create && !exists && !directory) {
            const dir = path.dirname(resolvedPath)
            if (!fsSync.existsSync(dir)) {
              fsSync.mkdirSync(dir, { recursive: true })
            }
          }

          // Ensure /proc/self/stat exists and is readable before opening
          if (resolvedPath === '/proc/self/stat') {
            const currentPid = pid !== undefined ? pid : (() => {
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            if (!fsSync.existsSync('/proc/self/stat') || !fsSync.statSync('/proc/self/stat').isFile()) {
              // Recreate it if it doesn't exist or is invalid
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
                this._kernel.log.warn(`Failed to ensure /proc/self/stat exists: ${(error as Error).message}`)
              }
            }
          }

            const handle = fsSync.openSync(resolvedPath, zenfsFlags)
            const stat = fsSync.statSync(resolvedPath)
            const fd = allocateFd(handle as unknown as FileHandle, resolvedPath, stat.isDirectory())
            
            return fd
        } catch {
          return -1
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
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            if (resolvedPath === '/proc/self/stat') {
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
              const fsSync = this._kernel.filesystem.fsSync
              try {
                if (!fsSync.existsSync('/proc/self')) {
                  fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
                }
                fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
              } catch (error) {
                this._kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
              }
            }
          }
          
          const fsSync = this._kernel.filesystem.fsSync
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
        } catch {
          return -1
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
          const fsSync = this._kernel.filesystem.fsSync

          const AT_REMOVEDIR = 0x200
          if ((flags & AT_REMOVEDIR) !== 0) {
            fsSync.rmdirSync(resolvedPath)
          } else {
            fsSync.unlinkSync(resolvedPath)
          }
          return 0
        } catch {
          return -1
        }
      },
      __syscall_fchmod: (fd: number, mode: number): number => {
        try {
          if (fd < 0 || fd > 2) {
            const entry = getFileHandle(fd)
            if (!entry || entry.isDirectory) {
              return -1
            }

            const fsSync = this._kernel.filesystem.fsSync
            fsSync.chmodSync(entry.path, mode)
            return 0
          }

          // Cannot change permissions on stdin/stdout/stderr
          return -1
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
      },
      __syscall_chmod: (pathPtr: number, mode: number): number => {
        try {
          const pathStr = readNullTerminatedString(pathPtr, activeMemory)
          const resolvedPath = pathStr.startsWith('/') ? pathStr : path.resolve('/', pathStr)
          const fsSync = this._kernel.filesystem.fsSync
          fsSync.chmodSync(resolvedPath, mode)
          return 0
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
      },
      __syscall_mkdir: (pathPtr: number, mode: number): number => {
        try {
          const pathStr = readNullTerminatedString(pathPtr, activeMemory)
          const resolvedPath = pathStr.startsWith('/') ? pathStr : path.resolve('/', pathStr)
          const fsSync = this._kernel.filesystem.fsSync
          fsSync.mkdirSync(resolvedPath, { mode, recursive: false })
          return 0
        } catch {
          return -1
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
          const fsSync = this._kernel.filesystem.fsSync
          fsSync.mkdirSync(resolvedPath, { mode, recursive: false })
          return 0
        } catch {
          return -1
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
          const fsSync = this._kernel.filesystem.fsSync
          // flags can include AT_SYMLINK_NOFOLLOW (0x100) but we ignore it for now
          ignore(flags)
          fsSync.chmodSync(resolvedPath, mode)
          return 0
        } catch (error) {
          return mapFilesystemError(error as Error)
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
      __syscall_rename: (...args: number[]): number => {
        ignore(...args)
        // rename - rename file
        return -1
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
        const allProcesses = Array.from(this._kernel.processes.all.values())
        const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
        return lastProcess?.pid || 1
      },
      __syscall_getpid64: (): number => {
        // getpid64 - get process ID (64-bit variant)
        if (pid !== undefined) {
          return pid
        }
        const allProcesses = Array.from(this._kernel.processes.all.values())
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
        this._kernel.log.info(str)
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
        this._kernel.log.warn(str)
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
        this._kernel.log.error(str)
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
          const fsSync = this._kernel.filesystem.fsSync
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
            const allProcesses = Array.from(this._kernel.processes.all.values())
            const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
            return lastProcess?.pid || 1
          })()
          
          const currentProcess = this._kernel.processes.get(currentPid) || null
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
          const fsSync = this._kernel.filesystem.fsSync
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
            const fsSync = this._kernel.filesystem.fsSync
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
              const fsSync = this._kernel.filesystem.fsSync
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
          const fsSync = this._kernel.filesystem.fsSync
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
          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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
            const fsSync = this._kernel.filesystem.fsSync
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
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            if (resolvedPath === '/proc/self/stat') {
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
              const fsSync = this._kernel.filesystem.fsSync
              try {
                if (!fsSync.existsSync('/proc/self')) {
                  fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
                }
                fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
              } catch (error) {
                this._kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
              }
            }
          }

          const fsSync = this._kernel.filesystem.fsSync
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
          const fsSync = this._kernel.filesystem.fsSync
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
          const fsSync = this._kernel.filesystem.fsSync
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
                const fsSync = this._kernel.filesystem.fsSync
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
          this._kernel.log.warn(`Failed to write environment variables: ${(error as Error).message}`)
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
              const allProcesses = Array.from(this._kernel.processes.all.values())
              const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
              return lastProcess?.pid || 1
            })()
            
            if (resolvedPath === '/proc/self/stat') {
              const currentProcess = this._kernel.processes.get(currentPid) || null
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
              const fsSync = this._kernel.filesystem.fsSync
              try {
                if (!fsSync.existsSync('/proc/self')) {
                  fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
                }
                fsSync.writeFileSync('/proc/self/stat', statContent, { mode: 0o444 })
              } catch (error) {
                this._kernel.log.warn(`Failed to create /proc/self/stat: ${(error as Error).message}`)
              }
            } else if (resolvedPath === '/proc/self/exe') {
              const currentProcess = this._kernel.processes.get(currentPid) || null
              const exePath = currentProcess?.command || '/bin/ecmaos'
              const fsSync = this._kernel.filesystem.fsSync
              try {
                if (!fsSync.existsSync('/proc/self')) {
                  fsSync.mkdirSync('/proc/self', { recursive: true, mode: 0o555 })
                }
                if (fsSync.existsSync('/proc/self/exe')) {
                  fsSync.unlinkSync('/proc/self/exe')
                }
                fsSync.symlinkSync(exePath, '/proc/self/exe')
              } catch (error) {
                this._kernel.log.warn(`Failed to create /proc/self/exe: ${(error as Error).message}`)
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
            const fsSync = this._kernel.filesystem.fsSync
            const exists = fsSync.existsSync(resolvedPath)
            
            // If we only have read access but create flag is set and file doesn't exist, use write mode
            if (!hasWrite && create && !exists && !directory) {
              zenfsFlags = 'w'
            }
            
            // If file exists and we have write access but not read access, use 'r+' to allow both
            // (Rust sometimes requests write-only access but then needs to read)
            if (hasWrite && !hasRead && exists && !directory) {
              zenfsFlags = 'r+'
            }
            
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

            // Ensure parent directory exists when opening in write mode
            if (!directory && (hasWrite || create)) {
              const dir = path.dirname(resolvedPath)
              const dirExists = fsSync.existsSync(dir)
              if (!dirExists) {
                try {
                  fsSync.mkdirSync(dir, { recursive: true })
                } catch {
                  // If parent directory creation fails, still try to open the file
                  // (the error will be caught by the outer try-catch)
                }
              }
            }

            const handleFd = fsSync.openSync(resolvedPath, zenfsFlags)
            const stat = fsSync.statSync(resolvedPath)
            // Wrap the numeric fd in a FileHandle-like object
            const handle = { fd: handleFd } as unknown as FileHandle
            const fd = allocateFd(handle, resolvedPath, stat.isDirectory())

            const view = new DataView(activeMemory.buffer)
            view.setUint32(openedFd, fd, true)
            return 0
          } catch (err) {
            return mapFilesystemError(err as Error)
          }
        } catch (err) {
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

          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
          fsSync.unlinkSync(resolvedPath)
          return 0
        } catch (error) {
          return mapFilesystemError(error as Error)
        }
      },

      path_remove_directory: (dirfd: number, pathPtr: number, pathLen: number): number => {
        try {
          const pathStr = readStringFromMemory(pathPtr, pathLen, activeMemory)
          const resolvedPath = resolvePath(dirfd, pathStr)

          const fsSync = this._kernel.filesystem.fsSync
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

          const fsSync = this._kernel.filesystem.fsSync
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

  /**
   * Load a WASI component with stream integration
   * Supports both WASI Preview 1 and Preview 2
   */
  async loadWasiComponent(path: string, streams: WasiStreamOptions, args: string[] = [], shell?: Shell, pid?: number): Promise<WasiComponentResult> {
    const wasmBytes = await this._kernel.filesystem.fs.readFile(path)
    const version = await this.detectWasiVersion(wasmBytes)
    
    if (version === 'preview1') {
      return this.loadWasiPreview1(path, wasmBytes, streams, args, shell, pid)
    }
    
    return this.loadWasiPreview2(path, wasmBytes, streams, args, shell)
  }

  /**
   * Load WASI Preview 1 component
   */
  private async loadWasiPreview1(path: string, wasmBytes: Uint8Array, streams: WasiStreamOptions, args: string[], shell?: Shell, pid?: number): Promise<WasiComponentResult> {
    const asyncifyInfo = await this.detectAsyncify(wasmBytes)
    const memoryRequirements = await this.detectMemoryImport(wasmBytes, 'env') ?? { initial: 1 }
    const { imports, setMemory, setInstance, flush, waitForInput, getAsyncifyState, resetAsyncifyPending, setAsyncifyDataAddr, waitForStdinData, initializePreOpenedDirs } = this.createWasiPreview1Bindings(streams, args, asyncifyInfo.hasAsyncify, memoryRequirements, shell, pid)
    
    await initializePreOpenedDirs()
    const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer
    
    // Log all required imports for debugging
    // try {
    //   const module = await WebAssembly.compile(buffer)
    //   const requiredImports = WebAssembly.Module.imports(module)
    //   const importMap = new Map<string, Set<string>>()
      
    //   for (const imp of requiredImports) {
    //     if (!importMap.has(imp.module)) {
    //       importMap.set(imp.module, new Set())
    //     }
    //     importMap.get(imp.module)!.add(`${imp.name} (${imp.kind})`)
    //   }
      
    //   this._kernel.log.info('WASM module required imports:')
    //   for (const [moduleName, imports] of importMap.entries()) {
    //     const importList = Array.from(imports).sort().join(', ')
    //     this._kernel.log.info(`  ${moduleName}: ${importList}`)
    //   }
    // } catch (error) {
    //   this._kernel.log.warn(`Failed to log imports: ${(error as Error).message}`)
    // }
    
    let exitCode = 0
    let instance: WebAssembly.Instance | null = null
    
    try {
      const result = await WebAssembly.instantiate(buffer, imports)
      instance = result.instance
      setInstance(result.instance)
      this._modules.set(path, { module: result.module, instance: result.instance })
      
      const exports = result.instance.exports
      if (typeof exports.memory === 'object' && exports.memory instanceof WebAssembly.Memory) {
        setMemory(exports.memory)
      }
      
      await waitForInput()
      
      if (typeof exports._start === 'function') {
        if (asyncifyInfo.hasExports && typeof exports.asyncify_get_state === 'function') {
          exitCode = await this.runWithAsyncify(exports, getAsyncifyState, resetAsyncifyPending, setAsyncifyDataAddr, waitForStdinData, flush)
        } else {
          try {
            (exports._start as () => void)()
          } catch (error) {
            const errorMsg = (error as Error).message
            if (errorMsg.includes('proc_exit')) {
              const match = errorMsg.match(/proc_exit\((\d+)\)/)
              exitCode = match && match[1] ? parseInt(match[1], 10) : 1
            } else {
              this._kernel.log.error(`WASM _start failed: ${errorMsg}`)
              exitCode = 1
            }
          }
        }
      } else {
        // Try calling __wasm_call_ctors if it exists (Emscripten initialization)
        if (typeof exports.__wasm_call_ctors === 'function') {
          try {
            (exports.__wasm_call_ctors as () => void)()
          } catch {
            // Ignore initialization errors
          }
        }
        
        // For library modules without _start, we can't run them as CLI
        // They need to be used through a JavaScript wrapper
        this._kernel.log.warn('WASM module has no _start function - it appears to be a library module, not a CLI application')
        exitCode = 0
      }
      
      await flush()
      
      if (exitCode !== undefined) {
        await new Promise(resolve => setTimeout(resolve, 10))
        await flush()
      }
    } catch (error) {
      this._kernel.log.error(`Failed to instantiate WASI Preview 1: ${(error as Error).message}`)
      exitCode = 1
    }
    
    if (!instance) {
      throw new Error('Failed to create WASM instance')
    }
    
    return { instance, exitCode: Promise.resolve(exitCode) }
  }
  
  private async runWithAsyncify(
    exports: WebAssembly.Exports, 
    getAsyncifyState: () => { pending: boolean, dataAddr: number },
    resetAsyncifyPending: () => void,
    setAsyncifyDataAddr: (addr: number) => void,
    waitForStdinData: () => Promise<void>,
    flush: () => Promise<void>
  ): Promise<number> {
    const getState = exports.asyncify_get_state as () => number
    const stopUnwind = exports.asyncify_stop_unwind as (() => void) | undefined
    const startRewind = exports.asyncify_start_rewind as ((addr: number) => void) | undefined
    const stopRewind = exports.asyncify_stop_rewind as (() => void) | undefined
    const memory = exports.memory as WebAssembly.Memory
    const malloc = exports.malloc as ((size: number) => number) | undefined
    
    const ASYNCIFY_DATA_SIZE = 16384
    let dataAddr = 0
    
    if (malloc) {
      dataAddr = malloc(ASYNCIFY_DATA_SIZE)
    } else {
      dataAddr = memory.buffer.byteLength - ASYNCIFY_DATA_SIZE - 256
    }
    
    const memView = new DataView(memory.buffer)
    const stackStart = dataAddr + 8
    const stackEnd = dataAddr + ASYNCIFY_DATA_SIZE
    
    new Uint8Array(memory.buffer, dataAddr, ASYNCIFY_DATA_SIZE).fill(0)
    
    memView.setInt32(dataAddr, stackStart, true)
    memView.setInt32(dataAddr + 4, stackEnd, true)
    
    setAsyncifyDataAddr(dataAddr)
    
    let exitCode = 0
    let iterations = 0
    const maxIterations = 1000
    let justCompletedRewind = false
    
    while (iterations < maxIterations) {
      iterations++
      const stateBefore = getState()
      
      // If we just completed a rewind, don't call _start() again - execution should continue automatically
      if (justCompletedRewind) {
        justCompletedRewind = false
        // Wait a moment for execution to continue and potentially unwind
        await new Promise(r => setTimeout(r, 10))
        const checkState = getState()
        const checkAsyncState = getAsyncifyState()
        // If execution unwound again, handle it
        if (checkState === 1 || checkAsyncState.pending) {
          if (stopUnwind) stopUnwind()
          await waitForStdinData()
          resetAsyncifyPending()
          if (startRewind && dataAddr) {
            startRewind(dataAddr)
          }
          continue
        }
        // If state is still 0, execution might have completed or is still running
        // Continue the loop to see if more input arrives or execution completes
        continue
      }
      
      // Don't call _start() during rewind (state 2) - execution continues automatically
      if (stateBefore === 2) {
        // During rewind, execution continues automatically. Wait a bit and check state.
        await new Promise(r => setTimeout(r, 10))
        const checkState = getState()
        const checkAsyncState = getAsyncifyState()
        if (checkState === 0) {
          // Rewind completed, execution finished
          if (stopRewind) stopRewind()
          await flush()
          break
        } else if (checkState === 1 || checkAsyncState.pending) {
          // Execution unwound again, wait for more input
          if (stopUnwind) stopUnwind()
          await waitForStdinData()
          resetAsyncifyPending()
          if (startRewind && dataAddr) {
            startRewind(dataAddr)
          }
          continue
        }
        // Still in rewind, continue loop
        continue
      }
      
      try {
        (exports._start as () => void)()
        
        const stateAfter = getState()
        const asyncStateAfter = getAsyncifyState()
        
        if (stateAfter === 1 || asyncStateAfter.pending) {
          if (stopUnwind) stopUnwind()
          await waitForStdinData()
          resetAsyncifyPending()
          
          if (startRewind && dataAddr) {
            startRewind(dataAddr)
          }
          continue
        }
        
        if (stopRewind) stopRewind()
        
        break
      } catch (error) {
        const errorMsg = (error as Error).message
        if (errorMsg.includes('proc_exit')) {
          const match = errorMsg.match(/proc_exit\((\d+)\)/)
          exitCode = match && match[1] ? parseInt(match[1], 10) : 0
          break
        }
        
        const stateAfter = getState()
        const asyncStateAfter = getAsyncifyState()
        
        if (stateBefore === 2) {
          // Error during rewind - the "unreachable" might be expected during rewind replay
          // Try to finalize rewind and see if execution can continue
          if (stopRewind) {
            stopRewind()
            const finalState = getState()
            
            // If state is now 0, rewind completed despite error
            // The "unreachable" during rewind might be expected - it's how Asyncify replays
            // After stopRewind(), execution should continue from where it left off
            if (finalState === 0) {
              await flush()
              // If the "unreachable" error happened during rewind, and finalState is 0,
              // the program has completed this async operation.
              break
            }
          }
        }
        
        if (stateAfter === 1 || asyncStateAfter.pending) {
          if (stopUnwind) stopUnwind()
          await waitForStdinData()
          resetAsyncifyPending()
          if (startRewind && asyncStateAfter.dataAddr) startRewind(asyncStateAfter.dataAddr)
          continue
        }
        
        this._kernel.log.error(`WASM _start failed: ${errorMsg}`)
        exitCode = 1
        break
      }
    }
    
    return exitCode
  }

  /**
   * Load WASI Preview 2 component
   * Uses preview2-shim for WASI Preview2 support
   */
  private async loadWasiPreview2(path: string, wasmBytes: Uint8Array, streams: WasiStreamOptions, args: string[], shell?: Shell): Promise<WasiComponentResult> {
    const shim = new WASIShim()
    const shimWithArgs = shim as unknown as { setArgs?: (args: string[]) => void; setEnv?: (env: Record<string, string>) => void }
    if (args.length > 0 && typeof shimWithArgs.setArgs === 'function') {
      shimWithArgs.setArgs(args)
    }
    
    // Set environment variables if shell is provided and shim supports it
    if (shell && shell.env && typeof shimWithArgs.setEnv === 'function') {
      const env: Record<string, string> = {}
      for (const [key, value] of shell.env.entries()) {
        env[key] = value
      }
      shimWithArgs.setEnv(env)
    }
    
    const importObject = shim.getImportObject() as Record<string, unknown>
    
    const stdinReader = streams.stdin.getReader()
    const stdoutWriter = streams.stdout.getWriter()
    const stderrWriter = streams.stderr.getWriter()

    const bridgeStreams = () => {
      const ioStreamsKey = 'wasi:io/streams'
      if (importObject[ioStreamsKey] && typeof importObject[ioStreamsKey] === 'object') {
        const ioStreams = importObject[ioStreamsKey] as Record<string, unknown>
        
        if (ioStreams.stdin && typeof ioStreams.stdin === 'object') {
          const stdin = ioStreams.stdin as Record<string, unknown>
          const originalRead = stdin.read
          if (typeof originalRead === 'function') {
            stdin.read = async () => {
              try {
                const { done, value } = await stdinReader.read()
                if (done) {
                  return { tag: 'closed' as const }
                }
                return { tag: 'open' as const, val: value }
              } catch {
                return { tag: 'closed' as const }
              }
            }
          }
        }
        
        if (ioStreams.stdout && typeof ioStreams.stdout === 'object') {
          const stdout = ioStreams.stdout as Record<string, unknown>
          const originalWrite = stdout.write
          if (typeof originalWrite === 'function') {
            stdout.write = async (chunk: Uint8Array) => {
              try {
                await stdoutWriter.write(chunk)
                return { tag: 'ok' as const, val: BigInt(chunk.length) }
              } catch {
                return { tag: 'err' as const, val: { tag: 'last-operation-failed' as const } }
              }
            }
          }
        }
        
        if (ioStreams.stderr && typeof ioStreams.stderr === 'object') {
          const stderr = ioStreams.stderr as Record<string, unknown>
          const originalWrite = stderr.write
          if (typeof originalWrite === 'function') {
            stderr.write = async (chunk: Uint8Array) => {
              try {
                await stderrWriter.write(chunk)
                return { tag: 'ok' as const, val: BigInt(chunk.length) }
              } catch {
                return { tag: 'err' as const, val: { tag: 'last-operation-failed' as const } }
              }
            }
          }
        }
      }
    }

    bridgeStreams()

    const buffer = wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) as ArrayBuffer
    const result = await WebAssembly.instantiate(buffer, importObject as WebAssembly.Imports)
    this._modules.set(path, { module: result.module, instance: result.instance })

    let exitCodePromise: Promise<number> = Promise.resolve(0)
    
    const exports = result.instance.exports
    
    const cliRunKey = 'wasi:cli/run'
    if (importObject[cliRunKey] && typeof importObject[cliRunKey] === 'object') {
      const run = importObject[cliRunKey] as { run?: (instance: WebAssembly.Instance) => Promise<number> }
      if (run.run) {
        exitCodePromise = run.run(result.instance).catch((error) => {
          this._kernel.log.error(`WASI run failed: ${(error as Error).message}`)
          return 1
        })
      }
    } else if (typeof exports._start === 'function') {
      try {
        (exports._start as () => void)()
        exitCodePromise = Promise.resolve(0)
      } catch (error) {
        this._kernel.log.error(`WASM _start failed: ${(error as Error).message}`)
        exitCodePromise = Promise.resolve(1)
      }
    } else if (typeof exports._initialize === 'function') {
      try {
        (exports._initialize as () => void)()
        exitCodePromise = Promise.resolve(0)
      } catch (error) {
        this._kernel.log.error(`WASM _initialize failed: ${(error as Error).message}`)
        exitCodePromise = Promise.resolve(1)
      }
    }

    exitCodePromise = exitCodePromise.finally(async () => {
      try {
        await stdinReader.releaseLock()
      } catch {}
      try {
        await stdoutWriter.releaseLock()
      } catch {}
      try {
        await stderrWriter.releaseLock()
      } catch {}
    })

    return { instance: result.instance, exitCode: exitCodePromise }
  }

  /**
   * Load a WebAssembly module (non-WASI)
   */
  async loadWasm(path: string) {
    const importObject = {
      env: {
        log: console.log
      }
    }

    const wasm = await this._kernel.filesystem.fs.readFile(path)
    const buffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer
    const result = await WebAssembly.instantiate(buffer, importObject)
    this._modules.set(path, { module: result.module, instance: result.instance })
    return { module: result.module, instance: result.instance }
  }
}
