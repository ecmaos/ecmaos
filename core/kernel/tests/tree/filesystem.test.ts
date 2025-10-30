
import { beforeAll, describe, expect, it } from 'vitest'

import { DefaultFilesystemOptions } from '#filesystem.ts'
import { Kernel } from '#kernel.ts'

describe('Filesystem', async () => {
  let kernel: Kernel

  beforeAll(async () => {
    kernel = new Kernel({
      credentials: { username: 'root', password: 'root' },
      devices: {},
      dom: { topbar: false },
      filesystem: DefaultFilesystemOptions
    })
    await kernel.boot()
  })

  it('should be defined', () => {
    expect(kernel.filesystem).toBeDefined()
    expect(kernel.filesystem.fs).toBeDefined()
  })

  it('should write file', async () => {
    await kernel.filesystem.fs.writeFile('/tmp/test.txt', 'test')
    const file = await kernel.filesystem.fs.readFile('/tmp/test.txt', 'utf-8')
    expect(file).toBe('test')
  })

  it('should read file', async () => {
    const file = await kernel.filesystem.fs.readFile('/tmp/test.txt', 'utf-8')
    expect(file).toBe('test')
  })

  it('should delete file', async () => {
    await kernel.filesystem.fs.unlink('/tmp/test.txt')
    await expect(kernel.filesystem.fs.readFile('/tmp/test.txt')).rejects.toThrow()
  })

  it('should create directory', async () => {
    await kernel.filesystem.fs.mkdir('/tmp/test')
    await kernel.filesystem.fs.writeFile('/tmp/test/test.txt', 'test')
    const file = await kernel.filesystem.fs.readFile('/tmp/test/test.txt', 'utf-8')
    expect(file).toBe('test')
  })

  it('should read directory', async () => {
    const files = await kernel.filesystem.fs.readdir('/tmp/test')
    expect(files).toEqual(['test.txt'])
  })

  it('should not delete non-empty directory', async () => {
    await expect(kernel.filesystem.fs.rmdir('/tmp/test')).rejects.toThrow()

    const contents = await kernel.filesystem.fs.readdir('/tmp/test')
    for (const content of contents) await kernel.filesystem.fs.unlink(`/tmp/test/${content}`)

    await kernel.filesystem.fs.rmdir('/tmp/test')
    await expect(kernel.filesystem.fs.readdir('/tmp/test')).rejects.toThrow()
  })
})
