import type { ParsedArgs, CommandContext, ProcessEntryParams } from '../types.js'
import { formatAddress, parseValue, formatError } from '../lib/utils.js'
import { encodeFunctionData, decodeFunctionResult } from 'viem'
import { parseAbi } from 'viem'

export async function handleContract(
  args: ParsedArgs,
  context: CommandContext,
  params: ProcessEntryParams
): Promise<number> {
  const { terminal } = params
  const { params: cmdParams } = args
  const subcommand = cmdParams[1]

  if (!subcommand || subcommand === 'help' || args.options.help) {
    terminal.writeln(`Contract Commands:
  contract read <address> <function> [args...]              Read contract data
  contract write <address> <function> [args...] [--value]   Write to contract (send transaction)
  contract help                                              Show this help`)
    terminal.writeln('')
    terminal.writeln('Note: Contract interactions require ABI. Use function signature format:')
    terminal.writeln('  Example: "balanceOf(address)" or "transfer(address,uint256)"')
    return 0
  }

  const { publicClient, walletClient } = context

  try {
    switch (subcommand) {
      case 'read': {
        const address = cmdParams[2]
        const functionSig = cmdParams[3]
        
        if (!address || !functionSig) {
          terminal.writeln('Error: Please provide contract address and function signature')
          return 1
        }
        
        const contractAddress = formatAddress(address)
        const functionArgs = cmdParams.slice(4)
        
        const abi = parseAbi([functionSig] as const)
        const functionName = functionSig.split('(')[0]
        const data = encodeFunctionData({
          abi: abi as readonly unknown[],
          functionName,
          args: functionArgs.length > 0 ? functionArgs : undefined
        })
        
        const result = await publicClient.call({
          to: contractAddress as `0x${string}`,
          data
        })
        
        if (result.data === '0x') {
          terminal.writeln('No data returned')
          return 0
        }
        
        try {
          const decoded = decodeFunctionResult({
            abi: abi as readonly unknown[],
            functionName,
            data: result.data as `0x${string}`
          })
          terminal.writeln(`Result: ${JSON.stringify(decoded, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`)
        } catch {
          terminal.writeln(`Raw data: ${result.data}`)
        }
        
        return 0
      }

      case 'write': {
        if (!walletClient) {
          terminal.writeln('Error: Wallet client required for write operations')
          return 1
        }
        
        const address = cmdParams[2]
        const functionSig = cmdParams[3]
        
        if (!address || !functionSig) {
          terminal.writeln('Error: Please provide contract address and function signature')
          return 1
        }
        
        const contractAddress = formatAddress(address)
        const functionArgs = cmdParams.slice(4)
        const value = args.options.value ? parseValue(args.options.value as string) : undefined
        
        const abi = parseAbi([functionSig] as const)
        const functionName = functionSig.split('(')[0]
        const data = encodeFunctionData({
          abi: abi as readonly unknown[],
          functionName,
          args: functionArgs.length > 0 ? functionArgs : undefined
        })
        
        if (!walletClient.account) {
          terminal.writeln('Error: Wallet client missing account')
          return 1
        }
        
        const hash = await walletClient.sendTransaction({
          account: walletClient.account,
          to: contractAddress as `0x${string}`,
          data,
          value,
          chain: walletClient.chain || null
        })
        
        terminal.writeln(`Transaction sent: ${hash}`)
        terminal.writeln(`Waiting for confirmation...`)
        
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        terminal.writeln(`Transaction confirmed in block #${receipt.blockNumber}`)
        terminal.writeln(`Status: ${receipt.status === 'success' ? 'Success' : 'Failed'}`)
        return 0
      }

      default:
        terminal.writeln(`Error: Unknown subcommand: ${subcommand}`)
        terminal.writeln('Run "web3 contract help" for usage')
        return 1
    }
  } catch (error) {
    terminal.writeln(`Error: ${formatError(error)}`)
    return 1
  }
}
