/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * The Filesystem class provides a virtual filesystem for the ecmaOS kernel.
 * 
 * @see {@link https://github.com/zen-fs/core ZenFS}
 *
 */

import { TFunction } from 'i18next'
import { configure as configureZenFS, fs, InMemory } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'
import { TarReader } from '@gera2ld/tarjs'
import pako from 'pako'
import path from 'path'

import type { ConfigMounts, Configuration } from '@zenfs/core'

import type {
  FilesystemConfigMounts,
  FilesystemOptions
} from '@ecmaos/types'

export const DefaultFilesystemOptions: Configuration<ConfigMounts> = {
  uid: 0,
  gid: 0,
  addDevices: true,
  defaultDirectories: true,
  disableAccessChecks: false,
  disableAsyncCache: false,
  onlySyncOnClose: false,
  log: {
    level: 'debug',
    enabled: false
  },
  mounts: {
    '/': { backend: IndexedDB, options: { storeName: 'root' } },
    '/media': { backend: InMemory, options: { name: 'media' } },
    '/mnt': { backend: InMemory, options: { name: 'mnt' } },
    '/proc': { backend: InMemory, options: { name: 'procfs' } },
    '/tmp': { backend: InMemory, options: { name: 'tmpfs' } }
  },
}

/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * The Filesystem class provides a virtual filesystem for the ecmaOS kernel.
 * 
 * @see {@link https://github.com/zen-fs/core ZenFS}
 *
 */
export class Filesystem {
  private _config: Configuration<ConfigMounts> = DefaultFilesystemOptions
  private _fs: typeof fs = fs

  /**
   * @returns {FilesystemOptions} The filesystem options.
   */
  get config() { return this._config }

  /**
   * @returns {ZenFS.constants} Constants related to the filesystem.
   */
  get constants() { return this._fs.constants }

  /**
   * @returns The filesystem credentials.
   */
  // get credentials(): Credentials { return credentials }

  /**
   * @returns {DeviceFS} The device filesystem.
   * @remarks Remove or replace this; zenfs.mounts is deprecated.
   */
  // get devfs(): DeviceFS { return this._fs.mounts.get('/dev') as DeviceFS }

  /**
   * @returns {ZenFS.fs.promises} The asynchronous ZenFS filesystem instance.
   */
  get fs() { return this._fs.promises }

  /**
   * @returns {ZenFS.fs} The synchronous ZenFS filesystem instance.
   */
  get fsSync() { return this._fs }

  /**
   * @returns {ZenFS.mounts} The mounted filesystems.
   * @remarks Remove or replace this; zenfs.mounts is deprecated.
   */
  // get mounts(): typeof fs.mounts { return this._fs.mounts }

  /**
   * Configures the filesystem with the given options.
   * @param {FilesystemOptions} options - The options for the filesystem.
   * @returns {Promise<void>} A promise that resolves when the filesystem is configured.
   */
  async configure(options: Partial<Configuration<ConfigMounts>>) {
    if (!options) return
    this._config = options as Configuration<ConfigMounts>
    const store = await indexedDB.databases()
    await configureZenFS(options)

    if (store.length === 0 && import.meta.env['VITE_INITFS']) {
      try {
        const response = await fetch(import.meta.env['VITE_INITFS'])
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
        const arrayBuffer = await response.arrayBuffer()
        // The browser will likely automatically decompress the tarball; either way, extractTarball will handle it
        await this.fs.writeFile('/tmp/initfs.tar', new Uint8Array(arrayBuffer))
        await this.extractTarball('/tmp/initfs.tar', '/')
        await this.fs.unlink('/tmp/initfs.tar')
      } catch (error) {
        globalThis.kernel?.log.error(`Failed to fetch ${import.meta.env['VITE_INITFS']}: ${error}`)
        console.error(error)
      }
    }
  }

  /**
   * Checks if a file or directory exists at the given path.
   * @param {string} path - The path to check.
   * @returns {Promise<boolean>} A promise that resolves to true if the path exists, false otherwise.
   * 
   * @remarks A shortcut for `kernel.filesystem.fs.exists`
   */
  async exists(path: string) {
    return await this.fs.exists(path)
  }

  /**
   * Extracts a tarball to the given path.
   * @param {string} tarballPath - The path to the tarball.
   * @param {string} extractPath - The path to extract the tarball to.
   * @param {number} fileMode - The mode to set for files. Defaults to 0o644.
   * @param {number} directoryMode - The mode to set for directories. Defaults to 0o755.
   * @returns {Promise<void>} A promise that resolves when the tarball is extracted.
   */
  async extractTarball(tarballPath: string, extractPath: string, fileMode: number = 0o644, directoryMode: number = 0o755) {
    const tarball = await this.fs.readFile(tarballPath)
    
    // Check if the file is gzipped by looking at the magic bytes
    const isGzipped = tarball.length >= 2 && tarball[0] === 0x1f && tarball[1] === 0x8b
    
    // Only decompress if the file is actually gzipped
    const tarData = isGzipped ? pako.ungzip(tarball) : tarball
    const tar = await TarReader.load(tarData)

    const hasPackageDir = tar.fileInfos.some(file => file.name.startsWith('package/'))
    const stripPrefix = hasPackageDir ? 'package/' : ''

    for (const file of tar.fileInfos) {
      if (hasPackageDir && !file.name.startsWith(stripPrefix)) continue

      const relativePath = hasPackageDir ? file.name.slice(stripPrefix.length) : file.name
      if (!relativePath) continue

      try {
        if (relativePath.endsWith('/')) {
          await this.fs.mkdir(path.join(extractPath, relativePath), { mode: directoryMode, recursive: true })
          continue
        }

        await this.fs.mkdir(path.join(extractPath, path.dirname(relativePath)), { mode: directoryMode, recursive: true })

        const blob = tar.getFileBlob(file.name)
        const binaryData = await blob.arrayBuffer().then(buffer => new Uint8Array(buffer))
        const filePath = path.join(extractPath, relativePath)
        await this.fs.writeFile(filePath, binaryData, { encoding: 'binary', mode: fileMode })
      } catch (error) {
        globalThis.kernel?.terminal.writeln(`Failed to extract file ${file.name}: ${error}`)
      }
    }
  }

  /**
   * Returns the default filesystem options with the given extensions.
   * @param {Partial<FilesystemOptions>} extensions - The extensions to apply to the default options.
   * @returns {FilesystemOptions} The filesystem options with the given extensions.
   *
   */
  static options<T extends FilesystemConfigMounts>(extensions?: Partial<FilesystemOptions<T>>): FilesystemOptions<T> {
    return {
      ...DefaultFilesystemOptions,
      ...(extensions || {})
    } as FilesystemOptions<T>
  }

  // Descriptions for common filesystem entries
  descriptions = (t?: TFunction | ((key: string) => string)) => {
    if (!t) t = (k: string) => { return k }

    return new Map([
      ['/bin', t('User Programs')],
      ['/boot', t('Boot files')],
      ['/dev', t('Device files')],
      ['/etc', t('Configuration files')],
      ['/home', t('User home directories')],
      ['/lib', t('Library files')],
      ['/mnt', t('Temporary mount point')],
      ['/opt', t('Optional applications')],
      ['/proc', t('Process/system information')],
      ['/root', t('Root user home directory')],
      ['/run', t('Runtime data')],
      ['/sbin', t('System programs')],
      ['/sys', t('System files')],
      ['/tmp', t('Temporary files')],
      ['/usr', t('User data')],
      ['/var', t('Variable data')],

      ['/proc/connection', t('Network Connection Data')],
      ['/proc/host', t('Hostname')],
      ['/proc/language', t('Language Information')],
      ['/proc/memory', t('Memory Information')],
      ['/proc/platform', t('Platform Information')],
      ['/proc/querystring', t('Query String')],
      ['/proc/userAgent', t('User Agent')],
      ['/proc/userAgentData', t('User Agent Data')],
      ['/proc/version', t('Kernel Version')],

      ['.bmp', t('Bitmap Image')],
      ['.gif', t('GIF Image')],
      ['.jpg', t('JPEG Image')],
      ['.jpeg', t('JPEG Image')],
      ['.js', t('JavaScript File')],
      ['.json', t('JSON Data')],
      ['.md', t('Markdown Document')],
      ['.pdf', t('PDF Document')],
      ['.png', t('PNG Image')],
      ['.sixel', t('Sixel Graphics')],
      ['.txt', t('Text File')],
      ['.wasm', t('WebAssembly Module')],
      ['.wat', t('WebAssembly Text Format')]
    ])
  }
}
