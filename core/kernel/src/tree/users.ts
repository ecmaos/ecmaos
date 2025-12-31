/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * The Users class handles the management of users on the system.
 * It provides functionality to add, get, load, login, password, remove, and update users.
 */

import type {
  AddUserOptions,
  Passkey,
  User,
  UsersOptions
} from '@ecmaos/types'
import { createCredentials, Credentials } from '@zenfs/core'

export class Users {
  private _options: UsersOptions
  private _users: Map<number, User> = new Map()

  get all() { return this._users }

  constructor(options: UsersOptions) {
    this._options = options
  }

  /**
   * Add a user to the system
   */
  async add(user: Partial<User>, options: AddUserOptions = {}) {
    if (!user.uid) user.uid = this._users.size
    if (!user.gid) user.gid = user.uid
    if (!user.groups) user.groups = []
    if (!user.shell) user.shell = 'ecmaos'
    if (!user.home) user.home = `/home/${user.username}`

    if (!user.username || !user.password) throw new Error('Username and password are required')
    if (this._users.has(user.uid) || Array.from(this._users.values()).some(u => u.username === user.username))
      throw new Error(`User with UID ${user.uid} or username ${user.username} already exists`)

    const invalidChars = /[#/\\&=:\t\r\n\f]/
    if (invalidChars.test(user.username)) throw new Error('Username contains invalid characters')
    user.username = user.username.replace(/[^\x20-\x7E]+/g, '') // remove non-printable characters

    // TODO: validate
    const unhashedPassword = user.password
    if (!options.noHash) {
      const hashedPassword = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(unhashedPassword.trim()))
      user.password = Array.from(new Uint8Array(hashedPassword)).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    if (!options.noHome) {
      await this._options.kernel.filesystem.fs.mkdir(user.home, { recursive: true, mode: 0o750 })
    }

    if (!user.keypair) {
      const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify'])
      const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
      const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey)

      // Pad password to 32 bytes (256 bits) for AES-256
      const paddedPassword = new TextEncoder().encode(unhashedPassword.padEnd(32, '\0')).slice(0, 32)

      let aesKey
      try {
        aesKey = await crypto.subtle.importKey(
          'raw',
          paddedPassword,
          'AES-GCM',
          false,
          ['encrypt', 'decrypt']
        )
      } catch (err) {
        console.error(err)
        throw err
      }

      const iv = crypto.getRandomValues(new Uint8Array(12))
      const encryptedPrivateKeyBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        new TextEncoder().encode(JSON.stringify(privateKey))
      )

      const encryptedData = new Uint8Array(iv.length + encryptedPrivateKeyBuffer.byteLength)
      encryptedData.set(iv)
      encryptedData.set(new Uint8Array(encryptedPrivateKeyBuffer), iv.length)
      const encryptedPrivateKey = btoa(String.fromCharCode(...encryptedData))

      user.keypair = { publicKey }
      if (!options.noWrite) await this._options.kernel.filesystem.fs.appendFile('/etc/shadow', `${user.username}:${user.uid}:${user.gid}:${user.password}:${btoa(JSON.stringify(publicKey))}:${encryptedPrivateKey}\n\n`, { encoding: 'utf-8', mode: 0o700 })
    }

    if (!options.noWrite) await this._options.kernel.filesystem.fs.appendFile('/etc/passwd', `${user.username}:${user.uid}:${user.gid}:${user.groups.join(',')}:${user.home}:${user.shell}\n\n`, { encoding: 'utf-8', mode: 0o700 })
    this._users.set(user.uid, user as User)

