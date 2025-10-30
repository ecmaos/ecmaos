import { beforeAll, describe, it, expect } from 'vitest'

import { Kernel } from '#kernel.ts'
import { DefaultFilesystemOptions } from '#filesystem.ts'
import { Process, ProcessManager } from '#processes.ts'
import { TestDomOptions, TestLogOptions } from './fixtures/kernel.fixtures'

import { ProcessEvents } from '@ecmaos/types'
import type { ProcessEntryParams, ProcessExitEvent } from '@ecmaos/types'

describe('Process Manager', () => {
  let kernel: Kernel

  beforeAll(() => {
    kernel = new Kernel({
      devices: {},
      dom: TestDomOptions,
      filesystem: DefaultFilesystemOptions,
      log: TestLogOptions
    })
  })

  it('should instantiate a process manager', () => {
    expect(new ProcessManager()).toBeInstanceOf(ProcessManager)
  })

  it('should manage the lifetime of a process', async () => {
    const canaryCode = Math.floor(Math.random() * 100)
    const process = new Process({
      entry: (params: ProcessEntryParams) => new Promise(resolve => {
        params.terminal.write('entry')
        setTimeout(() => resolve(canaryCode), 200)
      }),
      uid: 0,
      gid: 0,
      kernel,
      shell: kernel.shell,
      terminal: kernel.terminal
    })

    kernel.processes.add(process)
    process.start()
    expect(kernel.processes.get(process.pid)?.status).toEqual('running')

    return new Promise((resolve, reject) => {
      process.events.on<ProcessExitEvent>(ProcessEvents.EXIT, ({ pid, code }) => {
        if (code !== canaryCode) return reject(`Process exited with invalid code; expected ${canaryCode} but got ${code}`)
        if (kernel.processes.get(pid)) return reject('Process was not removed from the manager')
        resolve(code)
      })
    })
  })
})
