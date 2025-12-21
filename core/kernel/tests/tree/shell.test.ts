import { describe, expect, it } from 'vitest'

import { Kernel } from '#kernel.ts'
import { DefaultFilesystemOptions } from '#filesystem.ts'

import { TestDomOptions, TestLogOptions } from './fixtures/kernel.fixtures'

describe('Shell', () => {
  it('should initialize and execute commands', async () => {
    const kernel = new Kernel({
      dom: TestDomOptions,
      filesystem: DefaultFilesystemOptions,
      log: TestLogOptions,
      credentials: { username: 'root', password: 'root' }
    })
    await kernel.boot()
    expect(kernel.shell).toBeDefined()
  })
})
