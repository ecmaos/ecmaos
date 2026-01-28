import type { DeviceDriver, Device } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData, Shell } from '@ecmaos/types'

export const pkg = {
  name: 'tty',
  version: '0.1.0',
  description: 'TTY pseudo-device drivers for /dev/ttyN'
}

class TTYReadBuffer {
  private buffer: Uint8Array[] = []
  private maxSize: number = 1024 * 1024
  private currentSize: number = 0

  append(data: Uint8Array): void {
    this.buffer.push(data)
    this.currentSize += data.length

    while (this.currentSize > this.maxSize && this.buffer.length > 0) {
      const removed = this.buffer.shift()
      if (removed) this.currentSize -= removed.length
    }
  }

  read(target: ArrayBufferView, offset: number, length: number): number {
    if (this.buffer.length === 0) return 0

    let bytesRead = 0
    const targetView = new Uint8Array(target.buffer, target.byteOffset + offset, length)

    while (bytesRead < length && this.buffer.length > 0) {
      const chunk = this.buffer[0]
      if (!chunk) break
      
      const remaining = length - bytesRead
      const toCopy = Math.min(remaining, chunk.length)

      targetView.set(chunk.subarray(0, toCopy), bytesRead)
      bytesRead += toCopy

      if (toCopy === chunk.length) {
        this.buffer.shift()
        this.currentSize -= chunk.length
      } else {
        this.buffer[0] = chunk.subarray(toCopy)
        this.currentSize -= toCopy
      }
    }

    return bytesRead
  }

  clear(): void {
    this.buffer = []
    this.currentSize = 0
  }

  get size(): number {
    return this.currentSize
  }
}

const ttyBuffers = new Map<number, TTYReadBuffer>()
const bufferedTerminals = new WeakSet<Shell['terminal']>()

function getOrCreateBuffer(ttyNumber: number): TTYReadBuffer {
  if (!ttyBuffers.has(ttyNumber)) ttyBuffers.set(ttyNumber, new TTYReadBuffer())
  return ttyBuffers.get(ttyNumber)!
}

function setupTTYOutputBuffering(kernel: Kernel, ttyNumber: number): void {
  const shell = kernel.getShell(ttyNumber)
  if (!shell || !shell.terminal) return

  const terminal = shell.terminal
  const buffer = getOrCreateBuffer(ttyNumber)

  if (bufferedTerminals.has(terminal)) return

  const originalWrite = terminal.write.bind(terminal)
  const originalWriteln = terminal.writeln.bind(terminal)

  terminal.write = function(data: string | Uint8Array) {
    const result = originalWrite(data)
    if (typeof data === 'string') {
      buffer.append(new TextEncoder().encode(data))
    } else {
      buffer.append(data)
    }
    return result
  }

  terminal.writeln = function(data: string | Uint8Array) {
    const result = originalWriteln(data)
    const newline = new TextEncoder().encode('\n')
    if (typeof data === 'string') {
      buffer.append(new TextEncoder().encode(data + '\n'))
    } else {
      const combined = new Uint8Array(data.length + 1)
      combined.set(data)
      combined.set(newline, data.length)
      buffer.append(combined)
    }
    return result
  }

  bufferedTerminals.add(terminal)
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<KernelDeviceData>[]> {
  const drivers: DeviceDriver<KernelDeviceData>[] = []

  // TODO: support for more than 10 TTYs coming soon
  for (let ttyNumber = 0; ttyNumber <= 9; ttyNumber++) {
    const deviceName = `tty${ttyNumber}`
    
    drivers.push({
      name: deviceName,
      singleton: true,
      init: () => {
        return {
          major: 4,
          minor: ttyNumber,
          data: {
            ttyNumber,
            kernelId: kernel.id
          }
        }
      },
      read: (file: Device<KernelDeviceData>, buffer: ArrayBufferView, offset: number, end: number) => {
        const ttyNumber = file.data?.ttyNumber as number | undefined
        if (ttyNumber === undefined) return 0

        const shell = kernel.getShell(ttyNumber)
        if (!shell || !shell.terminal) return 0

        setupTTYOutputBuffering(kernel, ttyNumber)
        const readBuffer = getOrCreateBuffer(ttyNumber)
        const length = end - offset
        return readBuffer.read(buffer, offset, length)
      },
      write: (file: Device<KernelDeviceData>, buffer: ArrayBufferView, offset: number) => {
        const ttyNumber = file.data?.ttyNumber as number | undefined
        if (ttyNumber === undefined) return 0

        const bufferView = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, buffer.byteLength - offset)
        const text = new TextDecoder().decode(bufferView)
        
        let shell = kernel.getShell(ttyNumber)
        if (!shell || !shell.terminal) {
          const terminalContainer = document.getElementById(`terminal-tty${ttyNumber}`)
          if (terminalContainer) {
            kernel.createShell(ttyNumber).then((createdShell) => {
              if (createdShell && createdShell.terminal) {
                createdShell.terminal.write(text)
                createdShell.terminal.dispatchStdin(text)
              }
            }).catch(() => {})
          }
          return bufferView.length
        }
        
        shell.terminal.write(text)
        shell.terminal.dispatchStdin(text)
        
        return bufferView.length
      }
    })
  }

  return drivers
}