    // Fix user home permissions
    try { await this._options.kernel.filesystem.fs.chown(user.home, user.uid, user.gid) }
    catch {}
  }

  /**
   * Get a user by UID
   */
  get(uid: number) {
    return this._users.get(uid)
  }

  /**
   * Load users from the filesystem
   */
  async load() {
    const { kernel } = this._options
    const passwd = await kernel.filesystem.fs.readFile('/etc/passwd', 'utf-8')
    const shadow = await kernel.filesystem.fs.readFile('/etc/shadow', 'utf-8')
    for (const line of passwd.split('\n')) {
      if (line.trim() === '' || line.trim() === '\n' || line.startsWith('#')) continue
      const [username, uid, gid, groups, home, shell] = line.split(':')
      if (!username || !uid || !gid || !home || !shell) continue
      const shadowEntry = shadow.split('\n').find((l: string) => l.startsWith(username + ':'))

      if (shadowEntry) {
        const [,,, password, publicKey, encryptedPrivateKey] = shadowEntry.split(':')
        if (!publicKey || !encryptedPrivateKey) {
          kernel.log.warn(`User ${username} has no keypair`)
          continue
        }

        const keypair = { publicKey: JSON.parse(atob(publicKey!)), privateKey: encryptedPrivateKey }
        await this.add({
          username,
          password,
          uid: parseInt(uid),
          gid: parseInt(gid),
          groups: groups?.split(',').filter((g: string) => g !== '').map(Number) ?? [],
          home,
          shell,
          keypair
        }, { noWrite: true, noHome: true, noHash: true })
      } else {
        kernel.log.warn(`User ${username} not found in /etc/shadow`)
      }
    }
  }

  /**
   * Login a user
   */
  async login(username: string, password?: string, passkeyCredential?: PublicKeyCredential): Promise<{ user: User, cred: Credentials }> {
    const user = Array.from(this._users.values()).find(u => u.username === username)
    if (!user) throw new Error('Invalid username or password')

    if (passkeyCredential) {
      const passkeys = await this.getPasskeys(user.uid)
      const credential = passkeyCredential as PublicKeyCredential
      
      const credentialId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
      const matchingPasskey = passkeys.find(pk => pk.credentialId === credentialId)
      
      if (!matchingPasskey) {
        throw new Error('Passkey not found for this user')
      }

      matchingPasskey.lastUsed = Date.now()
      await this.savePasskeys(user.uid, passkeys)
    } else if (password) {
      const hashedPassword = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password.trim()))
      if (user.password !== Array.from(new Uint8Array(hashedPassword)).map(b => b.toString(16).padStart(2, '0')).join('')) {
        throw new Error('Invalid username or password')
      }
    } else {
      throw new Error('Password or passkey required')
    }

    const cred = createCredentials({
      uid: user.uid,
      gid: user.gid,
      euid: user.uid,
      egid: user.gid,
      groups: user.groups
    })

    return { user, cred }
  }

  async password(oldPassword: string, newPassword: string) {
    const user = this._users.get(this._options.kernel.shell.credentials.uid)
    if (!user) throw new Error(this._options.kernel.i18n.t('User not found'))

    try {
      const hashedOldPassword = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(oldPassword.trim()))
      if (user.password !== Array.from(new Uint8Array(hashedOldPassword)).map(b => b.toString(16).padStart(2, '0')).join('')) throw new Error('Invalid password')

      const hashedNewPassword = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(newPassword.trim()))
      user.password = Array.from(new Uint8Array(hashedNewPassword)).map(b => b.toString(16).padStart(2, '0')).join('')
      await this.update(user.uid, user)
      await this._options.kernel.filesystem.fs.writeFile('/etc/passwd', Array.from(this._users.values()).map(u => `${u.username}:${u.uid}:${u.gid}:${u.groups.join(',')}:${u.home}:${u.shell}`).join('\n'), { encoding: 'utf-8', mode: 0o750 })
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  /**
   * Remove a user from the system
  */
  async remove(uid: number) {
    this._users.delete(uid)
    await this._options.kernel.filesystem.fs.writeFile('/etc/passwd', Array.from(this._users.values()).map(u => `${u.username}:${u.uid}:${u.gid}:${u.groups.join(',')}:${u.home}:${u.shell}`).join('\n'), { encoding: 'utf-8', mode: 0o750 })
    // we leave the home directory behind for the admin to delete manually
  }

  /**
   * Update a user
   */
  async update(uid: number, user: Partial<User>) {
    const existingUser = this._users.get(uid);
    if (existingUser) {
      this._users.set(uid, { ...existingUser, ...user });
      await this._options.kernel.filesystem.fs.writeFile('/etc/passwd', Array.from(this._users.values()).map(u => `${u.username}:${u.uid}:${u.gid}:${u.groups.join(',')}:${u.home}:${u.shell}`).join('\n'), { encoding: 'utf-8', mode: 0o750 })
    } else {
      throw new Error(`User with UID ${uid} not found`);
    }
  }

  /**
   * Get all passkeys for a user
   */
  async getPasskeys(uid: number): Promise<Passkey[]> {
    const user = this._users.get(uid)
    if (!user) return []

    const passkeysPath = `${user.home}/.passkeys`
    try {
      const exists = await this._options.kernel.filesystem.fs.exists(passkeysPath)
      if (!exists) return []

      const content = await this._options.kernel.filesystem.fs.readFile(passkeysPath, 'utf-8')
      const parsed = JSON.parse(content) as Array<Omit<Passkey, 'publicKey'> & { publicKey: string }>
      
      return parsed.map(pk => {
        const publicKeyArray = JSON.parse(pk.publicKey)
        return {
          ...pk,
          publicKey: new Uint8Array(publicKeyArray)
        }
      })
    } catch (error) {
      this._options.kernel.log.warn(`Failed to read passkeys for user ${uid}: ${error}`)
      return []
    }
  }

  /**
   * Save passkeys for a user
   */
  async savePasskeys(uid: number, passkeys: Passkey[]): Promise<void> {
    const user = this._users.get(uid)
    if (!user) throw new Error(`User with UID ${uid} not found`)

    const passkeysPath = `${user.home}/.passkeys`
    
    const serialized = passkeys.map(pk => {
      const publicKeyArray = pk.publicKey instanceof ArrayBuffer 
        ? Array.from(new Uint8Array(pk.publicKey))
        : Array.from(pk.publicKey)
      
      return {
        ...pk,
        publicKey: JSON.stringify(publicKeyArray)
      }
    })

    await this._options.kernel.filesystem.fs.writeFile(
      passkeysPath,
      JSON.stringify(serialized, null, 2),
      { encoding: 'utf-8', mode: 0o600 }
    )
    
    try {
      await this._options.kernel.filesystem.fs.chown(passkeysPath, uid, user.gid)
    } catch {}
  }

  /**
   * Add a passkey to a user's collection
   */
  async addPasskey(uid: number, passkey: Passkey): Promise<void> {
    const existing = await this.getPasskeys(uid)
    existing.push(passkey)
    await this.savePasskeys(uid, existing)
  }

  /**
   * Remove a passkey by ID
   */
  async removePasskey(uid: number, passkeyId: string): Promise<void> {
    const existing = await this.getPasskeys(uid)
    const filtered = existing.filter(pk => pk.id !== passkeyId)
    await this.savePasskeys(uid, filtered)
  }

  /**
   * Check if a user has any registered passkeys
   */
  async hasPasskeys(uid: number): Promise<boolean> {
    const passkeys = await this.getPasskeys(uid)
    return passkeys.length > 0
  }
}
