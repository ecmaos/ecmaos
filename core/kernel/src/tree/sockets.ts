import type { Kernel, SocketsOptions, SocketConnection, WebSocketConnection, WebTransportConnection } from '@ecmaos/types'

export class Sockets {
  private _kernel: Kernel
  private _connections: Map<string, SocketConnection> = new Map()

  get kernel() { return this._kernel }

  constructor(options: SocketsOptions) {
    this._kernel = options.kernel
  }

  /**
   * Create a WebSocket connection
   * @param url - The URL to connect to
   * @param options - The options for the WebSocket connection
   * @returns The WebSocket connection
   */
  async createWebSocket(url: string, options?: { protocols?: string | string[] }): Promise<WebSocketConnection> {
    return new Promise((resolve, reject) => {
      try {
        const socket = new WebSocket(url, options?.protocols)
        const id = crypto.randomUUID()
        const created = Date.now()

        socket.binaryType = 'arraybuffer'

        const getState = (): 'connecting' | 'open' | 'closing' | 'closed' => {
          switch (socket.readyState) {
            case WebSocket.CONNECTING:
              return 'connecting'
            case WebSocket.OPEN:
              return 'open'
            case WebSocket.CLOSING:
              return 'closing'
            case WebSocket.CLOSED:
              return 'closed'
            default:
              return 'closed'
          }
        }

        const connection: WebSocketConnection = {
          id,
          type: 'websocket',
          socket,
          url,
          created,
          get state() {
            return getState()
          },
          close: async () => {
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
              socket.close(1000, 'Closed by user')
            }
            this._connections.delete(id)
          }
        }

        socket.onopen = () => {
          this._connections.set(id, connection)
          resolve(connection)
        }

        socket.onerror = (error) => {
          this._kernel.log.error(`WebSocket connection error for ${url}: ${error}`)
          reject(new Error(`WebSocket connection failed: ${url}`))
        }

        socket.onclose = () => {
          this._connections.delete(id)
        }
      } catch (error) {
        this._kernel.log.error(`Failed to create WebSocket: ${error}`)
        reject(error)
      }
    })
  }

  /**
   * Create a WebTransport connection
   * @param url - The URL to connect to
   * @param options - The options for the WebTransport connection
   * @returns The WebTransport connection
   */
  async createWebTransport(url: string, options?: { allowPooling?: boolean }): Promise<WebTransportConnection> {
    if (!('WebTransport' in globalThis)) {
      throw new Error('WebTransport is not supported in this browser')
    }

    try {
      const transport = new WebTransport(url, options)
      const id = crypto.randomUUID()
      const created = Date.now()

      await transport.ready

      let transportState: 'connecting' | 'open' | 'closed' = 'open'

      const connection = {
        id,
        type: 'webtransport' as const,
        transport,
        url,
        created,
        get state() {
          return transportState
        },
        close: async () => {
          try {
            transport.close()
            transportState = 'closed'
          } catch (error) {
            this._kernel.log.error(`Error closing WebTransport: ${error}`)
            transportState = 'closed'
          }
          this._connections.delete(id)
        }
      } as WebTransportConnection

      this._connections.set(id, connection)

      transport.closed.catch((error) => {
        transportState = 'closed'
        this._kernel.log.error(`WebTransport connection closed with error: ${error}`)
        this._connections.delete(id)
      })

      return connection
    } catch (error) {
      this._kernel.log.error(`Failed to create WebTransport: ${error}`)
      throw error
    }
  }

  /**
   * Close a socket connection
   * @param id - The ID of the connection to close
   */
  async close(id: string): Promise<void> {
    const connection = this._connections.get(id)
    if (connection) {
      await connection.close()
    }
  }

  /**
   * Get a socket connection
   * @param id - The ID of the connection to get
   * @returns The socket connection
   */
  get(id: string): SocketConnection | undefined {
    return this._connections.get(id)
  }

  /**
   * Get all socket connections
   * @returns A map of all socket connections
   */
  all(): Map<string, SocketConnection> {
    return new Map(this._connections)
  }
}
