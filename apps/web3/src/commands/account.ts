import type { ParsedArgs, CommandContext, ProcessEntryParams } from '../types.js'
import * as storage from '../lib/storage.js'
import { formatAddress, formatEth, formatError } from '../lib/utils.js'

export async function handleAccount(
  args: ParsedArgs,
  context: CommandContext,
  params: ProcessEntryParams
): Promise<number> {
  const { terminal, shell } = params
  const { params: cmdParams } = args
  const subcommand = cmdParams[1]

  if (!subcommand || subcommand === 'help' || args.options.help) {
    terminal.writeln(`Account Commands:
  account current                    Show current active account
  account info <address>             Show account details (balance, nonce, etc.)
  account help                       Show this help`)
    return 0
  }

  const { publicClient } = context

  try {
    switch (subcommand) {
      case 'current': {
        const account = await storage.getCurrentAccount(shell)
        if (!account) {
          terminal.writeln('No account selected')
          terminal.writeln('Use "web3 wallet switch" or "web3 wallet connect" to select an account')
          return 1
        }
        
        terminal.writeln(`Current account: ${account.address}`)
        if (account.name) {
          terminal.writeln(`Name: ${account.name}`)
        }
        terminal.writeln(`Type: ${account.type}`)
        return 0
      }

      case 'info': {
        const address = cmdParams[2]
        if (!address) {
          terminal.writeln('Error: Please provide an address')
          return 1
        }
        
        const addr = formatAddress(address)
        
        const [balance, nonce, blockNumber] = await Promise.all([
          publicClient.getBalance({ address: addr as `0x${string}` }),
          publicClient.getTransactionCount({ address: addr as `0x${string}` }),
          publicClient.getBlockNumber()
        ])
        
        terminal.writeln(`Address: ${addr}`)
        terminal.writeln(`Balance: ${formatEth(balance)} ETH`)
        terminal.writeln(`Nonce: ${nonce}`)
        terminal.writeln(`Current Block: #${blockNumber}`)
        
        const account = await storage.findAccount(shell, addr)
        if (account) {
          if (account.name) {
            terminal.writeln(`Name: ${account.name}`)
          }
          terminal.writeln(`Type: ${account.type}`)
        }
        
        return 0
      }

      default:
        terminal.writeln(`Error: Unknown subcommand: ${subcommand}`)
        terminal.writeln('Run "web3 account help" for usage')
        return 1
    }
  } catch (error) {
    terminal.writeln(`Error: ${formatError(error)}`)
    return 1
  }
}
