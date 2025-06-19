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
import { configure, fs, InMemory } from '@zenfs/core'
import { IndexedDB } from '@zenfs/dom'
import { TarReader } from '@gera2ld/tarjs'
import pako from 'pako'
import path from 'path'

import type { ConfigMounts } from '@zenfs/core'

import type {
  FilesystemConfigMounts,
  FilesystemOptions
} from '@ecmaos/types'

export const DefaultFilesystemOptions: FilesystemOptions<FilesystemConfigMounts> = {
  uid: 0,
  gid: 0,
  addDevices: true,
  disableAccessChecks: false,
  disableAsyncCache: true,
  onlySyncOnClose: false,
  log: {
    level: 'debug',
    enabled: false
  },
  mounts: {
    '/': { backend: IndexedDB, storeName: 'root' },
    '/media': { backend: InMemory, name: 'media' },
    '/mnt': { backend: InMemory, name: 'mnt' },
    '/proc': { backend: InMemory, name: 'procfs' },
    '/tmp': { backend: InMemory, name: 'tmpfs' }
  }
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
  private _config: FilesystemOptions<ConfigMounts> = DefaultFilesystemOptions
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
  async configure(options: Partial<FilesystemOptions<ConfigMounts>>) {
    if (!options) return
    this._config = options as FilesystemOptions<ConfigMounts>
    await configure(options)
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
   * @returns {Promise<void>} A promise that resolves when the tarball is extracted.
   */
  async extractTarball(tarballPath: string, extractPath: string) {
    const tarball = await this.fs.readFile(tarballPath)
    const decompressed = pako.ungzip(tarball)
    const tar = await TarReader.load(decompressed)

    const hasPackageDir = tar.fileInfos.some(file => file.name.startsWith('package/'))
    const stripPrefix = hasPackageDir ? 'package/' : ''

    for (const file of tar.fileInfos) {
      if (hasPackageDir && !file.name.startsWith(stripPrefix)) continue

      const relativePath = hasPackageDir ? file.name.slice(stripPrefix.length) : file.name
      if (!relativePath) continue

      try {
        if (relativePath.endsWith('/')) {
          await this.fs.mkdir(path.join(extractPath, relativePath), { mode: 0o755, recursive: true })
          continue
        }

        await this.fs.mkdir(path.join(extractPath, path.dirname(relativePath)), { mode: 0o755, recursive: true })

        const blob = tar.getFileBlob(file.name)
        const binaryData = await blob.arrayBuffer().then(buffer => new Uint8Array(buffer))
        const filePath = path.join(extractPath, relativePath)
        await this.fs.writeFile(filePath, binaryData, { encoding: 'binary', mode: 0o644 })
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
  static options<T extends ConfigMounts>(extensions?: Partial<FilesystemOptions<T>>): FilesystemOptions<T> {
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
