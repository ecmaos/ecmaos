import { WASIShim } from '@bytecodealliance/preview2-shim/instantiation'
import type { Kernel, WasmOptions, Wasm as IWasm } from '@ecmaos/types'

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
    memoryRequirements: { initial: number; maximum?: number } = { initial: 1 }
  ): { 
    imports: WebAssembly.Imports, 
    setMemory: (memory: WebAssembly.Memory) => void, 
    setInstance: (inst: WebAssembly.Instance) => void,
    flush: () => Promise<void>, 
    waitForInput: (timeoutMs?: number) => Promise<void>,
    getAsyncifyState: () => { pending: boolean, dataAddr: number },
    resetAsyncifyPending: () => void,
    setAsyncifyDataAddr: (addr: number) => void,
    waitForStdinData: () => Promise<void>
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

    const stdinReader = streams.stdin.getReader()
    const stdoutWriter = streams.stdout.getWriter()
    const stderrWriter = streams.stderr.getWriter()
    
    const stdinBuffer: Uint8Array[] = []
    let stdinBufferOffset = 0
    let stdinClosed = false
    
    let asyncifyPending = false
    let asyncifyDataAddr = 0

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
      __syscall_fstat64: (...args: number[]): number => {
        ignore(...args)
        // fstat64 - get file status
        return -1
      },
      __syscall_getdents64: (...args: number[]): number => {
        ignore(...args)
        // getdents64 - get directory entries
        return 0
      },
      __syscall_ioctl: (...args: number[]): number => {
        ignore(...args)
        // ioctl - device control
        return -1
      },
      __syscall_lstat64: (...args: number[]): number => {
        ignore(...args)
        // lstat64 - get file status (no follow symlinks)
        return -1
      },
      __syscall_newfstatat: (...args: number[]): number => {
        ignore(...args)
        // newfstatat - get file status relative to directory
        return -1
      },
      __syscall_openat: (...args: number[]): number => {
        ignore(...args)
        // openat - open file relative to directory
        return -1
      },
      __syscall_rmdir: (...args: number[]): number => {
        ignore(...args)
        // rmdir - remove directory
        return -1
      },
      __syscall_stat64: (...args: number[]): number => {
        ignore(...args)
        // stat64 - get file status
        return -1
      },
      __syscall_unlinkat: (...args: number[]): number => {
        ignore(...args)
        // unlinkat - remove file/directory
        return -1
      },
      __syscall_fchmod: (...args: number[]): number => {
        ignore(...args)
        // fchmod - change file permissions
        return 0
      },
      __syscall_chmod: (...args: number[]): number => {
        ignore(...args)
        // chmod - change file permissions
        return 0
      },
      __syscall_mkdir: (...args: number[]): number => {
        ignore(...args)
        // mkdir - create directory
        return -1
      },
      __syscall_mkdirat: (...args: number[]): number => {
        ignore(...args)
        // mkdirat - create directory relative to directory file descriptor
        return -1
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
      __syscall_fchmodat: (...args: number[]): number => {
        ignore(...args)
        // fchmodat - change file permissions relative to directory
        return 0
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
        return 1
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
      },

      fd_read: (fd: number, iovs: number, iovsLen: number, nread: number): number => {
        if (fd !== 0) return 8
        
        let currentState = 0
        if (hasAsyncify && wasmInstance) {
          const exports = wasmInstance.exports
          const getState = exports.asyncify_get_state as (() => number) | undefined
          if (getState) currentState = getState()
        }
        
        if (currentState === 2) {
          // During rewind, Asyncify replays execution until it reaches the suspend point
          // At that point, execution CONTINUES - this IS the actual read, not a replay
          // So we should consume the data normally
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
              // Set nread to 0 BEFORE unwind - this matches the execution path during rewind
              // so Asyncify can correctly replay up to this point
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
      },

      fd_seek: (_fd: number, _offset: bigint, _whence: number, _newOffset: number): number => {
        ignore(_fd, _offset, _whence, _newOffset)
        return 70
      },

      fd_close: (_fd: number): number => {
        ignore(_fd)
        return 0
      },

      fd_sync: (_fd: number): number => {
        ignore(_fd)
        // Sync file data and metadata to storage
        // For now, just flush stdout/stderr queues
        flush().catch(() => {})
        return 0
      },

      fd_fdstat_get: (_fd: number, buf: number): number => {
        ignore(_fd)
        const view = new DataView(activeMemory.buffer)
        view.setUint8(buf, 0)
        view.setUint8(buf + 1, 0)
        view.setUint16(buf + 2, 0, true)
        view.setBigUint64(buf + 8, 0n, true)
        view.setBigUint64(buf + 16, 0n, true)
        return 0
      },

      fd_fdstat_set_flags: (_fd: number, _flags: number): number => {
        ignore(_fd, _flags)
        return 0
      },

      fd_prestat_get: (_fd: number, _buf: number): number => {
        ignore(_fd, _buf)
        return 8
      },

      fd_prestat_dir_name: (_fd: number, _path: number, _pathLen: number): number => {
        ignore(_fd, _path, _pathLen)
        return 8
      },

      environ_sizes_get: (environCount: number, environBufSize: number): number => {
        const view = new DataView(activeMemory.buffer)
        view.setUint32(environCount, 0, true)
        view.setUint32(environBufSize, 0, true)
        return 0
      },

      environ_get: (_environ: number, _environBuf: number): number => {
        ignore(_environ, _environBuf)
        return 0
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
        throw new Error(`WASI proc_exit(${code})`)
      },

      path_open: (_dirfd: number, _dirflags: number, _path: number, _pathLen: number, _oflags: number, _fsRightsBase: bigint, _fsRightsInheriting: bigint, _fdFlags: number, _openedFd: number): number => {
        ignore(_dirfd, _dirflags, _path, _pathLen, _oflags, _fsRightsBase, _fsRightsInheriting, _fdFlags, _openedFd)
        return 8
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
      waitForStdinData
    }
  }

  /**
   * Load a WASI component with stream integration
   * Supports both WASI Preview 1 and Preview 2
   */
  async loadWasiComponent(path: string, streams: WasiStreamOptions, args: string[] = []): Promise<WasiComponentResult> {
    const wasmBytes = await this._kernel.filesystem.fs.readFile(path)
    const version = await this.detectWasiVersion(wasmBytes)
    
    if (version === 'preview1') {
      return this.loadWasiPreview1(path, wasmBytes, streams, args)
    }
    
    return this.loadWasiPreview2(path, wasmBytes, streams, args)
  }

  /**
   * Load WASI Preview 1 component
   */
  private async loadWasiPreview1(path: string, wasmBytes: Uint8Array, streams: WasiStreamOptions, args: string[]): Promise<WasiComponentResult> {
    const asyncifyInfo = await this.detectAsyncify(wasmBytes)
    const memoryRequirements = await this.detectMemoryImport(wasmBytes, 'env') ?? { initial: 1 }
    const { imports, setMemory, setInstance, flush, waitForInput, getAsyncifyState, resetAsyncifyPending, setAsyncifyDataAddr, waitForStdinData } = this.createWasiPreview1Bindings(streams, args, asyncifyInfo.hasAsyncify, memoryRequirements)
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
      }
      
      await flush()
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
  private async loadWasiPreview2(path: string, wasmBytes: Uint8Array, streams: WasiStreamOptions, args: string[]): Promise<WasiComponentResult> {
    const shim = new WASIShim()
    const shimWithArgs = shim as unknown as { setArgs?: (args: string[]) => void }
    if (args.length > 0 && typeof shimWithArgs.setArgs === 'function') {
      shimWithArgs.setArgs(args)
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
