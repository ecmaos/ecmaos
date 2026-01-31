import type { Shell } from '@ecmaos/types'
import type { StoredAccount, AccountInfo } from '../types.js'
import { privateKeyToAccount, mnemonicToAccount, generateMnemonic, english } from 'viem/accounts'

const ACCOUNTS_DIR = '.config/web3/accounts'
const ACCOUNTS_FILE = 'accounts.json'
const CURRENT_ACCOUNT_FILE = 'current.json'

export async function getAccountsDir(shell: Shell): Promise<string> {
  return `${shell.envObject.HOME}/${ACCOUNTS_DIR}`
}

export async function getAccountsFile(shell: Shell): Promise<string> {
  const dir = await getAccountsDir(shell)
  return `${dir}/${ACCOUNTS_FILE}`
}

export async function getCurrentAccountFile(shell: Shell): Promise<string> {
  const dir = await getAccountsDir(shell)
  return `${dir}/${CURRENT_ACCOUNT_FILE}`
}

export async function ensureAccountsDir(shell: Shell): Promise<string> {
  const dir = await getAccountsDir(shell)
  const exists = await shell.context.fs.promises.exists(dir)
  if (!exists) {
    await shell.context.fs.promises.mkdir(dir, { recursive: true })
  }
  return dir
}

export async function loadAccounts(shell: Shell): Promise<StoredAccount[]> {
  await ensureAccountsDir(shell)
  const file = await getAccountsFile(shell)
  const exists = await shell.context.fs.promises.exists(file)
  if (!exists) {
    return []
  }
  
  try {
    const content = await shell.context.fs.promises.readFile(file, 'utf-8')
    return JSON.parse(content) as StoredAccount[]
  } catch {
    return []
  }
}

export async function saveAccounts(shell: Shell, accounts: StoredAccount[]): Promise<void> {
  await ensureAccountsDir(shell)
  const file = await getAccountsFile(shell)
  await shell.context.fs.promises.writeFile(file, JSON.stringify(accounts, null, 2), { mode: 0o600 })
}

export async function getCurrentAccount(shell: Shell): Promise<AccountInfo | null> {
  await ensureAccountsDir(shell)
  const file = await getCurrentAccountFile(shell)
  const exists = await shell.context.fs.promises.exists(file)
  if (!exists) {
    return null
  }
  
  try {
    const content = await shell.context.fs.promises.readFile(file, 'utf-8')
    return JSON.parse(content) as AccountInfo
  } catch {
    return null
  }
}

export async function setCurrentAccount(shell: Shell, account: AccountInfo | null): Promise<void> {
  await ensureAccountsDir(shell)
  const file = await getCurrentAccountFile(shell)
  if (account === null) {
    const exists = await shell.context.fs.promises.exists(file)
    if (exists) {
      await shell.context.fs.promises.unlink(file)
    }
    return
  }
  await shell.context.fs.promises.writeFile(file, JSON.stringify(account, null, 2))
}

export async function createAccount(shell: Shell, name?: string): Promise<AccountInfo> {
  const mnemonic = generateMnemonic(english)
  const account = mnemonicToAccount(mnemonic)
  
  const storedAccount: StoredAccount = {
    name,
    address: account.address,
    mnemonic,
    createdAt: new Date().toISOString()
  }
  
  const accounts = await loadAccounts(shell)
  accounts.push(storedAccount)
  await saveAccounts(shell, accounts)
  
  return {
    name,
    address: account.address,
    mnemonic,
    type: 'local'
  }
}

export async function importAccountFromPrivateKey(
  shell: Shell,
  privateKey: string,
  name?: string
): Promise<AccountInfo> {
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  
  const storedAccount: StoredAccount = {
    name,
    address: account.address,
    privateKey,
    createdAt: new Date().toISOString()
  }
  
  const accounts = await loadAccounts(shell)
  
  const existing = accounts.find(a => a.address.toLowerCase() === account.address.toLowerCase())
  if (existing) {
    throw new Error(`Account ${account.address} already exists`)
  }
  
  accounts.push(storedAccount)
  await saveAccounts(shell, accounts)
  
  return {
    name,
    address: account.address,
    privateKey,
    type: 'local'
  }
}

export async function importAccountFromMnemonic(
  shell: Shell,
  mnemonic: string,
  name?: string
): Promise<AccountInfo> {
  const account = mnemonicToAccount(mnemonic)
  
  const storedAccount: StoredAccount = {
    name,
    address: account.address,
    mnemonic,
    createdAt: new Date().toISOString()
  }
  
  const accounts = await loadAccounts(shell)
  
  const existing = accounts.find(a => a.address.toLowerCase() === account.address.toLowerCase())
  if (existing) {
    throw new Error(`Account ${account.address} already exists`)
  }
  
  accounts.push(storedAccount)
  await saveAccounts(shell, accounts)
  
  return {
    name,
    address: account.address,
    mnemonic,
    type: 'local'
  }
}

export async function listAccounts(shell: Shell): Promise<AccountInfo[]> {
  const accounts = await loadAccounts(shell)
  const localAccounts: AccountInfo[] = accounts.map(acc => ({
    name: acc.name,
    address: acc.address,
    type: 'local' as const
  }))
  
  const currentAccount = await getCurrentAccount(shell)
  if (currentAccount && currentAccount.type === 'extension') {
    const exists = localAccounts.some(
      acc => acc.address.toLowerCase() === currentAccount.address.toLowerCase()
    )
    if (!exists) {
      localAccounts.push({
        name: currentAccount.name,
        address: currentAccount.address,
        type: 'extension' as const
      })
    }
  }
  
  return localAccounts
}

export async function removeAccount(shell: Shell, identifier: string): Promise<boolean> {
  const accounts = await loadAccounts(shell)
  const identifierLower = identifier.toLowerCase()
  
  const index = accounts.findIndex(
    acc => acc.address.toLowerCase() === identifierLower ||
           acc.name?.toLowerCase() === identifierLower
  )
  
  if (index === -1) {
    return false
  }
  
  accounts.splice(index, 1)
  await saveAccounts(shell, accounts)
  
  const current = await getCurrentAccount(shell)
  if (current && (
    current.address.toLowerCase() === identifierLower ||
    current.name?.toLowerCase() === identifierLower
  )) {
    await setCurrentAccount(shell, null)
  }
  
  return true
}

export async function findAccount(shell: Shell, identifier: string): Promise<AccountInfo | null> {
  const accounts = await loadAccounts(shell)
  const identifierLower = identifier.toLowerCase()
  
  const stored = accounts.find(
    acc => acc.address.toLowerCase() === identifierLower ||
           acc.name?.toLowerCase() === identifierLower
  )
  
  if (!stored) {
    return null
  }
  
  return {
    name: stored.name,
    address: stored.address,
    privateKey: stored.privateKey,
    mnemonic: stored.mnemonic,
    type: 'local'
  }
}
