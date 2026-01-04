import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: fetch [OPTION]... URL
Fetch a resource from the network.

  -o, --output=FILE        write output to FILE instead of stdout
  -X, --method=METHOD      HTTP method to use (default: GET)
  -d, --data=DATA          request body data to send
  -H, --header=HEADER      add custom HTTP header (format: "Name: Value")
  --help                   display this help and exit

Examples:
  fetch https://example.com              fetch and output to stdout
  fetch -o file.txt https://example.com  fetch and save to file.txt
  fetch -X POST -d "data" https://api.example.com  POST request with body`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'fetch',
    description: 'Fetch a resource from the network',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (!process) return 1

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let url: string | undefined
      let outputFile: string | undefined
      let method = 'GET'
      let body: string | undefined
      const headers: Record<string, string> = {}

      // Parse arguments
      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-o' || arg === '--output') {
          const fileArg = argv[i + 1]
          if (!fileArg) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- '${arg === '-o' ? 'o' : 'output'}'`)
            return 1
          }
          outputFile = fileArg
          i++ // Skip the next argument as it's the file value
        } else if (arg.startsWith('--output=')) {
          const outputValue = arg.split('=')[1]
          if (!outputValue) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- 'output'`)
            return 1
          }
          outputFile = outputValue
        } else if (arg === '-X' || arg === '--method') {
          const methodArg = argv[i + 1]
          if (!methodArg) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- '${arg === '-X' ? 'X' : 'method'}'`)
            return 1
          }
          method = methodArg.toUpperCase()
          i++ // Skip the next argument as it's the method value
        } else if (arg.startsWith('--method=')) {
          const methodValue = arg.split('=')[1]
          if (!methodValue) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- 'method'`)
            return 1
          }
          method = methodValue.toUpperCase()
        } else if (arg === '-d' || arg === '--data') {
          const dataArg = argv[i + 1]
          if (!dataArg) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- '${arg === '-d' ? 'd' : 'data'}'`)
            return 1
          }
          body = dataArg
          i++ // Skip the next argument as it's the data value
        } else if (arg.startsWith('--data=')) {
          const dataValue = arg.split('=')[1]
          if (!dataValue) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- 'data'`)
            return 1
          }
          body = dataValue
        } else if (arg === '-H' || arg === '--header') {
          const headerArg = argv[i + 1]
          if (!headerArg) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- '${arg === '-H' ? 'H' : 'header'}'`)
            return 1
          }
          const [name, ...valueParts] = headerArg.split(':')
          if (!name || valueParts.length === 0) {
            await writelnStderr(process, terminal, `fetch: invalid header format. Expected "Name: Value"`)
            return 1
          }
          headers[name.trim()] = valueParts.join(':').trim()
          i++ // Skip the next argument as it's the header value
        } else if (arg.startsWith('--header=')) {
          const headerValue = arg.split('=')[1]
          if (!headerValue) {
            await writelnStderr(process, terminal, `fetch: option requires an argument -- 'header'`)
            return 1
          }
          const [name, ...valueParts] = headerValue.split(':')
          if (!name || valueParts.length === 0) {
            await writelnStderr(process, terminal, `fetch: invalid header format. Expected "Name: Value"`)
            return 1
          }
          headers[name.trim()] = valueParts.join(':').trim()
        } else if (!arg.startsWith('-')) {
          // Positional argument - should be the URL
          if (!url) {
            url = arg
          } else {
            await writelnStderr(process, terminal, `fetch: unexpected argument: ${arg}`)
            return 1
          }
        } else {
          await writelnStderr(process, terminal, `fetch: invalid option -- '${arg.replace(/^-+/, '')}'`)
          await writelnStderr(process, terminal, `Try 'fetch --help' for more information.`)
          return 1
        }
      }

      if (!url) {
        await writelnStderr(process, terminal, `fetch: URL is required`)
        await writelnStderr(process, terminal, `Try 'fetch --help' for more information.`)
        return 1
      }

      try {
        const fetchOptions: RequestInit = { method }
        if (body) fetchOptions.body = body
        if (Object.keys(headers).length > 0) fetchOptions.headers = headers
        
        const response = await globalThis.fetch(url, fetchOptions)
        
        if (!response.ok) {
          await writelnStderr(process, terminal, chalk.red(`fetch: HTTP error! status: ${response.status} ${response.statusText}`))
          return 1
        }

        const reader = response.body?.getReader()
        if (!reader) {
          await writelnStderr(process, terminal, chalk.red(`fetch: No response body`))
          return 1
        }

        let writer: WritableStreamDefaultWriter<Uint8Array> | { write: (chunk: Uint8Array) => Promise<void>, releaseLock: () => Promise<void> } | undefined

        if (outputFile) {
          // Write to file
          const fullPath = path.resolve(shell.cwd, outputFile)
          const fileHandle = await shell.context.fs.promises.open(fullPath, 'w')
          writer = {
            write: async (chunk: Uint8Array) => {
              await fileHandle.write(chunk)
            },
            releaseLock: async () => {
              await fileHandle.close()
            }
          }
        } else {
          // Write to stdout
          if (!process.stdout) {
            await writelnStderr(process, terminal, chalk.red(`fetch: No stdout available`))
            return 1
          }
          writer = process.stdout.getWriter()
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value && value.length > 0) await writer.write(value)
          }
        } finally {
          reader.releaseLock()
          if (writer && 'releaseLock' in writer) await writer.releaseLock()
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`fetch: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }
  })
}
