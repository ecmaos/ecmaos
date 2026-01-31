import { createPublicClient, createWalletClient, http, custom, type Chain, type PublicClient, type WalletClient, type Account } from 'viem'
import { mainnet, sepolia, goerli } from 'viem/chains'
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts'
import type { AccountInfo, ClientConfig } from '../types.js'

const CHAIN_MAP: Record<string, Chain> = {
  mainnet,
  sepolia,
  goerli
}

export function getChain(chainName?: string, chainId?: number, rpcUrl?: string): Chain {
  if (chainId) {
    const chain = Object.values(CHAIN_MAP).find(c => c.id === chainId)
    if (chain) return chain
  }
  
  if (chainName) {
    const chain = CHAIN_MAP[chainName.toLowerCase()]
    if (chain) return chain
  }
  
  return mainnet
}

export function createPublicClientFromConfig(config: ClientConfig): PublicClient {
  const chain = getChain(config.chain?.name, config.chainId, config.rpcUrl)
  const transport = config.rpcUrl ? http(config.rpcUrl) : http()
  
  return createPublicClient({
    chain,
    transport
  })
}

export async function createWalletClientFromAccount(
  account: AccountInfo,
  config: ClientConfig
): Promise<WalletClient> {
  const chain = getChain(config.chain?.name, config.chainId, config.rpcUrl)
  const transport = config.rpcUrl ? http(config.rpcUrl) : http()
  
  if (account.type === 'extension') {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('Browser extension wallet not available')
    }
    const walletClient = createWalletClient({
      chain,
      transport: custom(window.ethereum)
    })
    
    const addresses = await walletClient.getAddresses()
    if (addresses.length === 0) {
      throw new Error('No accounts found in extension wallet')
    }
    
    const accountAddress = account.address.toLowerCase()
    const matchingAddress = addresses.find(addr => addr.toLowerCase() === accountAddress)
    
    if (!matchingAddress) {
      throw new Error(`Account ${account.address} not found in extension wallet`)
    }
    
    return walletClient
  }
  
  if (!account.privateKey && !account.mnemonic) {
    throw new Error('Account missing private key or mnemonic')
  }
  
  let viemAccount: Account
  if (account.privateKey) {
    viemAccount = privateKeyToAccount(account.privateKey as `0x${string}`)
  } else if (account.mnemonic) {
    viemAccount = mnemonicToAccount(account.mnemonic)
  } else {
    throw new Error('Account missing credentials')
  }
  
  return createWalletClient({
    account: viemAccount,
    chain,
    transport
  })
}

export async function connectBrowserExtension(config: ClientConfig): Promise<AccountInfo> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('Browser extension wallet not available')
  }
  
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts found in wallet')
  }
  
  return {
    address: accounts[0] as string,
    type: 'extension'
  }
}
