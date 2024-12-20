import type { Kernel, Shell, Terminal } from '@ecmaos/types'

declare global {
  var kernel: Kernel | undefined // eslint-disable-line no-var
  var kernels: Map<string, Kernel> | undefined // eslint-disable-line no-var
  var shells: Map<string, Shell> | undefined // eslint-disable-line no-var
  var terminals: Map<string, Terminal> | undefined // eslint-disable-line no-var
  var requiremap: Map<string, { // eslint-disable-line no-var
    command: string
    code: string
    filePath: string
    binLink: string
    argv: string[]
    argv0: string
  }> | undefined

  interface Navigator {
    userAgentData: NavigatorUAData | null
  }
}

export type Timer = ReturnType<typeof setInterval>
