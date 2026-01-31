import type { ParsedArgs, CommandContext, ProcessEntryParams } from '../types.js'
import type { Account } from 'viem'
import { formatAddress, parseValue, formatEth, formatError } from '../lib/utils.js'

export async function handleTransaction(
  args: ParsedArgs,
  context: CommandContext,
  params: ProcessEntryParams
): Promise<number> {
  const { terminal } = params
  const { params: cmdParams } = args
  const subcommand = cmdParams[1]

  if (!subcommand || subcommand === 'help' || args.options.help) {
    terminal.writeln(`Transaction Commands:
  tx send <to> <value> [--gas-limit <limit>] [--gas-price <price>]  Send ETH transaction
  tx sign <message>                                                 Sign a message
  tx estimate <to> <value>                                          Estimate gas for transaction
  tx wait <hash>                                                    Wait for transaction confirmation
  tx help                                                           Show this help`)
    return 0
  }

  const { publicClient, walletClient, account } = context

  if ((subcommand === 'send' || subcommand === 'sign' || subcommand === 'estimate') && !walletClient) {
    terminal.writeln('Error: Wallet client required. Use "web3 wallet switch" or "web3 wallet connect"')
    return 1
  }

  try {
    switch (subcommand) {
      case 'send': {
        const to = cmdParams[2]
        const valueStr = cmdParams[3]
        
        if (!to || !valueStr) {
          terminal.writeln('Error: Please provide recipient address and value')
          return 1
        }
        
        const toAddress = formatAddress(to)
        const value = parseValue(valueStr)
        
        const gasLimit = args.options['gas-limit'] 
          ? BigInt(args.options['gas-limit'] as string)
          : undefined
        const gasPrice = args.options['gas-price']
          ? parseValue(args.options['gas-price'] as string)
          : undefined
        
        if (!walletClient) {
          terminal.writeln('Error: Wallet client missing account')
          return 1
        }
        
        let accountParam: Account
        if (account?.type === 'extension') {
          const addresses = await walletClient.getAddresses()
          if (addresses.length === 0) {
            terminal.writeln('Error: No accounts found in extension wallet')
            return 1
          }
          const accountAddress = account.address.toLowerCase()
          const matchingAddress = addresses.find(addr => addr.toLowerCase() === accountAddress)
          if (!matchingAddress) {
            terminal.writeln(`Error: Account ${account.address} not found in extension wallet`)
            return 1
          }
          accountParam = matchingAddress as unknown as Account
        } else if (walletClient.account) {
          accountParam = walletClient.account
        } else {
          terminal.writeln('Error: Wallet client missing account')
          return 1
        }
        
        const hash = await walletClient.sendTransaction({
          account: accountParam,
          to: toAddress as `0x${string}`,
          value,
          gas: gasLimit,
          gasPrice: gasPrice,
          chain: walletClient.chain || null
        })
        
        terminal.writeln(`Transaction sent: ${hash}`)
        terminal.writeln(`Waiting for confirmation...`)
        
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        terminal.writeln(`Transaction confirmed in block #${receipt.blockNumber}`)
        terminal.writeln(`Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`)
        return 0
      }

      case 'sign': {
        const message = cmdParams[2]
        if (!message) {
          terminal.writeln('Error: Please provide a message to sign')
          return 1
        }
        
        if (!walletClient) {
          terminal.writeln('Error: Wallet client missing account')
          return 1
        }
        
        let accountParam: Account
        if (account?.type === 'extension') {
          const addresses = await walletClient.getAddresses()
          if (addresses.length === 0) {
            terminal.writeln('Error: No accounts found in extension wallet')
            return 1
          }
          const accountAddress = account.address.toLowerCase()
          const matchingAddress = addresses.find(addr => addr.toLowerCase() === accountAddress)
          if (!matchingAddress) {
            terminal.writeln(`Error: Account ${account.address} not found in extension wallet`)
            return 1
          }
          accountParam = matchingAddress as unknown as Account
        } else if (walletClient.account) {
          accountParam = walletClient.account
        } else {
          terminal.writeln('Error: Wallet client missing account')
          return 1
        }
        
        const signature = await walletClient.signMessage({
          account: accountParam,
          message
        })
        
        terminal.writeln(`Signature: ${signature}`)
        return 0
      }

      case 'estimate': {
        const to = cmdParams[2]
        const valueStr = cmdParams[3]
        
        if (!to || !valueStr) {
          terminal.writeln('Error: Please provide recipient address and value')
          return 1
        }
        
        const toAddress = formatAddress(to)
        const value = parseValue(valueStr)
        
        if (!walletClient) {
          terminal.writeln('Error: No account selected')
          return 1
        }
        
        let accountParam: Account
        if (account?.type === 'extension') {
          const addresses = await walletClient.getAddresses()
          if (addresses.length === 0) {
            terminal.writeln('Error: No accounts found in extension wallet')
            return 1
          }
          const accountAddress = account.address.toLowerCase()
          const matchingAddress = addresses.find(addr => addr.toLowerCase() === accountAddress)
          if (!matchingAddress) {
            terminal.writeln(`Error: Account ${account.address} not found in extension wallet`)
            return 1
          }
          accountParam = matchingAddress as unknown as Account
        } else if (walletClient.account) {
          accountParam = walletClient.account
        } else {
          terminal.writeln('Error: No account selected')
          return 1
        }
        
        const gas = await publicClient.estimateGas({
          account: accountParam,
          to: toAddress as `0x${string}`,
          value
        })
        
        terminal.writeln(`Estimated gas: ${gas.toString()}`)
        return 0
      }

      case 'wait': {
        const hash = cmdParams[2]
        if (!hash) {
          terminal.writeln('Error: Please provide a transaction hash')
          return 1
        }
        
        terminal.writeln(`Waiting for transaction: ${hash}`)
        const receipt = await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}` })
        terminal.writeln(`Transaction confirmed in block #${receipt.blockNumber}`)
        terminal.writeln(`Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`)
        terminal.writeln(`Gas Used: ${receipt.gasUsed.toString()}`)
        return 0
      }

      default:
        terminal.writeln(`Error: Unknown subcommand: ${subcommand}`)
        terminal.writeln('Run "web3 tx help" for usage')
        return 1
    }
  } catch (error) {
    terminal.writeln(`Error: ${formatError(error)}`)
    return 1
  }
}
