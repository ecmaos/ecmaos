import i18next from 'i18next'
import resources from 'virtual:i18next-loader'

import type { InitOptions, TFunction } from 'i18next'

// TODO: find a different approach than virtual loader
// const resources = {}

export const DefaultI18nOptions: InitOptions = {
  resources,
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'kernel', 'filesystem'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false
  }
}

export class I18n {
  private _i18next: typeof i18next

  get i18next() { return this._i18next as typeof i18next }
  get language() { return this._i18next.language }
  get t() { return this._i18next.t as typeof i18next.t }

  get ns(): {
    common: TFunction
    kernel: TFunction
    filesystem: TFunction
  } {
    return {
      common: this._i18next.getFixedT(this.language || 'en', 'common') as TFunction,
      kernel: this._i18next.getFixedT(this.language || 'en', 'kernel') as TFunction,
      filesystem: this._i18next.getFixedT(this.language || 'en', 'filesystem') as TFunction
    }
  }

  constructor(_options?: InitOptions) {
    const options = { ...DefaultI18nOptions, ..._options }
    this._i18next = i18next
    i18next.init(options)
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
   * Sets the language for i18next
   * @param locale - Locale string (e.g., 'en_US', 'es_ES', 'en', 'es')
   */
  setLanguage(locale: string): void {
    const language = this.localeToLanguage(locale)
    this._i18next.changeLanguage(language)
  }
}
