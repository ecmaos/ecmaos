import type { ParsedArgs, CommandContext, ProcessEntryParams } from '../types.js'
import { formatEth, formatAddress, formatError } from '../lib/utils.js'

export async function handleChain(
  args: ParsedArgs,
  context: CommandContext,
  params: ProcessEntryParams
): Promise<number> {
  const { terminal } = params
  const { params: cmdParams } = args
  const subcommand = cmdParams[1]

  if (!subcommand || subcommand === 'help' || args.options.help) {
    terminal.writeln(`Chain Commands:
  chain block [number]              Get block info (latest or by number)
  chain balance <address>           Get ETH balance
  chain nonce <address>              Get transaction count
  chain tx <hash>                   Get transaction details
  chain receipt <hash>               Get transaction receipt
  chain help                         Show this help`)
    return 0
  }

  const { publicClient } = context

  try {
    switch (subcommand) {
      case 'block': {
        const blockNumber = cmdParams[2]
        const block = blockNumber
          ? await publicClient.getBlock({ blockNumber: BigInt(blockNumber) })
          : await publicClient.getBlock()
        
        terminal.writeln(`Block #${block.number}`)
        terminal.writeln(`Hash: ${block.hash}`)
        terminal.writeln(`Timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`)
        terminal.writeln(`Transactions: ${block.transactions.length}`)
        terminal.writeln(`Gas Used: ${block.gasUsed.toString()}`)
        terminal.writeln(`Gas Limit: ${block.gasLimit.toString()}`)
        return 0
      }

      case 'balance': {
        const address = cmdParams[2]
        if (!address) {
          terminal.writeln('Error: Please provide an address')
          return 1
        }
        
        const addr = formatAddress(address)
        const balance = await publicClient.getBalance({ address: addr as `0x${string}` })
        terminal.writeln(`Balance: ${formatEth(balance)} ETH`)
        return 0
      }

      case 'nonce': {
        const address = cmdParams[2]
        if (!address) {
          terminal.writeln('Error: Please provide an address')
          return 1
        }
        
        const addr = formatAddress(address)
        const nonce = await publicClient.getTransactionCount({ address: addr as `0x${string}` })
        terminal.writeln(`Nonce: ${nonce}`)
        return 0
      }

      case 'tx': {
        const hash = cmdParams[2]
        if (!hash) {
          terminal.writeln('Error: Please provide a transaction hash')
          return 1
        }
        
        const tx = await publicClient.getTransaction({ hash: hash as `0x${string}` })
        terminal.writeln(`Transaction: ${tx.hash}`)
        terminal.writeln(`From: ${tx.from}`)
        terminal.writeln(`To: ${tx.to || 'Contract Creation'}`)
        terminal.writeln(`Value: ${formatEth(tx.value)} ETH`)
        terminal.writeln(`Gas: ${tx.gas.toString()}`)
        terminal.writeln(`Gas Price: ${formatEth(tx.gasPrice || 0n)} ETH`)
        terminal.writeln(`Nonce: ${tx.nonce}`)
        return 0
      }

      case 'receipt': {
        const hash = cmdParams[2]
        if (!hash) {
          terminal.writeln('Error: Please provide a transaction hash')
          return 1
        }
        
        const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` })
        terminal.writeln(`Transaction Receipt: ${receipt.transactionHash}`)
        terminal.writeln(`Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`)
        terminal.writeln(`Block: #${receipt.blockNumber}`)
        terminal.writeln(`Gas Used: ${receipt.gasUsed.toString()}`)
        terminal.writeln(`Effective Gas Price: ${formatEth(receipt.effectiveGasPrice)} ETH`)
        if (receipt.contractAddress) {
          terminal.writeln(`Contract Address: ${receipt.contractAddress}`)
        }
        return 0
      }

      default:
        terminal.writeln(`Error: Unknown subcommand: ${subcommand}`)
        terminal.writeln('Run "web3 chain help" for usage')
        return 1
    }
  } catch (error) {
    terminal.writeln(`Error: ${formatError(error)}`)
    return 1
  }
}
