import type { DeviceDriver, DeviceFile } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

export const pkg = {
  name: 'echo',
  version: '0.1.0',
  description: ''
}

export async function cli(options: KernelDeviceCLIOptions) {
  options.kernel.log.debug(`${pkg.name} CLI`, options.args)
  return 0
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<KernelDeviceData>[]> {
  const drivers: DeviceDriver<KernelDeviceData>[] = [{
    name: 'echo',
    init: () => ({ major: 5, minor: 1 }),
    read: (file: DeviceFile, buffer: ArrayBufferView, offset: number, length: number, position: number) => 0,
    write: (file: DeviceFile, buffer: ArrayBufferView, offset: number, length: number, position: number) => {
      const data = buffer.buffer.slice(offset, offset + length)
      const text = new TextDecoder().decode(data)
      kernel.terminal?.write(text)
      return length
    }
  }]

  return drivers
}
