---
"@ecmaos/kernel": patch
"@ecmaos/types": patch
"@ecmaos/coreutils": patch
---

New Features:

- Cron/crontab system: Added scheduling system with crontab parsing and execution
- Web browser coreutil: New 'web' command for browsing functionality
- View coreutil: New 'view' command for multimedia viewing
- Coreutils migration: Migrated 'play' and 'video' commands from kernel to coreutils

Fixes:

- Shell command substitution parsing improvements
- Tar parsing improvements
- Web coreutil now loads credentialless

Maintenance:

- Updated documentation and types across various kernel components
- Enhanced coreutils and shell scripts
- Added 'open' and 'man' commands to coreutils
