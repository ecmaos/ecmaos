import type { Kernel, WasmOptions, Wasm as IWasm, Shell } from '@ecmaos/types'

import createWasiPreview1Bindings from './wasi/preview1'
import createWasiPreview2Bindings from './wasi/preview2'

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
    // Check magic bytes: 0x00 0x61 0x73 0x6d ("\0asm")
    if (wasmBytes.length < 8 || 
        wasmBytes[0] !== 0x00 || wasmBytes[1] !== 0x61 || 
        wasmBytes[2] !== 0x73 || wasmBytes[3] !== 0x6d) {
      return null
    }
    
    // Check version bytes at offset 4-7
    // Component Model: 0x0d 0x00 0x01 0x00 (layer 1, version 13)
    if (wasmBytes[4] === 0x0d && wasmBytes[5] === 0x00 && 
        wasmBytes[6] === 0x01 && wasmBytes[7] === 0x00) {
      return 'preview2'
    }
    
    // Core WASM: 0x01 0x00 0x00 0x00 (version 1)
    if (wasmBytes[4] === 0x01 && wasmBytes[5] === 0x00 && 
        wasmBytes[6] === 0x00 && wasmBytes[7] === 0x00) {
      // Further check imports for WASI
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
      } catch (error) {
        this._kernel.log.warn(`Failed to detect WASI version: ${(error as Error).message}`)
        return null
      }
    }
    
    return null
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
    const {
      imports,
      setMemory,
      setInstance,
      flush,
      waitForInput,
      getAsyncifyState,
      resetAsyncifyPending,
      setAsyncifyDataAddr,
      waitForStdinData,
      initializePreOpenedDirs,
    } = createWasiPreview1Bindings({
      kernel: this._kernel,
      streams,
      args,
      hasAsyncify: asyncifyInfo.hasAsyncify,
      memoryRequirements,
      shell: shell || this._kernel.shell,
      pid
    })
    
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
   * Uses jco to transpile component model to core wasm + JS, then uses preview2-shim
   */
  private async loadWasiPreview2(path: string, wasmBytes: Uint8Array, streams: WasiStreamOptions, args: string[], shell?: Shell): Promise<WasiComponentResult> {
    const result = await createWasiPreview2Bindings(path, wasmBytes, streams, args, this._kernel, shell)
    this._modules.set(path, {
      module: null as unknown as WebAssembly.Module,
      instance: result.instance
    })
    return result
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
