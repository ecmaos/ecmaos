/**
 * Internationalization types and interfaces
 */

import type { InitOptions, TFunction } from 'i18next'
import type i18next from 'i18next'

/**
 * Utility describing the shape of a translation resources object.
 * Example: { en: { common: { ... }, kernel: { ... } }, es: { ... } }
 */
export type I18nResourceBundle = Record<string, Record<string, Record<string, string>>>

/**
 * Options for configuring internationalization
 */
export interface I18nOptions extends InitOptions {
  resources?: I18nResourceBundle
  lng?: string
  fallbackLng?: string
  ns?: string[]
  defaultNS?: string
  interpolation?: {
    escapeValue?: boolean
  }
}

/**
 * Namespaces helper for typed translation.
 * This matches the ns object in I18n class.
 */
export interface I18nNamespaces {
  common: TFunction
  kernel: TFunction
  filesystem: TFunction
}

/**
 * Interface for internationalization functionality.
 *
 * Mirrors i18n API and helpers from kernel/src/tree/i18n.ts.
 */
export interface I18n {
  /** Get the i18next instance */
  readonly i18next: typeof i18next
  /** Get the current language */
  readonly language: string
  /** Get the translation function */
  readonly t: TFunction
  /** Get fixed translation functions for particular namespaces */
  readonly ns: I18nNamespaces
  /**
   * Converts a locale string to a language code
   * Examples: 'en_US' -> 'en', 'es_ES' -> 'es', 'en' -> 'en'
   */
  localeToLanguage(locale: string): string
  /**
   * Sets the language for i18next
   * @param locale - Locale string (e.g., 'en_US', 'es_ES', 'en', 'es')
   */
  setLanguage(locale: string): void
}