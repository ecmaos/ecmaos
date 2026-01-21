---
"@ecmaos/kernel": patch
"@ecmaos/types": patch
"@ecmaos/coreutils": patch
---

feat: i18n filesystem loading, browser detection, and Spanish translations

- Load locales from filesystem at /usr/share/locales
- Auto-detect browser language and configure locale
- Add Spanish translations for all namespaces
- Add dd coreutil command
- Fix shell command not found errors
- Update dependencies (turbo 2.7.5)
