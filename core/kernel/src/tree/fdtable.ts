/**
 * File Descriptor Table - Manages standard I/O streams for processes
 * 
 * Standard file descriptors:
 * - 0: stdin (ReadableStream)
 * - 1: stdout (WritableStream)
 * - 2: stderr (WritableStream)
 * 
 * For file-backed fds (3+), use ZenFS's FileHandle which provides:
 * - fd property (numeric file descriptor)
 * - readableWebStream() / writableWebStream() for Web Streams
 * - close() for cleanup
 * 
 * This class focuses on stdin/stdout/stderr which ZenFS doesn't handle,
 * and optionally tracks ZenFS FileHandles for process cleanup.
 * 
 * @see https://zenfs.dev/core/classes/index.fs.promises.FileHandle.html
 */

import type { FileHandle, FDTable as IFDTable } from '@ecmaos/types'

// Re-export for backwards compatibility
export type ZenFSFileHandle = FileHandle

export class FDTable implements IFDTable {
  private _stdin: ReadableStream<Uint8Array> | undefined
  private _stdout: WritableStream<Uint8Array> | undefined
  private _stderr: WritableStream<Uint8Array> | undefined
  
  // Track ZenFS file handles for cleanup
  private _fileHandles: Set<FileHandle> = new Set()

  constructor(
    stdin?: ReadableStream<Uint8Array>,
    stdout?: WritableStream<Uint8Array>,
    stderr?: WritableStream<Uint8Array>
  ) {
    this._stdin = stdin
    this._stdout = stdout
    this._stderr = stderr
  }

  /**
   * Standard stream accessors
   */
  get stdin(): ReadableStream<Uint8Array> | undefined {
    return this._stdin
  }

  get stdout(): WritableStream<Uint8Array> | undefined {
    return this._stdout
  }

  get stderr(): WritableStream<Uint8Array> | undefined {
    return this._stderr
  }

  /**
   * Redirect stdin to a different stream
   */
  setStdin(stream: ReadableStream<Uint8Array>): void {
    this._stdin = stream
  }

  /**
   * Redirect stdout to a different stream
   */
  setStdout(stream: WritableStream<Uint8Array>): void {
    this._stdout = stream
  }

  /**
   * Redirect stderr to a different stream
   */
  setStderr(stream: WritableStream<Uint8Array>): void {
    this._stderr = stream
  }

  /**
   * Redirect stderr to stdout (2>&1)
   */
  redirectStderrToStdout(): void {
    if (this._stdout) this._stderr = this._stdout
  }

  /**
   * Register a ZenFS FileHandle for tracking
   * The handle's fd is managed by ZenFS, we just track it for cleanup
   */
  trackFileHandle(handle: FileHandle): void {
    this._fileHandles.add(handle)
  }

  /**
   * Unregister a ZenFS FileHandle (e.g., after manual close)
   */
  untrackFileHandle(handle: FileHandle): void {
    this._fileHandles.delete(handle)
  }

  /**
   * Get all tracked file handles
   */
  get fileHandles(): FileHandle[] {
    return Array.from(this._fileHandles)
  }

  /**
   * Close all tracked ZenFS file handles
   */
  async closeFileHandles(): Promise<void> {
    const handles = Array.from(this._fileHandles)
    await Promise.all(handles.map(async (handle) => {
      try {
        await handle.close()
      } catch {
        // Handle may already be closed
      }
    }))
    this._fileHandles.clear()
  }

  /**
   * Close all resources (for process cleanup)
   * Note: Does NOT close stdin/stdout/stderr as those may be shared with terminal
   */
  async cleanup(): Promise<void> {
    await this.closeFileHandles()
  }
}

