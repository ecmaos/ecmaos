---
"@ecmaos-apps/ai": patch
"@ecmaos/coreutils": patch
---

feat: Add hex, less, sed, and tee commands to coreutils

- Add hex viewer command for binary file inspection
- Add less command for file paging with navigation
- Add sed command for stream editing operations
- Add tee command for splitting output streams
- Fix AI app stream handling for better reliability
- Refactor AI app session storage to use cache directory instead of config directory
- Update turbo config to include environment variables
