---
"@ecmaos-apps/edit": patch
"@ecmaos/kernel": patch
"@ecmaos/types": patch
"@ecmaos/coreutils": patch
---

Features

- Add head and tail commands for viewing file contents
- Add grep command for text search
- Enhance terminal input handling and improve command mode interactions in editor
- Add stdin support for hex command

Fixes

- Improve error handling and usage messages for hex command
- Fix filesystem entry descriptions in ls command

Refactoring

- Simplify first read logic in hex command
- Cleanup unused imports
