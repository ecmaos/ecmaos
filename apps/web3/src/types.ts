import type { Chain, PublicClient, WalletClient } from 'viem'

export interface AccountInfo {
  name?: string
  address: string
  privateKey?: string
  mnemonic?: string
  type: 'local' | 'extension'
}

export interface StoredAccount {
  name?: string
  address: string
  privateKey?: string
  mnemonic?: string
  createdAt: string
}

export interface ClientConfig {
  chain?: Chain
  rpcUrl?: string
  chainId?: number
}

export interface ParsedArgs {
  options: Record<string, string | boolean>
  params: string[]
}

export interface CommandContext {
  publicClient: PublicClient
  walletClient?: WalletClient
  account?: AccountInfo
  config: ClientConfig
}

export type CommandHandler = (
  args: ParsedArgs,
  context: CommandContext,
  params: ProcessEntryParams
) => Promise<number>

export interface ProcessEntryParams {
  args: string[]
  command: string
  cwd: string
  gid: number
  kernel: any
  pid: number
  shell: any
  terminal: any
  stdin?: ReadableStream<Uint8Array>
  stdout?: WritableStream<Uint8Array>
  stderr?: WritableStream<Uint8Array>
  uid: number
}
