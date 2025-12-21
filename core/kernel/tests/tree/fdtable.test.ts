import { describe, it, expect, vi, beforeEach } from 'vitest'

import { FDTable, ZenFSFileHandle } from '#fdtable.ts'

describe('FDTable', () => {
  describe('initialization', () => {
    it('should create an empty FDTable', () => {
      const fd = new FDTable()
      expect(fd.stdin).toBeUndefined()
      expect(fd.stdout).toBeUndefined()
      expect(fd.stderr).toBeUndefined()
    })

    it('should initialize with standard streams', () => {
      const stdin = new ReadableStream<Uint8Array>()
      const stdout = new WritableStream<Uint8Array>()
      const stderr = new WritableStream<Uint8Array>()

      const fd = new FDTable(stdin, stdout, stderr)

      expect(fd.stdin).toBe(stdin)
      expect(fd.stdout).toBe(stdout)
      expect(fd.stderr).toBe(stderr)
    })
  })

  describe('stream redirection', () => {
    let fd: FDTable
    let originalStdin: ReadableStream<Uint8Array>
    let originalStdout: WritableStream<Uint8Array>
    let originalStderr: WritableStream<Uint8Array>

    beforeEach(() => {
      originalStdin = new ReadableStream<Uint8Array>()
      originalStdout = new WritableStream<Uint8Array>()
      originalStderr = new WritableStream<Uint8Array>()
      fd = new FDTable(originalStdin, originalStdout, originalStderr)
    })

    it('should redirect stdin', () => {
      const newStdin = new ReadableStream<Uint8Array>()
      fd.setStdin(newStdin)
      expect(fd.stdin).toBe(newStdin)
      expect(fd.stdin).not.toBe(originalStdin)
    })

    it('should redirect stdout', () => {
      const newStdout = new WritableStream<Uint8Array>()
      fd.setStdout(newStdout)
      expect(fd.stdout).toBe(newStdout)
      expect(fd.stdout).not.toBe(originalStdout)
    })

    it('should redirect stderr', () => {
      const newStderr = new WritableStream<Uint8Array>()
      fd.setStderr(newStderr)
      expect(fd.stderr).toBe(newStderr)
      expect(fd.stderr).not.toBe(originalStderr)
    })

    it('should redirect stderr to stdout (2>&1)', () => {
      fd.redirectStderrToStdout()
      expect(fd.stderr).toBe(fd.stdout)
      expect(fd.stderr).toBe(originalStdout)
    })
  })

  describe('ZenFS FileHandle tracking', () => {
    let fd: FDTable

    beforeEach(() => {
      fd = new FDTable()
    })

    it('should start with no tracked file handles', () => {
      expect(fd.fileHandles).toHaveLength(0)
    })

    it('should track a file handle', () => {
      const mockHandle: ZenFSFileHandle = {
        fd: 3,
        close: vi.fn(() => Promise.resolve())
      }

      fd.trackFileHandle(mockHandle)
      expect(fd.fileHandles).toContain(mockHandle)
      expect(fd.fileHandles).toHaveLength(1)
    })

    it('should track multiple file handles', () => {
      const handle1: ZenFSFileHandle = { fd: 3, close: vi.fn(() => Promise.resolve()) }
      const handle2: ZenFSFileHandle = { fd: 4, close: vi.fn(() => Promise.resolve()) }
      const handle3: ZenFSFileHandle = { fd: 5, close: vi.fn(() => Promise.resolve()) }

      fd.trackFileHandle(handle1)
      fd.trackFileHandle(handle2)
      fd.trackFileHandle(handle3)

      expect(fd.fileHandles).toHaveLength(3)
    })

    it('should untrack a file handle', () => {
      const handle: ZenFSFileHandle = { fd: 3, close: vi.fn(() => Promise.resolve()) }

      fd.trackFileHandle(handle)
      expect(fd.fileHandles).toHaveLength(1)

      fd.untrackFileHandle(handle)
      expect(fd.fileHandles).toHaveLength(0)
    })

    it('should not add duplicate file handles', () => {
      const handle: ZenFSFileHandle = { fd: 3, close: vi.fn(() => Promise.resolve()) }

      fd.trackFileHandle(handle)
      fd.trackFileHandle(handle) // Try to add again

      expect(fd.fileHandles).toHaveLength(1)
    })
  })

  describe('cleanup', () => {
    it('should close all tracked file handles', async () => {
      const fd = new FDTable()
      
      const closeFn1 = vi.fn(() => Promise.resolve())
      const closeFn2 = vi.fn(() => Promise.resolve())
      const closeFn3 = vi.fn(() => Promise.resolve())

      const handle1: ZenFSFileHandle = { fd: 3, close: closeFn1 }
      const handle2: ZenFSFileHandle = { fd: 4, close: closeFn2 }
      const handle3: ZenFSFileHandle = { fd: 5, close: closeFn3 }

      fd.trackFileHandle(handle1)
      fd.trackFileHandle(handle2)
      fd.trackFileHandle(handle3)

      await fd.closeFileHandles()

      expect(closeFn1).toHaveBeenCalledTimes(1)
      expect(closeFn2).toHaveBeenCalledTimes(1)
      expect(closeFn3).toHaveBeenCalledTimes(1)
      expect(fd.fileHandles).toHaveLength(0)
    })

    it('should handle errors during file handle close', async () => {
      const fd = new FDTable()
      
      const errorFn = vi.fn(() => Promise.reject(new Error('Close failed')))
      const successFn = vi.fn(() => Promise.resolve())

      const errorHandle: ZenFSFileHandle = { fd: 3, close: errorFn }
      const successHandle: ZenFSFileHandle = { fd: 4, close: successFn }

      fd.trackFileHandle(errorHandle)
      fd.trackFileHandle(successHandle)

      // Should not throw even if one handle fails to close
      await expect(fd.closeFileHandles()).resolves.toBeUndefined()

      expect(errorFn).toHaveBeenCalledTimes(1)
      expect(successFn).toHaveBeenCalledTimes(1)
      expect(fd.fileHandles).toHaveLength(0)
    })

    it('cleanup() should close file handles', async () => {
      const fd = new FDTable()
      
      const closeFn = vi.fn(() => Promise.resolve())
      const handle: ZenFSFileHandle = { fd: 3, close: closeFn }

      fd.trackFileHandle(handle)
      await fd.cleanup()

      expect(closeFn).toHaveBeenCalledTimes(1)
      expect(fd.fileHandles).toHaveLength(0)
    })

    it('cleanup() should not affect stdin/stdout/stderr', async () => {
      const stdin = new ReadableStream<Uint8Array>()
      const stdout = new WritableStream<Uint8Array>()
      const stderr = new WritableStream<Uint8Array>()

      const fd = new FDTable(stdin, stdout, stderr)
      await fd.cleanup()

      // Standard streams should still be accessible
      expect(fd.stdin).toBe(stdin)
      expect(fd.stdout).toBe(stdout)
      expect(fd.stderr).toBe(stderr)
    })
  })
})

