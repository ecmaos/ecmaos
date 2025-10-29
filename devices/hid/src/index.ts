/// <reference types="w3c-web-hid" />

import ansi from 'ansi-escape-sequences'
import type { DeviceDriver, Device } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

export const pkg = {
  name: 'hid',
  version: '0.1.0',
  description: 'Human Interface Device (HID) driver'
}

export async function cli(options: KernelDeviceCLIOptions) {
  const { args, terminal } = options

  const usage = `
Usage: /dev/hid <command>

Commands:
  list                List available HID devices
  request             Request a new HID device connection
  connect <id>        Connect to a specific device
  disconnect <id>     Disconnect from a specific device
  info <id>           Show information about a connected device
  read <id>           Read from a device
  write <id> <data>   Write data to a device
  --help              Show this help message
`

  if (!('hid' in navigator)) {
    terminal.writeln('WebHID API not available')
    return 1
  }

  if (!args.length || args[0] === '--help') {
    terminal.writeln(usage)
    return 0
  }

  try {
    switch(args[0]) {
      case 'list':
        const devices = await navigator.hid.getDevices()
        const uniqueDevices = Array.from(new Map(devices.map(d => [d.productId, d])).values())
        
        if (!uniqueDevices.length) {
          terminal.writeln('No HID devices connected')
          break
        }
        
        terminal.writeln(`${ansi.style.bold}🎮 Connected HID Devices:${ansi.style.reset}`)
        uniqueDevices.forEach(device => {
          terminal.writeln(`
      📱 Device ID: ${ansi.style.cyan}${device.productId}${ansi.style.reset}
      📝 Name: ${ansi.style.cyan}${device.productName}${ansi.style.reset}
      🏢 Manufacturer: ${ansi.style.cyan}${device.vendorId}${ansi.style.reset}
      🔌 Connected: ${ansi.style.cyan}${device.opened ? 'Yes' : 'No'}${ansi.style.reset}`)
        })
        break

      case 'request':
        const device = await navigator.hid.requestDevice({
          filters: [] // Accept all devices
        })
        terminal.writeln(`Device requested: ${device[0]?.productName || 'No device selected'}`)
        break

      case 'connect':
        if (!args[1]) {
          terminal.writeln('Please provide a device ID')
          return 1
        }
        const connectDevices = await navigator.hid.getDevices()
        const deviceToConnect = connectDevices.find(d => d.productId === Number(args[1]))
        if (!deviceToConnect) {
          terminal.writeln(`Device with ID ${args[1]} not found`)
          return 1
        }
        
        if (deviceToConnect.opened) {
          terminal.writeln('Device is already connected')
          return 0
        }

        await deviceToConnect.open()
        terminal.writeln(`Connected to device: ${deviceToConnect.productName}`)
        break

      case 'disconnect':
        if (!args[1]) {
          terminal.writeln('Please provide a device ID')
          return 1
        }
        const disconnectDevices = await navigator.hid.getDevices()
        const deviceToDisconnect = disconnectDevices.find(d => d.productId === Number(args[1]))
        if (!deviceToDisconnect) {
          terminal.writeln(`Device with ID ${args[1]} not found`)
          return 1
        }
        
        if (!deviceToDisconnect.opened) {
          terminal.writeln('Device is already disconnected')
          return 0
        }

        await deviceToDisconnect.close()
        terminal.writeln(`Disconnected from device: ${deviceToDisconnect.productName}`)
        break

      case 'info':
        if (!args[1]) {
          terminal.writeln('Please provide a device ID')
          return 1
        }
        const devices2 = await navigator.hid.getDevices()
        const targetDevice = devices2.find(d => d.productId === Number(args[1]))
        if (!targetDevice) {
          terminal.writeln(`Device with ID ${args[1]} not found`)
          return 1
        }
        terminal.writeln(`${ansi.style.bold}Device Information:${ansi.style.reset}
      Product ID: ${targetDevice.productId}
      Vendor ID: ${targetDevice.vendorId}
      Product Name: ${targetDevice.productName}
      Connected: ${targetDevice.opened}`)
        break

      default:
        terminal.writeln(`Unknown command: ${args[0]}`)
        terminal.writeln(usage)
        return 1
    }

    return 0
  } catch (error) {
    terminal.writeln(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<KernelDeviceData>[]> {
  const deviceMap = new Map<number, HIDDevice>()
  const drivers: DeviceDriver<KernelDeviceData>[] = [{
    name: 'hid',
    init: () => ({
      major: 13,
      minor: 64,
      data: {
        kernelId: kernel.id,
        version: pkg.version
      }
    }),
    read: (_: Device<KernelDeviceData>, buffer: ArrayBufferView) => {
      const view = new Uint32Array(buffer.buffer, 0, 1)
      view[0] = deviceMap.size
      return 4
    },
    write: () => 0
  }]

  if ('hid' in navigator) {
    // Get initially connected devices
    try {
      const devices = await navigator.hid.getDevices()
      devices.forEach(device => deviceMap.set(device.productId, device))
    } catch (error) {
      console.warn('HID error:', error)
    }

    // Listen for device connect/disconnect events
    navigator.hid.addEventListener('connect', (event) => {
      deviceMap.set(event.device.productId, event.device)
    })

    navigator.hid.addEventListener('disconnect', (event) => {
      deviceMap.delete(event.device.productId)
    })

    for (const device of deviceMap.values()) {
      drivers.push({
        name: `hid-${device.productName}-${device.vendorId}-${device.productId}`,
        init: () => ({
          major: 13,
          minor: 64 + drivers.length,
          data: {
            kernelId: kernel.id,
            version: pkg.version
          }
        }),
        read: () => 0,
        write: () => 0
      })
    }
  }

  return drivers
}
