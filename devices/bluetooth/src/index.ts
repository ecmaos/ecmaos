/// <reference types="@types/web-bluetooth" />

import type { DeviceDriver } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

export const pkg = {
  name: 'bluetooth',
  version: '0.1.0',
  description: 'Web Bluetooth API device driver'
}

export async function cli(options: KernelDeviceCLIOptions) {
  const { args, terminal, kernel } = options

  if (!navigator?.bluetooth) {
    terminal.writeln('Bluetooth API not available')
    return 1
  }

  async function ensureBluetoothPermission(): Promise<boolean> {
    if (kernel.storage.local.getItem('permission:bluetooth') === '1') return true
    if (kernel.storage.session.getItem('hide:permission:bluetooth') === '1') return false

    return new Promise((resolve) => {
      const win = kernel.windows.create({
        id: 'bluetooth-permission',
        title: 'Bluetooth Permission',
        modal: true,
        height: 250,
        html: `
          <p style='font-weight:bold; text-align:center'>Do you want to enable Bluetooth?</p>
          <button class="request-permission-bluetooth btn-success">Enable Bluetooth</button>
          <button class="request-permission-bluetooth-cancel btn-cancel">Cancel</button>
        `
      })

      // TODO: Proper fix
      // @ts-expect-error
      win.dom.querySelector('.request-permission-bluetooth').addEventListener('click', async () => {
        try {
          await navigator.bluetooth.requestDevice({ acceptAllDevices: true })
          kernel.storage.local.setItem('permission:bluetooth', '1')
          win.close()
          resolve(true)
        } catch (error) {
          kernel.log.error('Error requesting Bluetooth device', error)
          kernel.storage.session.removeItem('permission:bluetooth')
          // kernel.storage.session.setItem('hide:permission:bluetooth', '1')
          win.close()

          const dialog = kernel.windows.dialog({
            title: '⚠️ Error',
            height: 250,
            html: `
              <p>Error requesting Bluetooth device</p>
              <code>${error}</code>
              <button class="request-permission-bluetooth-error-close btn-cancel">Close</button>
            `
          })

          // TODO: Proper fix
          // @ts-expect-error
          dialog.dom.querySelector('.request-permission-bluetooth-error-close').addEventListener('click', () => dialog.close())
          resolve(false)
        }
      })

      // TODO: Proper fix
      // @ts-expect-error
      win.dom.querySelector('.request-permission-bluetooth-cancel').addEventListener('click', () => {
        win.close()
        resolve(false)
      })
    })
  }

  if (args[0] !== '--help' && !(await ensureBluetoothPermission())) {
    terminal.writeln('Bluetooth permission denied')
    return 1
  }

  const usage = `
Usage: /dev/bluetooth <command>

Commands:
  scan [service]           Scan for Bluetooth devices, optionally filtering by service UUID
  connect <id>             Connect to a specific Bluetooth device by ID
  disconnect <id>          Disconnect from a specific Bluetooth device
  services <id>            List services available on connected device
  characteristics <id>     List characteristics for a service
  read <id> <char>         Read value from characteristic
  write <id> <char> <val>  Write value to characteristic
  notify <id> <char>       Subscribe to notifications from characteristic
  list                     List connected devices
  --help                   Show this help message
`

  if (!args.length || args[0] === '--help') {
    terminal.writeln(usage)
    return 0
  }

  try {
    switch (args[0]) {
      case 'scan': {
        const filters = []
        if (args[1]) {
          filters.push({ services: [args[1]] })
        }
        
        try {
          terminal.writeln('Requesting Bluetooth device...')
          const device = await navigator.bluetooth.requestDevice({ 
            filters: filters.length ? filters : undefined,
            acceptAllDevices: !filters.length,
            optionalServices: ['generic_access']
          })
          
          if (!device) {
            terminal.writeln('No device selected')
            return 1
          }
          
          terminal.writeln(`Found device: ${device.name || 'Unnamed'} (${device.id})`)
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            terminal.writeln('No Bluetooth devices found or user cancelled')
            return 1
          }
          throw error
        }
        break
      }

      case 'connect': {
        if (!args[1]) {
          terminal.writeln('Device ID required')
          return 1
        }
        const device = await navigator.bluetooth.requestDevice({ 
          filters: [{ services: [args[1]] }]
        })
        await device.gatt?.connect()
        terminal.writeln(`Connected to ${device.name || 'Unnamed'}`)
        break
      }

      case 'disconnect': {
        if (!args[1]) {
          terminal.writeln('Device ID required') 
          return 1
        }
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [args[1]] }]
        })
        await device.gatt?.disconnect()
        terminal.writeln(`Disconnected from ${device.name || 'Unnamed'}`)
        break
      }

      case 'services': {
        if (!args[1]) {
          terminal.writeln('Device ID required')
          return 1
        }
        
        try {
          // First try to get the device from already paired devices
          const devices = await navigator.bluetooth.getDevices()
          const device = devices.find(d => d.id === args[1])
          
          if (!device) {
            terminal.writeln('Device not found. Make sure it was previously paired using the scan command')
            return 1
          }
          
          const server = await device.gatt?.connect()
          if (!server) {
            terminal.writeln('Could not connect to device')
            return 1
          }
          
          const services = await server.getPrimaryServices()
          terminal.writeln('Available services:')
          services?.forEach(service => {
            terminal.writeln(`  ${service.uuid}`)
          })
        } catch (error) {
          terminal.writeln(`Error getting services: ${error instanceof Error ? error.message : String(error)}`)
          return 1
        }
        break
      }

      case 'characteristics': {
        if (!args[1] || !args[2]) {
          terminal.writeln('Device ID and service UUID required')
          return 1
        }
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [args[1]] }]
        })
        const server = await device.gatt?.connect()
        const service = await server?.getPrimaryService(args[2])
        const characteristics = await service?.getCharacteristics()
        terminal.writeln('Available characteristics:')
        characteristics?.forEach(char => {
          terminal.writeln(`  ${char.uuid}`)
        })
        break
      }

      case 'read': {
        if (!args[1] || !args[2] || !args[3]) {
          terminal.writeln('Device ID, service UUID and characteristic UUID required')
          return 1
        }
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [args[1]] }]
        })
        const server = await device.gatt?.connect()
        const service = await server?.getPrimaryService(args[2])
        const characteristic = await service?.getCharacteristic(args[3])
        const value = await characteristic?.readValue()
        terminal.writeln(`Value: ${new TextDecoder().decode(value)}`)
        break
      }

      case 'write': {
        if (!args[1] || !args[2] || !args[3] || !args[4]) {
          terminal.writeln('Device ID, service UUID, characteristic UUID and value required')
          return 1
        }
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [args[1]] }]
        })
        const server = await device.gatt?.connect()
        const service = await server?.getPrimaryService(args[2])
        const characteristic = await service?.getCharacteristic(args[3])
        await characteristic?.writeValue(new TextEncoder().encode(args[4]))
        terminal.writeln('Value written successfully')
        break
      }

      case 'notify': {
        if (!args[1] || !args[2] || !args[3]) {
          terminal.writeln('Device ID, service UUID and characteristic UUID required')
          return 1
        }
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [args[1]] }]
        })
        const server = await device.gatt?.connect()
        const service = await server?.getPrimaryService(args[2])
        const characteristic = await service?.getCharacteristic(args[3])
        await characteristic?.startNotifications()
        characteristic?.addEventListener('characteristicvaluechanged', (event) => {
          const value = (event.target as BluetoothRemoteGATTCharacteristic).value
          terminal.writeln(`Notification: ${new TextDecoder().decode(value)}`)
        })
        terminal.writeln('Listening for notifications...')
        break
      }

      case 'list': {
        const devices = await navigator.bluetooth.getDevices()
        if (!devices.length) {
          terminal.writeln('No connected devices')
          return 0
        }
        terminal.writeln('Connected devices:')
        devices.forEach(device => {
          terminal.writeln(`  ${device.name || 'Unnamed'} (${device.id})`)
        })
        break
      }

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
  const drivers: DeviceDriver<KernelDeviceData>[] = [{
    name: 'bluetooth',
    init: () => ({
      major: 216,
      minor: 0,
      data: { 
        kernelId: kernel.id,
        available: !!navigator?.bluetooth
      }
    }),
    read: () => {
      // TODO: Implement reading from connected Bluetooth device
      return 0
    },
    write: () => {
      // TODO: Implement writing to connected Bluetooth device
      return 0
    }
  }]

  return drivers
}
