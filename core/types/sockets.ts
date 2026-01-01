/**
 * Socket connection types and interfaces
 */

import type { Kernel } from './kernel.ts'

/**
 * Options for configuring socket connections
 */
export interface SocketsOptions {
  /** Reference to kernel instance */
  kernel: Kernel
}

/**
 * WebSocket connection states
 */
export type WebSocketState = 'connecting' | 'open' | 'closing' | 'closed'

/**
 * WebTransport connection states
 */
export type WebTransportState = 'connecting' | 'open' | 'closed'

/**
 * WebSocket connection interface
 */
export interface WebSocketConnection {
  /** Unique identifier for this connection */
  id: string
  /** Connection type */
  type: 'websocket'
  /** The WebSocket instance */
  socket: WebSocket
  /** URL of the connection */
  url: string
  /** Timestamp when connection was created */
  created: number
  /** Human-readable connection state */
  state: WebSocketState
  /**
   * Close the connection
   */
  close(): Promise<void>
}

/**
 * WebTransport connection interface
 */
export interface WebTransportConnection {
  /** Unique identifier for this connection */
  id: string
  /** Connection type */
  type: 'webtransport'
  /** The WebTransport instance */
  transport: WebTransport
  /** URL of the connection */
  url: string
  /** Timestamp when connection was created */
  created: number
  /** Human-readable connection state */
  state: WebTransportState
  /**
   * Close the connection
   */
  close(): Promise<void>
}

/**
 * Union type for all socket connections
 */
export type SocketConnection = WebSocketConnection | WebTransportConnection

/**
 * Interface for socket connection management functionality
 */
export interface Sockets {
  /** Get the kernel instance */
  readonly kernel: Kernel

  /**
   * Create a new WebSocket connection
   * @param url - WebSocket URL (ws:// or wss://)
   * @param options - Optional WebSocket configuration
   * @returns Promise that resolves to the WebSocket connection
   */
  createWebSocket(url: string, options?: { protocols?: string | string[] }): Promise<WebSocketConnection>

  /**
   * Create a new WebTransport connection
   * @param url - WebTransport URL (https://)
   * @param options - Optional WebTransport configuration
   * @returns Promise that resolves to the WebTransport connection
   */
  createWebTransport(url: string, options?: { allowPooling?: boolean }): Promise<WebTransportConnection>

  /**
   * Close a connection by ID
   * @param id - Connection ID
   */
  close(id: string): Promise<void>

  /**
   * Get a connection by ID
   * @param id - Connection ID
   * @returns The connection or undefined if not found
   */
  get(id: string): SocketConnection | undefined

  /**
   * Get all active connections
   * @returns Map of all connections
   */
  all(): Map<string, SocketConnection>
}
