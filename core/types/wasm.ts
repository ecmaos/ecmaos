/**
 * WebAssembly management types and interfaces
 */

import type { Kernel, Shell } from './index.ts'

/**
 * Options for configuring WebAssembly management
 */
export interface WasmOptions {
  /** Reference to kernel instance */
  kernel: Kernel
}

/**
 * Stream options for WASI component loading
 */
export interface WasiStreamOptions {
  /** Standard input stream */
  stdin: ReadableStream<Uint8Array>
  /** Standard output stream */
  stdout: WritableStream<Uint8Array>
  /** Standard error stream */
  stderr: WritableStream<Uint8Array>
}

/**
 * Result of loading a WASI component
 */
export interface WasiComponentResult {
  /** WebAssembly instance */
  instance: WebAssembly.Instance
  /** Promise that resolves to the exit code */
  exitCode: Promise<number>
}

/**
 * Interface for WebAssembly management functionality
 */
export interface Wasm {
  /**
   * Load an emscripten JS file compiled using -sSINGLE_FILE
   * @param path - Path to the emscripten JS file
   */
  loadEmscripten(path: string): Promise<void>

  /**
   * Load a WebAssembly module
   * @param path - Path to the WebAssembly module
   */
  loadWasm(path: string): Promise<{ module: WebAssembly.Module; instance: WebAssembly.Instance }>

  /**
   * Detect if a WASM module requires WASI bindings
   * @param wasmBytes - The WASM module bytes
   * @returns True if WASI is required, false otherwise
   */
  detectWasiRequirements(wasmBytes: Uint8Array): Promise<boolean>

  /**
   * Load a WASI component with stream integration
   * @param path - Path to the WASM file
   * @param streams - Stream options for stdin/stdout/stderr
   * @param args - Command line arguments
   * @param shell - Optional shell instance to use for environment variables
   * @param pid - Optional process ID for the WASM execution context
   * @returns The WASM instance and exit code promise
   */
  loadWasiComponent(path: string, streams: WasiStreamOptions, args?: string[], shell?: Shell, pid?: number): Promise<WasiComponentResult>
}
