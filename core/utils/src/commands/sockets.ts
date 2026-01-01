import chalk from 'chalk'
import columnify from 'columnify'
import type { Kernel, Process, Shell, Terminal, SocketConnection } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: sockets [COMMAND] [OPTIONS]

Manage socket connections (WebSocket and WebTransport).

Commands:
  list, ls              List all active connections
  create, c <url>       Create a new connection
  close, d <id>         Close a connection by ID
  show, s <id>          Show detailed information about a connection
  --help, -h            Display this help and exit

Options:
  -t, --type <type>     Connection type: websocket or webtransport (for create)
  -p, --protocols       WebSocket protocols (comma-separated, for create)

Examples:
  sockets list
  sockets create wss://echo.websocket.org
  sockets create https://example.com:443 -t webtransport
  sockets close abc-123-def-456
  sockets show abc-123-def-456`
  writelnStdout(process, terminal, usage)
}

function findConnectionById(kernel: Kernel, id: string): SocketConnection | undefined {
  const fullMatch = kernel.sockets.get(id)
  if (fullMatch) return fullMatch

  const allConnections = kernel.sockets.all()
  for (const [fullId, conn] of allConnections.entries()) {
    if (fullId.startsWith(id) || fullId.substring(0, 8) === id) {
      return conn
    }
  }
  return undefined
}

async function listConnections(
  process: Process | undefined,
  kernel: Kernel,
  terminal: Terminal
): Promise<number> {
  const allConnections = kernel.sockets.all()
  const connections = Array.from(allConnections.values())
  
  if (connections.length === 0) {
    await writelnStdout(process, terminal, 'No active connections.')
    return 0
  }

  const data = connections.map((conn, index) => {
    const id = conn.id.substring(0, 8)
    const type = conn.type === 'websocket' ? chalk.cyan('WS') : chalk.magenta('WT')
    const state = conn.state === 'open' ? chalk.green(conn.state) :
                  conn.state === 'connecting' ? chalk.yellow(conn.state) :
                  conn.state === 'closing' ? chalk.yellow(conn.state) :
                  chalk.gray(conn.state)
    const age = Math.floor((Date.now() - conn.created) / 1000)
    const ageStr = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`
    const url = conn.url.length > 50 ? conn.url.substring(0, 47) + '...' : conn.url
    
    return {
      '#': `${index + 1}`,
      ID: chalk.bold(id),
      TYPE: type,
      STATE: state,
      AGE: chalk.gray(ageStr),
      URL: url
    }
  })

  const table = columnify(data, {
    columns: ['#', 'ID', 'TYPE', 'STATE', 'AGE', 'URL'],
    columnSplitter: '  ',
    config: {
      '#': { maxWidth: 4 },
      ID: { maxWidth: 10 },
      TYPE: { maxWidth: 4 },
      STATE: { maxWidth: 10 },
      AGE: { maxWidth: 4 }
    }
  })

  await writelnStdout(process, terminal, table)

  return 0
}

async function showConnection(
  process: Process | undefined,
  kernel: Kernel,
  terminal: Terminal,
  id: string
): Promise<number> {
  const connection = findConnectionById(kernel, id)
  
  if (!connection) {
    await writelnStderr(process, terminal, `sockets: connection not found: ${id}`)
    return 1
  }

  const age = Math.floor((Date.now() - connection.created) / 1000)
  const ageSeconds = age
  const ageMinutes = Math.floor(age / 60)
  const ageHours = Math.floor(age / 3600)
  const ageStr = age < 60 ? `${ageSeconds} seconds` :
                 age < 3600 ? `${ageMinutes} minutes, ${ageSeconds % 60} seconds` :
                 `${ageHours} hours, ${Math.floor((age % 3600) / 60)} minutes`

  writelnStdout(process, terminal, chalk.bold('Connection Details'))
  writelnStdout(process, terminal, chalk.gray('─'.repeat(40)))
  writelnStdout(process, terminal, `ID:        ${chalk.bold(connection.id)}`)
  writelnStdout(process, terminal, `Type:      ${connection.type === 'websocket' ? chalk.cyan('WebSocket') : chalk.magenta('WebTransport')}`)
  writelnStdout(process, terminal, `State:     ${connection.state === 'open' ? chalk.green(connection.state) :
                                            connection.state === 'connecting' ? chalk.yellow(connection.state) :
                                            connection.state === 'closing' ? chalk.yellow(connection.state) :
                                            chalk.gray(connection.state)}`)
  writelnStdout(process, terminal, `URL:       ${connection.url}`)
  writelnStdout(process, terminal, `Created:   ${new Date(connection.created).toISOString()}`)
  writelnStdout(process, terminal, `Age:       ${ageStr}`)

  if (connection.type === 'websocket') {
    const ws = connection.socket
    writelnStdout(process, terminal, `Protocol:  ${ws.protocol || '(none)'}`)
    writelnStdout(process, terminal, `Extensions: ${ws.extensions || '(none)'}`)
    writelnStdout(process, terminal, `BinaryType: ${ws.binaryType}`)
    writelnStdout(process, terminal, `ReadyState: ${ws.readyState} (${connection.state})`)
  } else {
    writelnStdout(process, terminal, `State:     ${connection.state}`)
  }

  return 0
}

