import type { TopbarConfigOptions } from 'topbar'
import type { Notyf } from 'notyf'

/**
 * DOM types and interfaces
 */

/**
 * Options for configuring DOM features
 */
export interface DomOptions {
  /** Whether to show the topbar */
  topbar?: boolean
  /** Toast notification configuration options */
  toast?: object
}

/**
 * Interface for DOM functionality
 */
export interface Dom {
  /** Get the document instance */
  readonly document: Document
  /** Get the window instance */
  readonly window: Window
  /** Toast notification service */
  readonly toast: Notyf

  /**
   * Toggle or set the topbar visibility
   * @param show - Optional boolean to set visibility state
   */
  topbar(show?: boolean): Promise<void>

  /**
   * Configure the topbar
   * @param options - Options to configure the topbar (@see https://buunguyen.github.io/topbar)
   */
  topbarConfig(options: TopbarConfigOptions): Promise<void>

  /**
   * Set the topbar progress
   * @param value - Progress value (0-100)
   */
  topbarProgress(value: number): Promise<void>
} 