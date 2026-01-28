declare module 'vim-wasm/vimwasm.js' {
  export interface VimWasmOptions {
    canvas: HTMLCanvasElement
    input: HTMLInputElement
    workerScriptPath: string
  }

  export interface VimWasmStartOptions {
    files: Record<string, string>
    dirs: string[]
    cmdArgs: string[]
    debug: boolean
  }

  export class VimWasm {
    constructor(options: VimWasmOptions)
    
    cmdline(command: string): Promise<void>
    isRunning(): boolean
    resize(width: number, height: number): void
    start(options: VimWasmStartOptions): void
    
    onFileExport?: (fullpath: string, contents: ArrayBuffer) => Promise<void>
    onVimExit?: (status: number) => void
    onError?: (err: Error) => Promise<void>
    onTitleUpdate?: (title: string) => void
    onVimInit?: () => Promise<void>
  }

  export function checkBrowserCompatibility(): string | undefined
}
