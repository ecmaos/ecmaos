/**
 * User management types and interfaces
 */

import type { Kernel } from './kernel.ts'

/** User ID type */
export type UID = number

/** Group ID type */
export type GID = number

/**
 * Options for configuring user management
 */
export interface UsersOptions {
  /** Reference to kernel instance */
  kernel: Kernel
}

/**
 * Interface representing a user
 */
export interface User {
  /** Home directory path */
  home: string
  /** Group ID */
  gid: number
  /** Additional Groups */
  groups: number[]
  /** Username */
  username: string
  /** Shell path */
  shell: string
  /** Password hash */
  password: string
  /** User ID */
  uid: number
  /** Optional keypair for authentication */
  keypair?: {
    /** Private key (may be encrypted) */
    privateKey?: JsonWebKey | string
    /** Public key */
    publicKey: JsonWebKey
  }
}

/**
 * Options for adding a new user
 */
export interface AddUserOptions {
  /** Skip password hashing */
  noHash?: boolean
  /** Skip home directory creation */
  noHome?: boolean
  /** Skip writing to passwd file */
  noWrite?: boolean
}

/**
 * Interface representing a passkey credential
 */
export interface Passkey {
  /** Unique identifier for this passkey */
  id: string
  /** Base64-encoded credential ID from WebAuthn */
  credentialId: string
  /** Public key data (COSE format) */
  publicKey: ArrayBuffer | Uint8Array
  /** Timestamp when passkey was created */
  createdAt: number
  /** Timestamp when passkey was last used (optional) */
  lastUsed?: number
  /** User-friendly name/description (optional) */
  name?: string
}

/**
 * Interface for user management functionality
 */
export interface Users {
  /** Get all users */
  readonly all: Map<UID, User>

  /**
   * Add a new user
   * @param user - User to add
   * @param options - Options for adding user
   */
  add(user: Partial<User>, options?: AddUserOptions): Promise<void>

  /**
   * Get a user by ID
   * @param uid - User ID
   */
  get(uid: UID): User | undefined

  /**
   * Load users from storage
   */
  load(): Promise<void>

  /**
   * Login with credentials
   * @param username - Username
   * @param password - Password (optional if using passkey)
   * @param passkeyCredential - Passkey credential (optional if using password)
   */
  login(username: string, password?: string, passkeyCredential?: PublicKeyCredential): Promise<{ user: User, cred: { uid: number, gid: number } }>

  /**
   * Change a user's password
   * @param oldPassword - Current password
   * @param newPassword - New password
   */
  password(oldPassword: string, newPassword: string): Promise<void>

  /**
   * Remove a user
   * @param uid - User ID to remove
   */
  remove(uid: UID): Promise<void>

  /**
   * Update a user
   * @param uid - User ID to update
   * @param updates - User properties to update
   */
  update(uid: UID, updates: Partial<User>): Promise<void>

  /**
   * Get all passkeys for a user
   * @param uid - User ID
   */
  getPasskeys(uid: UID): Promise<Passkey[]>

  /**
   * Save passkeys for a user
   * @param uid - User ID
   * @param passkeys - Array of passkeys to save
   */
  savePasskeys(uid: UID, passkeys: Passkey[]): Promise<void>

  /**
   * Add a passkey to a user's collection
   * @param uid - User ID
   * @param passkey - Passkey to add
   */
  addPasskey(uid: UID, passkey: Passkey): Promise<void>

  /**
   * Remove a passkey by ID
   * @param uid - User ID
   * @param passkeyId - Passkey ID to remove
   */
  removePasskey(uid: UID, passkeyId: string): Promise<void>

  /**
   * Check if a user has any registered passkeys
   * @param uid - User ID
   */
  hasPasskeys(uid: UID): Promise<boolean>
} 