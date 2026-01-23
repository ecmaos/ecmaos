declare module '@ecmaos/bios' {
  export interface BIOSModule extends EmscriptenModule {
    // Core functions from bios.cpp
    ccall: typeof ccall
    cwrap: typeof cwrap
    _malloc(size: number): number
    _free(ptr: number): void
    _init(): number
    _get_version(): string
    _execute(command: string): number
    _execute_with_output(command: string, outLenPtr: number): number
    _get_last_status(): number

    // File system operations
    FS: typeof FS
    _write_file(path: string, content: string): number
    _read_file(path: string, outLenPtr: number): number
    _file_exists(path: string): number
    _delete_file(path: string): number
    _list_directory(path: string, outLenPtr: number): number

    HEAPU8: Uint8Array
    HEAP32: Int32Array
  }

  export enum BIOSState {
    BOOTING = 0,
    RUNNING = 1,
    PANIC = 2
  }

  // Factory function type that creates the module
  export interface CreateBIOS {
    (options?: Partial<EmscriptenModule>): Promise<BIOSModule>
  }

  const createBIOS: CreateBIOS
  export default createBIOS
}

// Augment the global scope to include the BIOS instance
declare global {
  interface Window {
    bios?: BIOSModule
  }
} 