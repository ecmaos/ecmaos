import { vi } from 'vitest'
import { Buffer } from 'node:buffer'
import 'fake-indexeddb/auto'
import 'vitest-canvas-mock'

globalThis.Buffer = Buffer

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

Object.defineProperty(window, 'Notification', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    permission: 'granted',
    requestPermission: vi.fn(),
  }))
})

Object.defineProperty(window, 'navigator', {
  writable: true,
  value: {
    registerProtocolHandler: vi.fn(),
    usb: {
      getDevices: vi.fn(() => Promise.resolve([])),
    },
  }
})

// JSDom + Vitest don't play well with each other. Long story short - default
// TextEncoder produces Uint8Array objects that are _different_ from the global
// Uint8Array objects, so some functions that compare their types explode.
// https://github.com/vitest-dev/vitest/issues/4043#issuecomment-1905172846
// https://github.com/vitest-dev/vitest/issues/4043#issuecomment-2383567554
class ESBuildAndJSDOMCompatibleTextEncoder extends TextEncoder {
  constructor() {
    super()
  }

  override encode(input: string) {
    if (typeof input !== 'string') {
      throw new TypeError('`input` must be a string')
    }

    const decodedURI = decodeURIComponent(encodeURIComponent(input))
    const arr = new Uint8Array(decodedURI.length)
    const chars = decodedURI.split('')
    for (let i = 0; i < chars.length; i++) {
      arr[i] = decodedURI[i]!.charCodeAt(0)
    }
    return arr
  }
}

global.TextEncoder = ESBuildAndJSDOMCompatibleTextEncoder
