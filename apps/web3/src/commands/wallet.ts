import type { ParsedArgs, CommandContext, ProcessEntryParams } from '../types.js'
import * as storage from '../lib/storage.js'
import { connectBrowserExtension } from '../lib/client.js'
import { formatAddress } from '../lib/utils.js'

export async function handleWallet(
  args: ParsedArgs,
  context: CommandContext,
  params: ProcessEntryParams
): Promise<number> {
  const { terminal, shell } = params
  const { params: cmdParams } = args
  const subcommand = cmdParams[1]

  if (!subcommand || subcommand === 'help' || args.options.help) {
    terminal.writeln(`Wallet Management Commands:
  wallet create [--name <name>]     Create a new account
  wallet import <private-key|mnemonic> [--name <name>]  Import an account
  wallet list                        List all accounts
  wallet connect                     Connect to browser extension wallet
  wallet switch <name|address>       Switch active account
  wallet remove <name|address>       Remove an account
  wallet help                        Show this help`)
    return 0
  }

  try {
    switch (subcommand) {
      case 'create': {
        const name = args.options.name as string | undefined
        const account = await storage.createAccount(shell, name)
        terminal.writeln(`Created account: ${account.address}`)
        if (account.mnemonic) {
          terminal.writeln(`Mnemonic: ${account.mnemonic}`)
          terminal.writeln('⚠️  Save this mnemonic securely!')
        }
        return 0
      }

      case 'import': {
        const input = cmdParams[2]
        if (!input) {
          terminal.writeln('Error: Please provide a private key or mnemonic to import')
          return 1
        }
        const name = args.options.name as string | undefined
        
        let account
        if (input.startsWith('0x') && input.length === 66) {
          account = await storage.importAccountFromPrivateKey(shell, input, name)
        } else {
          account = await storage.importAccountFromMnemonic(shell, input, name)
        }
        terminal.writeln(`Imported account: ${account.address}`)
        return 0
      }

      case 'list': {
        const accounts = await storage.listAccounts(shell)
        const current = await storage.getCurrentAccount(shell)
        
        if (accounts.length === 0) {
          terminal.writeln('No accounts found')
          return 0
        }
        
        terminal.writeln('Accounts:')
        for (const acc of accounts) {
          const marker = current && current.address.toLowerCase() === acc.address.toLowerCase() ? ' *' : ''
          const name = acc.name ? ` (${acc.name})` : ''
          terminal.writeln(`  ${acc.address}${name}${marker}`)
        }
        return 0
      }

      case 'connect': {
        try {
          const account = await connectBrowserExtension(context.config)
          await storage.setCurrentAccount(shell, account)
          terminal.writeln(`Connected to extension wallet: ${account.address}`)
          return 0
        } catch (error) {
          terminal.writeln(`Error: ${error instanceof Error ? error.message : String(error)}`)
          return 1
        }
      }

      case 'switch': {
        const identifier = cmdParams[2]
        if (!identifier) {
          terminal.writeln('Error: Please provide account name or address')
          return 1
        }
        
        const account = await storage.findAccount(shell, identifier)
        if (!account) {
          terminal.writeln(`Error: Account not found: ${identifier}`)
          return 1
        }
        
        await storage.setCurrentAccount(shell, account)
        terminal.writeln(`Switched to account: ${account.address}`)
        return 0
      }

      case 'remove': {
        const identifier = cmdParams[2]
        if (!identifier) {
          terminal.writeln('Error: Please provide account name or address')
          return 1
        }
        
        const removed = await storage.removeAccount(shell, identifier)
        if (!removed) {
          terminal.writeln(`Error: Account not found: ${identifier}`)
          return 1
        }
        
        terminal.writeln(`Removed account: ${identifier}`)
        return 0
      }

      default:
        terminal.writeln(`Error: Unknown subcommand: ${subcommand}`)
        terminal.writeln('Run "web3 wallet help" for usage')
        return 1
    }
  } catch (error) {
    terminal.writeln(`Error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
