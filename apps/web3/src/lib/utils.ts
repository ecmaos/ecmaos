import { isAddress, formatUnits, parseUnits, formatEther, parseEther } from 'viem'

export function validateAddress(address: string): boolean {
  return isAddress(address)
}

export function formatAddress(address: string): string {
  if (!validateAddress(address)) {
    throw new Error(`Invalid address: ${address}`)
  }
  return address
}

export function parseValue(value: string): bigint {
  if (value.includes('.')) {
    try {
      return parseEther(value)
    } catch {
      throw new Error(`Invalid value format: ${value}`)
    }
  }
  
  const num = BigInt(value)
  if (num < 0n) {
    throw new Error('Value cannot be negative')
  }
  return num
}

export function formatValue(value: bigint, decimals: number = 18): string {
  return formatUnits(value, decimals)
}

export function formatEth(value: bigint): string {
  return formatEther(value)
}

export function parseChainId(chainId: string | number): number {
  const id = typeof chainId === 'string' ? parseInt(chainId, 10) : chainId
  if (isNaN(id) || id <= 0) {
    throw new Error(`Invalid chain ID: ${chainId}`)
  }
  return id
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function isHexString(value: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(value)
}
