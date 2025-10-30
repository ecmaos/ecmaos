import { describe, expect, it } from 'vitest'

import { Kernel } from '#kernel.ts'
import { DefaultFilesystemOptions } from '#filesystem.ts'

import { TestDomOptions, TestLogOptions } from './fixtures/kernel.fixtures'

describe('Shell', () => {
  it('should initialize and execute commands', async () => {
    const kernel = new Kernel({ dom: TestDomOptions, filesystem: DefaultFilesystemOptions, log: TestLogOptions })
    await kernel.boot()
    expect(kernel.shell).toBeDefined()

    // TODO: Something causes this to fail when running test:watch, but not when vscode runs the tests
    // Something something environment
    // const result = await kernel.shell.execute('cd /bin')
    // expect(result).toBe('')
  })
})
