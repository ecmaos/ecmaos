import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: nc [OPTIONS] <host> [port]
       nc [OPTIONS] -u <url>

Netcat - network utility for reading from and writing to network connections.

Options:
  -u, --url <url>    Direct URL (ws://, wss://, or https://)
  -p, --port <port> Port number (for WebSocket, defaults to 80/443)
  --help             display this help and exit

Examples:
  nc echo.websocket.org
  nc -p 443 echo.websocket.org
  nc -u wss://echo.websocket.org
  nc -u https://example.com:443`
  writelnStdout(process, terminal, usage)
}

interface ConnectionOptions {
  url: string
  useWebSocket: boolean
  useWebTransport: boolean
}

function parseUrl(args: string[]): ConnectionOptions | null {
  let url: string | undefined
  let host: string | undefined
  let port: number | undefined
  let useUrlFlag = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === undefined) continue

    if (arg === '-u' || arg === '--url') {
      useUrlFlag = true
      if (i + 1 < args.length) {
        i++
        url = args[i]
      } else {
        return null
      }
    } else if (arg === '-p' || arg === '--port') {
      if (i + 1 < args.length) {
        i++
        const portStr = args[i]
        if (portStr !== undefined) {
          port = parseInt(portStr, 10)
          if (isNaN(port)) return null
        }
      } else {
        return null
      }
    } else if (!arg.startsWith('-')) {
      if (!host) {
        host = arg
      } else if (!port) {
        port = parseInt(arg, 10)
        if (isNaN(port)) return null
      }
    }
  }

  if (useUrlFlag) {
    if (!url) return null
    const useWebSocket = url.startsWith('ws://') || url.startsWith('wss://')
    const useWebTransport = url.startsWith('https://') && 'WebTransport' in globalThis
    return { url, useWebSocket, useWebTransport }
  }

  if (!host) return null

  if (host.startsWith('http://') || host.startsWith('https://') || host.startsWith('ws://') || host.startsWith('wss://')) {
    const useWebSocket = host.startsWith('ws://') || host.startsWith('wss://')
    const useWebTransport = host.startsWith('https://') && 'WebTransport' in globalThis
    return { url: host, useWebSocket, useWebTransport }
  }

  if (port === undefined) {
    port = 80
  }

  const protocol = port === 443 ? 'wss' : 'ws'
  let constructedUrl: string
  if (port === 80 && protocol === 'ws') {
    constructedUrl = `${protocol}://${host}`
  } else if (port === 443 && protocol === 'wss') {
    constructedUrl = `${protocol}://${host}`
  } else {
    constructedUrl = `${protocol}://${host}:${port}`
  }
  return {
    url: constructedUrl,
    useWebSocket: true,
    useWebTransport: false
  }
}

