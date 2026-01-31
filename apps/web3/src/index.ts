import type { ProcessEntryParams } from '@ecmaos/types'
import type { ParsedArgs, CommandContext, ClientConfig } from './types.js'
import { createPublicClientFromConfig, createWalletClientFromAccount } from './lib/client.js'
import * as storage from './lib/storage.js'
import { parseChainId } from './lib/utils.js'
import { handleWallet } from './commands/wallet.js'
import { handleChain } from './commands/chain.js'
import { handleTransaction } from './commands/transaction.js'
import { handleContract } from './commands/contract.js'
import { handleAccount } from './commands/account.js'

function parseArgs(args: string[]): ParsedArgs {
  const options: Record<string, string | boolean> = {}
  const params: string[] = []
  
  for (let i = 0; i < args.length; i++) {
    const current = args[i]
    if (current === undefined) continue
    
    if (!current.startsWith('-')) {
      params.push(current)
      continue
    }
    
    if (current.includes('=')) {
      const idx = current.indexOf('=')
      const key = current.slice(0, idx)
      const value = current.slice(idx + 1)
      if (key && value !== undefined) {
        options[key.replace(/^-+/, '')] = value
      }
      continue
    }
    
    const key = current
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      options[key.replace(/^-+/, '')] = next
      i++
    } else {
      options[key.replace(/^-+/, '')] = true
    }
  }
  
  return { options, params }
}

function getClientConfig(args: ParsedArgs, shell: any): ClientConfig {
  const chainName = args.options.chain as string | undefined
  const chainId = args.options['chain-id'] ? parseChainId(args.options['chain-id'] as string) : undefined
  const rpcUrl = args.options.rpc as string | undefined || shell.envObject.WEB3_RPC_URL
  
  return {
    chain: chainName ? { name: chainName } as any : undefined,
    chainId,
    rpcUrl
  }
}

const help = `
Web3 CLI

CAUTION: EXPERIMENTAL SOFTWARE. USE AT YOUR OWN RISK. BE CAUTIOUS WITH FUNDS.

Usage: web3 <command> [subcommand] [args...] [options]

Commands:
  wallet <subcommand>     Wallet management (create, import, list, connect, switch, remove)
  chain <subcommand>      Blockchain reading (block, balance, nonce, tx, receipt)
  tx <subcommand>         Transaction operations (send, sign, estimate, wait)
  contract <subcommand>   Smart contract interactions (read, write)
  account <subcommand>    Account information (current, info)
  help                    Show this help message

Options:
  --chain <name>          Chain name (mainnet, sepolia, goerli) [default: mainnet]
  --chain-id <id>         Chain ID (overrides --chain)
  --rpc <url>             Custom RPC URL (or set WEB3_RPC_URL env var)
  --help                  Show help for command

Examples:
  web3 wallet create
  web3 chain balance 0x...
  web3 tx send 0x... 0.1
  web3 contract read 0x... "balanceOf(address)" 0x...
  web3 account current

For command-specific help: web3 <command> help
`

const main = async (params: ProcessEntryParams) => {
  const { args, shell, terminal } = params
  const parsed = parseArgs(args)
  
  if (parsed.params.length === 0 || parsed.params[0] === 'help' || parsed.options.help) {
    terminal.writeln(help)
    return 0
  }
  
  const command = parsed.params[0]
  const config = getClientConfig(parsed, shell)
  
  try {
    const publicClient = createPublicClientFromConfig(config)
    const currentAccount = await storage.getCurrentAccount(shell)
    
    let walletClient
    if (currentAccount) {
      try {
        walletClient = await createWalletClientFromAccount(currentAccount, config)
      } catch (error) {
        if (command !== 'wallet' && command !== 'account') {
          terminal.writeln(`Warning: Could not create wallet client: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    
    const context: CommandContext = {
      publicClient,
      walletClient,
      account: currentAccount || undefined,
      config
    }
    
    switch (command) {
      case 'wallet':
        return await handleWallet(parsed, context, params)
      
      case 'chain':
        return await handleChain(parsed, context, params)
      
      case 'tx':
      case 'transaction':
        return await handleTransaction(parsed, context, params)
      
      case 'contract':
        return await handleContract(parsed, context, params)
      
      case 'account':
        return await handleAccount(parsed, context, params)
      
      default:
        terminal.writeln(`Error: Unknown command: ${command}`)
        terminal.writeln(help)
        return 1
    }
  } catch (error) {
    terminal.writeln(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

export default main