async function createConnection(
  process: Process | undefined,
  kernel: Kernel,
  terminal: Terminal,
  url: string,
  type?: string,
  protocols?: string
): Promise<number> {
  try {
    let connection: SocketConnection

    if (type === 'webtransport' || (!type && url.startsWith('https://'))) {
      if (!('WebTransport' in globalThis)) {
        await writelnStderr(process, terminal, 'sockets: WebTransport is not supported in this browser')
        return 1
      }
      connection = await kernel.sockets.createWebTransport(url)
      await writelnStdout(process, terminal, `Created WebTransport connection: ${chalk.bold(connection.id.substring(0, 8))}`)
    } else if (type === 'websocket' || url.startsWith('ws://') || url.startsWith('wss://')) {
      const options = protocols ? { protocols: protocols.split(',') } : undefined
      connection = await kernel.sockets.createWebSocket(url, options)
      await writelnStdout(process, terminal, `Created WebSocket connection: ${chalk.bold(connection.id.substring(0, 8))}`)
    } else {
      await writelnStderr(process, terminal, 'sockets: unable to determine connection type. Use -t to specify type or use a URL with ws://, wss://, or https:// scheme')
      return 1
    }

    await writelnStdout(process, terminal, `URL: ${connection.url}`)
    await writelnStdout(process, terminal, `State: ${connection.state === 'open' ? chalk.green(connection.state) : chalk.yellow(connection.state)}`)
    
    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `sockets: failed to create connection: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function closeConnection(
  process: Process | undefined,
  kernel: Kernel,
  terminal: Terminal,
  id: string
): Promise<number> {
  const connection = findConnectionById(kernel, id)
  
  if (!connection) {
    await writelnStderr(process, terminal, `sockets: connection not found: ${id}`)
    return 1
  }

  try {
    await kernel.sockets.close(connection.id)
    await writelnStdout(process, terminal, `Closed connection: ${chalk.bold(connection.id.substring(0, 8))}`)
    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `sockets: failed to close connection: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'sockets',
    description: 'Manage socket connections (WebSocket and WebTransport)',
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

      if (argv.length === 0 || argv[0] === 'list' || argv[0] === 'ls') {
        return await listConnections(process, kernel, terminal)
      }

      const command = argv[0]
      let type: string | undefined
      let protocols: string | undefined

      for (let i = 1; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '-t' || arg === '--type') {
          if (i + 1 < argv.length) {
            i++
            type = argv[i]
          } else {
            await writelnStderr(process, terminal, 'sockets: --type requires a value')
            return 1
          }
        } else if (arg === '-p' || arg === '--protocols') {
          if (i + 1 < argv.length) {
            i++
            protocols = argv[i]
          } else {
            await writelnStderr(process, terminal, 'sockets: --protocols requires a value')
            return 1
          }
        }
      }

      if (command === 'create' || command === 'c') {
        if (argv.length < 2 || !argv[1] || argv[1].startsWith('-')) {
          await writelnStderr(process, terminal, 'sockets: create requires a URL')
          await writelnStderr(process, terminal, 'Try "sockets --help" for more information.')
          return 1
        }
        const url = argv[1]
        return await createConnection(process, kernel, terminal, url, type, protocols)
      }

      if (command === 'close' || command === 'd') {
        if (argv.length < 2 || !argv[1] || argv[1].startsWith('-')) {
          await writelnStderr(process, terminal, 'sockets: close requires a connection ID')
          await writelnStderr(process, terminal, 'Try "sockets --help" for more information.')
          return 1
        }
        const id = argv[1]
        return await closeConnection(process, kernel, terminal, id)
      }

      if (command === 'show' || command === 's') {
        if (argv.length < 2 || !argv[1] || argv[1].startsWith('-')) {
          await writelnStderr(process, terminal, 'sockets: show requires a connection ID')
          await writelnStderr(process, terminal, 'Try "sockets --help" for more information.')
          return 1
        }
        const id = argv[1]
        return await showConnection(process, kernel, terminal, id)
      }

      await writelnStderr(process, terminal, `sockets: unknown command: ${command}`)
      await writelnStderr(process, terminal, 'Try "sockets --help" for more information.')
      return 1
    }
  })
}