async function connectWebSocket(
  url: string,
  process: Process,
  kernel: Kernel,
  terminal: Terminal
): Promise<number> {
  return new Promise((resolve) => {
    let interrupted = false
    let connection: ReturnType<typeof kernel.sockets.get> | null = null
    let stdinReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let stdoutWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
    let wsClosed = false
    let connectionOpened = false
    let messagesReceived = 0
    let ctrlCListener: { dispose: () => void } | null = null

    const interruptHandler = () => {
      interrupted = true
      if (ctrlCListener) {
        ctrlCListener.dispose()
        ctrlCListener = null
      }
      if (connection && connection.type === 'websocket') {
        const ws = connection.socket
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Interrupted by user')
        }
      }
      if (stdinReader) {
        stdinReader.cancel()
      }
      if (stdoutWriter) {
        stdoutWriter.releaseLock()
      }
      kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      
      terminal.listen()
      terminal.write('\n')
      
      if (!wsClosed) {
        wsClosed = true
        resolve(1)
      }
    }

    kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

    kernel.sockets.createWebSocket(url)
      .then((conn) => {
        if (interrupted) {
          conn.close()
          return
        }

        connection = conn
        const ws = conn.socket
        connectionOpened = true
        stdoutWriter = process.stdout.getWriter()

        terminal.clearCommand()
        terminal.unlisten()

        ctrlCListener = terminal.onKey(({ domEvent }) => {
          if (domEvent.ctrlKey && domEvent.key === 'c') {
            domEvent.preventDefault()
            domEvent.stopPropagation()
            kernel.terminal.events.dispatch(TerminalEvents.INTERRUPT, { terminal })
          }
        })

        if (process.stdin) {
          stdinReader = process.stdin.getReader()

          const readStdin = async () => {
            try {
              while (!interrupted && !wsClosed) {
                const { done, value } = await stdinReader!.read()
                if (done) {
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.close(1000, 'Stdin closed')
                  }
                  break
                }
                if (ws.readyState === WebSocket.OPEN && value) {
                  try {
                    ws.send(value)
                  } catch (error) {
                    if (!interrupted) {
                      writelnStderr(process, terminal, `Error sending data: ${error instanceof Error ? error.message : 'Unknown error'}`)
                    }
                    break
                  }
                } else if (wsClosed || ws.readyState === WebSocket.CLOSED) {
                  break
                }
              }
            } catch (error) {
              if (!interrupted) {
                writelnStderr(process, terminal, `Error reading stdin: ${error instanceof Error ? error.message : 'Unknown error'}`)
              }
            } finally {
              if (stdinReader) {
                stdinReader.releaseLock()
              }
            }
          }

          readStdin().catch(() => {})
        }

        ws.onmessage = async (event) => {
          if (interrupted || wsClosed || !stdoutWriter) return

          try {
            messagesReceived++
            let data: Uint8Array
            if (event.data instanceof ArrayBuffer) {
              data = new Uint8Array(event.data)
            } else if (event.data instanceof Blob) {
              const arrayBuffer = await event.data.arrayBuffer()
              data = new Uint8Array(arrayBuffer)
            } else {
              const encoder = new TextEncoder()
              data = encoder.encode(event.data as string)
            }
            await stdoutWriter.write(data)
          } catch (error) {
            if (!interrupted && !wsClosed) {
              writelnStderr(process, terminal, `Error writing to stdout: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }
        }

        ws.onclose = (event) => {
          if (wsClosed) return
          wsClosed = true
          
          if (ctrlCListener) {
            ctrlCListener.dispose()
          }
          if (stdinReader) {
            stdinReader.cancel().catch(() => {})
          }
          if (stdoutWriter) {
            stdoutWriter.releaseLock()
          }
          
          kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
          
          if (!interrupted) {
            if (!connectionOpened) {
              const reason = event.reason || `Connection failed (code: ${event.code})`
              writelnStderr(process, terminal, reason)
            } else if (event.code !== 1000 && event.code !== 1001 && event.code !== 1005 && event.code !== 1006) {
              if (event.reason) {
                writelnStderr(process, terminal, `Connection closed: ${event.reason}`)
              }
            }
            
            terminal.listen()
            terminal.write('\n')
            
            const isNormalClose = event.code === 1000 || event.code === 1001 || event.code === 1005 || 
                                 (event.code === 1006 && connectionOpened && messagesReceived > 0)
            resolve(isNormalClose ? 0 : 1)
          } else {
            terminal.listen()
            terminal.write('\n')
            resolve(1)
          }
        }
      })
      .catch((error) => {
        if (!interrupted) {
          writelnStderr(process, terminal, `Failed to create WebSocket: ${error instanceof Error ? error.message : 'Unknown error'}`)
          kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
          
          terminal.listen()
          terminal.write('\n')
          
          resolve(1)
        }
      })
  })
}

async function connectWebTransport(
  url: string,
  process: Process,
  kernel: Kernel,
  terminal: Terminal
): Promise<number> {
  let interrupted = false
  let connection: ReturnType<typeof kernel.sockets.get> | null = null
  let stdoutWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
  let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  let streamWriter: WritableStreamDefaultWriter<Uint8Array> | null = null
  let keyListener: { dispose: () => void } | null = null

  const interruptHandler = () => {
    interrupted = true
    if (keyListener) {
      keyListener.dispose()
      keyListener = null
    }
    if (streamWriter) {
      streamWriter.close().catch(() => {})
    }
    if (connection) {
      connection.close().catch(() => {})
    }
  }

  kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

  try {
    connection = await kernel.sockets.createWebTransport(url)

    if (interrupted) {
      await connection.close()
      kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      
      terminal.listen()
      terminal.write('\n')
      
      return 1
    }

    const transport = connection.transport
    const bidirectionalStream = await transport.createBidirectionalStream()
    
    if (interrupted) {
      await connection.close()
      kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
      
      terminal.listen()
      terminal.write('\n')
      
      return 1
    }
    
    streamReader = bidirectionalStream.readable.getReader()
    streamWriter = bidirectionalStream.writable.getWriter()

    stdoutWriter = process.stdout.getWriter()

    terminal.clearCommand()
    terminal.unlisten()

    const encoder = new TextEncoder()

    keyListener = terminal.onKey(async ({ domEvent }) => {
      if (interrupted || !streamWriter) return

      const key = domEvent.key
      
      if (domEvent.ctrlKey && key === 'c') {
        return
      }

      domEvent.preventDefault()
      domEvent.stopPropagation()

      if (key === 'Enter') {
        try {
          await streamWriter.write(encoder.encode('\n'))
          terminal.write('\n')
        } catch (error) {
          if (!interrupted) {
            await writelnStderr(process, terminal, `Error sending data: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }
      } else if (key.length === 1) {
        try {
          await streamWriter.write(encoder.encode(key))
          terminal.write(key)
        } catch (error) {
          if (!interrupted) {
            await writelnStderr(process, terminal, `Error sending data: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }
      }
    })

    const readStream = async () => {
      try {
        while (!interrupted) {
          const { done, value } = await streamReader!.read()
          if (done || interrupted) break
          if (stdoutWriter && value && !interrupted) {
            await stdoutWriter.write(value)
          }
        }
      } catch (error) {
        if (!interrupted) {
          await writelnStderr(process, terminal, `Error reading stream: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      } finally {
        if (streamReader) {
          streamReader.releaseLock()
        }
        if (stdoutWriter) {
          stdoutWriter.releaseLock()
        }
      }
    }

    await readStream()

    if (keyListener) {
      keyListener.dispose()
      keyListener = null
    }

    if (streamWriter) {
      try {
        await streamWriter.close()
      } catch {
      }
      streamWriter.releaseLock()
    }

    if (streamReader) {
      streamReader.releaseLock()
    }
    if (stdoutWriter) {
      stdoutWriter.releaseLock()
    }
    if (connection) {
      await connection.close()
    }

    kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
    
    terminal.listen()
    terminal.write('\n')
    
    return interrupted ? 1 : 0
  } catch (error) {
    if (!interrupted) {
      await writelnStderr(process, terminal, `WebTransport error: ${error instanceof Error ? error.message : 'Connection failed'}`)
    }
    if (connection) {
      await connection.close()
    }
    kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
    
    terminal.listen()
    terminal.write('\n')
    
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'nc',
    description: 'Netcat - network utility for reading from and writing to network connections',
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

      if (argv.length === 0) {
        await writelnStderr(process, terminal, 'nc: missing host or URL argument')
        await writelnStderr(process, terminal, 'Try "nc --help" for more information.')
        return 1
      }

      const connectionOptions = parseUrl(argv)
      if (!connectionOptions) {
        await writelnStderr(process, terminal, 'nc: invalid arguments')
        await writelnStderr(process, terminal, 'Try "nc --help" for more information.')
        return 1
      }

      if (connectionOptions.useWebTransport) {
        return await connectWebTransport(connectionOptions.url, process, kernel, terminal)
      } else if (connectionOptions.useWebSocket) {
        return await connectWebSocket(connectionOptions.url, process, kernel, terminal)
      } else {
        await writelnStderr(process, terminal, 'nc: unsupported URL scheme. Use ws://, wss://, or https://')
        return 1
      }
    }
  })
}
