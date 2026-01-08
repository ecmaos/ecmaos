import type { Kernel, ProtocolOptions } from '@ecmaos/types'

export class Protocol {
  private _kernel: Kernel

  get kernel() { return this._kernel }

  constructor(options: ProtocolOptions) {
    this._kernel = options.kernel

    globalThis.navigator?.registerProtocolHandler?.(
      import.meta.env.ECMAOS_APP_PROTOCOL || options.schema || 'web+ecmaos',
      `${import.meta.env.ECMAOS_APP_URL || window.location.origin}?protocol=%s`
    )
  }

  open(uri: string) {
    this.kernel.terminal.writeln(`Opening ${uri}`)
  }
}
