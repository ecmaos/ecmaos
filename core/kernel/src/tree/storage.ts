import type { Kernel, StorageOptions, StorageProvider } from '@ecmaos/types'

export class Storage implements StorageProvider {
  private _db: IDBDatabase | null = null
  private _kernel: Kernel

  get db() { return this._db }
  get kernel() { return this._kernel }

  indexed = globalThis.indexedDB
  local = globalThis.localStorage
  session = globalThis.sessionStorage

  constructor(options: StorageOptions) {
    this._kernel = options.kernel

    navigator.storage?.persist?.()

    if (this.indexed) {
      const name = options.indexed?.name || 'ecmaos:storage'
      const open = this.indexed.open(name, options.indexed?.version || 1)

      open.onsuccess = () => {
        this._db = open.result
        this._kernel.log.silly(`IndexedDB connection to ${name} successful`)
      }

      open.onerror = () => {
        this._kernel.log.error('IndexedDB connection failed')
      }

      open.onupgradeneeded = (event) => {
        const db = open.result
        db.onerror = event => this._kernel.log.error('IndexedDB connection failed', event)
        const store = db.createObjectStore('ecmaos:storage', { keyPath: 'id', autoIncrement: true })

        switch (event.newVersion) {
          case 1:
            store.createIndex('data', 'data', { unique: false })
            break
        }

        this._kernel.log.silly(`IndexedDB schema ${event.newVersion === 1 ? 'created' : 'updated to version ${event.newVersion}'}`)
      }
    }
  }

  async usage() {
    try {
      const usage = await navigator.storage?.estimate?.()
      if (!usage) throw new Error('Storage usage not available')
      return usage
    } catch (error) {
      this._kernel.log.error('Storage usage failed', error)
      return null
    }
  }
}
