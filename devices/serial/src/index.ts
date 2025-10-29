/// <reference types="w3c-web-serial" />

import type { DeviceDriver, Device } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

const availablePorts = new Set<SerialPort>()

export const pkg = {
  name: 'serial',
  version: '0.1.0',
  description: 'Web Serial device driver',
  help: `
  Note: This is experimental technology

  Please check the compatibility table at:
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/serial#browser_compatibility

  Usage:
    serial devices                       List paired serial devices
    serial request <options>             Request serial device (blank for user choice)

  Options:
    --help                               Print this help message
    --product                            Product ID of the serial device
    --vendor                             Vendor ID of the serial device
    --version                            Print the version information
  `
}

export async function cli(options: KernelDeviceCLIOptions) {
  const { args, terminal } = options
  
  // Check if Web Serial is available
  if (typeof navigator === 'undefined' || !navigator.serial) {
    terminal.writeln('Error: Client does not support Web Serial')
    return 1
  }

  // Handle commands
  switch (args[0]) {
    case 'devices': {
      const devices = await navigator.serial.getPorts()
      const data = await Promise.all(
        devices.map(async (device, index) => {
          const { usbProductId, usbVendorId } = await device.getInfo()
          return { index, usbProductId, usbVendorId }
        })
      )
      terminal.writeln(JSON.stringify(data, null, 2))
      return 0
    }

    case 'request': {
      const vendorIndex = args.indexOf('--vendor')
      const productIndex = args.indexOf('--product')
      const filter: any = {}
      
      if (vendorIndex !== -1 && args[vendorIndex + 1]) {
        filter.usbVendorId = parseInt(args[vendorIndex + 1] || '')
      }
      if (productIndex !== -1 && args[productIndex + 1]) {
        filter.usbProductId = parseInt(args[productIndex + 1] || '')
      }
      
      try {
        const device = await navigator.serial.requestPort({
          filters: Object.keys(filter).length ? [filter] : []
        })
        terminal.writeln(`Device connected: ${JSON.stringify(await device.getInfo())}`)
        return 0
      } catch (err) {
        terminal.writeln(`Error: Failed to request device: ${err}`)
        return 1
      }
    }

    default:
      terminal.writeln(pkg.help)
      return 0
  }
}

async function createDriver(name: string): Promise<DeviceDriver<KernelDeviceData>> {
  return {
    name,
    init: () => {
      return {
        major: 4,
        minor: 64
      }
    },
    read: (_: Device<KernelDeviceData>, buffer: ArrayBufferView, offset: number, end: number) => {
      navigator.serial.getPorts().then((ports) => {
        const port = ports[offset]
        if (!port) return
        port.readable?.getReader().read().then(({ value, done }) => {
          if (done || !value) return
          const view = new Uint8Array(buffer.buffer)
          const bytesToCopy = Math.min(end, value.length)
          view.set(new Uint8Array(value.buffer, 0, bytesToCopy), offset)
        })
      })
      return end
    },
    write: () => {
      return 0
    }
  }
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<KernelDeviceData>[]> {
  if (typeof navigator === 'undefined' || !navigator.serial) return []
  navigator.serial.addEventListener('connect', async (event) => {
    kernel.events.emit('device:connect', event.target)
    if (event.target && !availablePorts.has(event.target as SerialPort)) {
      availablePorts.add(event.target as SerialPort)
    }

    console.log({ availablePorts })
  })

  const drivers: DeviceDriver<KernelDeviceData>[] = [await createDriver('serial')]
  const ports = await navigator.serial.getPorts()
  for (let i = 0; i < ports.length; i++) drivers.push(await createDriver(`ttyS${i}`))
  return drivers
}
