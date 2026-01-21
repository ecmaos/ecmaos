/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * The I18n class is responsible for internationalization of the kernel.
 * It uses i18next for translation and provides a convenient interface for loading translations from the filesystem.
 */

import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resources from 'virtual:i18next-loader'

import type { InitOptions, Resource, TFunction } from 'i18next'
import type { I18nFilesystemAdapter, I18nResourceLoadResult } from '@ecmaos/types'

export const DefaultI18nOptions: InitOptions = {
  resources,
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'kernel', 'filesystem', 'coreutils', 'terminal'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false
  }
}

export class I18n {
  private _i18next: typeof i18next
  private _fsTranslationsPath: string
  private _languageDetector: LanguageDetector

  get i18next() { return this._i18next as typeof i18next }
  get language() { return this._i18next.language }
  get t() { return this._i18next.t as typeof i18next.t }

  get ns(): {
    common: TFunction
    kernel: TFunction
    filesystem: TFunction
    coreutils: TFunction
    terminal: TFunction
  } {
    return {
      common: this._i18next.getFixedT(this.language || 'en', 'common') as TFunction,
      kernel: this._i18next.getFixedT(this.language || 'en', 'kernel') as TFunction,
      filesystem: this._i18next.getFixedT(this.language || 'en', 'filesystem') as TFunction,
      coreutils: this._i18next.getFixedT(this.language || 'en', 'coreutils') as TFunction,
      terminal: this._i18next.getFixedT(this.language || 'en', 'terminal') as TFunction
    }
  }

  constructor(_options?: InitOptions & { fsTranslationsPath?: string }) {
    const options = { ...DefaultI18nOptions, ..._options }
    this._i18next = i18next
    this._fsTranslationsPath = options.fsTranslationsPath || '/usr/share/locales'
    this._languageDetector = new LanguageDetector(null, {
      order: ['navigator', 'htmlTag'],
      caches: []
    })
    
    i18next.init(options)
    if (i18next.services) {
      this._languageDetector.init(i18next.services, {
        order: ['navigator', 'htmlTag'],
        caches: []
      })
    }
  }

  /**
   * Converts a locale string to a language code
   * Examples: 'en_US' -> 'en', 'es_ES' -> 'es', 'en' -> 'en'
   */
  localeToLanguage(locale: string): string {
    const parts = locale.split('_')
    return parts[0]?.toLowerCase() || 'en'
  }

  /**
   * Converts a language code to a locale string
   * Examples: 'en' -> 'en_US', 'es' -> 'es_ES'
   * Falls back to language code if no region mapping exists
   */
  languageToLocale(language: string): string {
    const lang = language.toLowerCase()
    const regionMap: Record<string, string> = {
      en: 'en_US',
      es: 'es_ES',
      fr: 'fr_FR',
      de: 'de_DE',
      it: 'it_IT',
      pt: 'pt_PT',
      ru: 'ru_RU',
      ja: 'ja_JP',
      zh: 'zh_CN',
      ko: 'ko_KR'
    }
    return regionMap[lang] || lang
  }

  /**
   * Detects the browser language using the language detector
   * Returns the detected language code (e.g., 'en', 'es')
   */
  detectBrowserLanguage(): string {
    const detected = this._languageDetector.detect()
    if (Array.isArray(detected)) {
      return detected[0] || 'en'
    }
    return (detected as string) || 'en'
  }

  /**
   * Sets the language for i18next
   * @param locale - Locale string (e.g., 'en_US', 'es_ES', 'en', 'es')
   */
  setLanguage(locale: string): void {
    const language = this.localeToLanguage(locale)
    this._i18next.changeLanguage(language)
  }

  async loadFilesystemResources(
    fs: I18nFilesystemAdapter,
    rootPath?: string
  ): Promise<I18nResourceLoadResult> {
    const result: I18nResourceLoadResult = { bundles: 0, files: 0, errors: [] }
    const root = rootPath || this._fsTranslationsPath

    try {
      if (!await fs.exists(root)) return result
    } catch (error) {
      result.errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`)
      return result
    }

    let languageDirs: string[]
    try {
      languageDirs = await fs.readdir(root)
    } catch (error) {
      result.errors.push(`${root}: ${error instanceof Error ? error.message : String(error)}`)
      return result
    }

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)

    for (const language of languageDirs) {
      const languagePath = `${root}/${language}`
      try {
        const stat = await fs.stat(languagePath)
        if (!stat.isDirectory()) continue
      } catch (error) {
        result.errors.push(`${languagePath}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      let entries: string[]
      try {
        entries = await fs.readdir(languagePath)
      } catch (error) {
        result.errors.push(`${languagePath}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        const namespace = entry.slice(0, -5)
        const filePath = `${languagePath}/${entry}`

        try {
          const contents = await fs.readFile(filePath, 'utf-8')
          const parsed = JSON.parse(contents) as unknown
          if (!isRecord(parsed)) {
            result.errors.push(`${filePath}: invalid resource format`)
            continue
          }
          this._i18next.addResourceBundle(language, namespace, parsed as Resource, true, true)
          result.files += 1
          result.bundles += 1
        } catch (error) {
          result.errors.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    return result
  }
}
