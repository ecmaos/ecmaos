/**
 * Filesystem types and interfaces
 */

import type { Configuration, ConfigMounts, fs } from '@zenfs/core'
import type { TFunction } from 'i18next'

/**
 * Type alias for filesystem mount configurations
 */
export type FilesystemConfigMounts = ConfigMounts

/**
 * Options for configuring the filesystem
 */
export type FilesystemOptions<T extends FilesystemConfigMounts> = Configuration<T>

/**
 * Represents a path in the filesystem
 */
export type Path = string

/**
 * Interface for file headers
 */
export interface FileHeader {
  /** Type of file */
  type: string
  /** Optional namespace */
  namespace?: string
  /** Optional name */
  name?: string
}

/**
 * Interface for filesystem descriptions
 */
export interface FilesystemDescriptions {
  /**
   * Get filesystem descriptions with optional translation function
   */
  descriptions: (t?: TFunction | ((key: string) => string)) => Map<string, string>
}

/**
 * Interface for filesystem functionality
 */
export interface Filesystem {
  /** Get the filesystem configuration */
  readonly config: FilesystemOptions<ConfigMounts>
  /** Get filesystem constants */
  readonly constants: any
  /** Get filesystem credentials */
  // readonly credentials: any
  /** Get the device filesystem */
  // readonly devfs: any
  /** Get the asynchronous filesystem instance */
  readonly fs: typeof fs.promises
  /** Get the synchronous filesystem instance */
  readonly fsSync: typeof fs
  /** Get mounted filesystems */
  // readonly mounts: Map<string, any>

  /**
   * Configure the filesystem
   * @param options - Configuration options
   */
  configure(options: Partial<FilesystemOptions<ConfigMounts>>): Promise<void>

  /**
   * Check if a path exists
   * @param path - Path to check
   */
  exists(path: string): Promise<boolean>

  /**
   * Extracts a tarball to the given path.
   * @param tarballPath - The path to the tarball.
   * @param extractPath - The path to extract the tarball to.
   */
  extractTarball(tarballPath: string, extractPath: string): Promise<void>

  /**
   * Get filesystem descriptions
   * @param t - Optional translation function
   */
  descriptions(t?: TFunction | ((key: string) => string)): Map<string, string>
} 