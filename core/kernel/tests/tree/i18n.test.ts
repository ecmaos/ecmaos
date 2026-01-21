import { describe, it, expect } from 'vitest'
import { I18n } from '#i18n.ts'

describe('I18n', () => {
  it('should be able to get a translation', () => {
    const i18n = new I18n({ lng: 'en' })
    expect(i18n.t('permissionNotificationDenied', { ns: 'kernel' })).toBe('Notification permission denied')
  })
})
