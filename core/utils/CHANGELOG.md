# @ecmaos/coreutils

## 0.5.2

### Patch Changes

- 472a7f1: feat: i18n filesystem loading, browser detection, and Spanish translations

  - Load locales from filesystem at /usr/share/locales
  - Auto-detect browser language and configure locale
  - Add Spanish translations for all namespaces
  - Add dd coreutil command
  - Fix shell command not found errors
  - Update dependencies (turbo 2.7.5)

- Updated dependencies [472a7f1]
  - @ecmaos/types@0.7.3

## 0.5.1

### Patch Changes

- 9a406cf: support coreutil descriptions

## 0.5.0

### Minor Changes

- ad7dc2e: add initfs.demo; fix bell flash; rename hex to xxd

### Patch Changes

- Updated dependencies [ad7dc2e]
  - @ecmaos/types@0.7.2

## 0.4.3

### Patch Changes

- Updated dependencies [f332a2f]
  - @ecmaos/types@0.7.1

## 0.4.2

### Patch Changes

- 53068e0: Many new coreutils added

## 0.4.0

### Minor Changes

- c6d3ea8: Filesystem & Mount System

  - Added fstab file processing and parsing utilities
  - Implemented mount and umount commands with full filesystem support
  - Changed environment variable prefix handling
  - Enhanced filesystem configuration and mount management

  Environment Management

  - Added support for global /etc/env file
  - Fixed env command argument handling
  - New env command implementation in core/utils

  Documentation & SEO

  - Enhanced HTML metadata and SEO improvements
  - Added AI and passkey tutorials
  - Updated README with expanded documentation
  - Added lighthouse performance report
  - Updated project description

  Bug Fixes & Enhancements

  - Enhanced cron command with improved parsing and functionality
  - Fixed readline bug in terminal
  - Fixed less command first-line offset display issue

  Miscellaneous

  - Removed offers metadata from HTML
  - Sorted package.json scripts
  - Synced documentation across codebase

### Patch Changes

- Updated dependencies [c6d3ea8]
  - @ecmaos/types@0.7.0

## 0.3.1

### Patch Changes

- d43d304: New Features:

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

- Updated dependencies [d43d304]
  - @ecmaos/types@0.6.1

## 0.3.0

### Minor Changes

- 0da04b1: fix: refactor shell glob expansion; many new coreutils; dev scripts

### Patch Changes

- Updated dependencies [0da04b1]
  - @ecmaos/types@0.6.0

## 0.2.1

### Patch Changes

- e66e9f9: - Enhanced version retrieval for workspace dependencies
  - Removed coreutils version retrieval and updated dependency links
  - Enhanced 'ls' command output formatting
  - Fixed terminal input handling for cursor positioning
  - Implemented PID files in /run directory for process tracking
  - Added holiday emoji display functionality
  - Rebuilt documentation
- Updated dependencies [e66e9f9]
  - @ecmaos/types@0.5.1

## 0.2.0

### Minor Changes

- 7f9af36: Major Features:

  - Added 22 new coreutils commands: basename, cal, comm, cut, date, diff, dirname, false, find, id, join, nl, paste, seq, sort, split, test, tr, true, uniq, wc, which, whoami
  - Integrated OpenTelemetry telemetry service (kernel.telemetry) for observability
  - Added socket management service and utilities with WebSocket and WebTransport support
  - Refactored TerminalCommand and coreutils structure for better organization

  Improvements:

  - Exposed coreutils version in environment variables
  - Updated dependency links across packages
  - Rebuilt documentation
  - Fixed coreutils linting errors
  - Updated lockfiles across all packages

  Technical Details:

  - Added new types for sockets and telemetry
  - Enhanced terminal command infrastructure
  - Improved command implementations across existing coreutils
  - Added utility servers for OpenTelemetry and WebTransport testing

### Patch Changes

- Updated dependencies [7f9af36]
  - @ecmaos/types@0.5.0

## 0.1.5

### Patch Changes

- 3a329b1: Features

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

- Updated dependencies [3a329b1]
  - @ecmaos/types@0.4.4

## 0.1.4

### Patch Changes

- 97b4dbf: implement passkey management and login
- Updated dependencies [97b4dbf]
  - @ecmaos/types@0.4.3

## 0.1.3

### Patch Changes

- ebc97d6: feat: Add hex, less, sed, and tee commands to coreutils

  - Add hex viewer command for binary file inspection
  - Add less command for file paging with navigation
  - Add sed command for stream editing operations
  - Add tee command for splitting output streams
  - Fix AI app stream handling for better reliability
  - Refactor AI app session storage to use cache directory instead of config directory
  - Update turbo config to include environment variables

## 0.1.2

### Patch Changes

- ae8f619: OVERVIEW

  Total Commits: 5
  Files Changed: 56 files
  Additions: +1,632 lines
  Deletions: -539 lines
  Net Change: +1,093 lines

  ***

  COMMIT DETAILS

  1. c6f2d9c - docs: Update NEWS and README files; add tilde expansion feature in shell commands

  Type: Documentation & Enhancement
  Date: Wed Dec 31 11:52:52 2025

  Changes:

  - Updated NEWS.md and README.md with new features and improvements
  - Added tilde expansion feature in shell commands (~ expands to home directory)
  - Enhanced filesystem type recognition
  - Improved terminal command handling
  - Removed 292 lines from core/kernel/src/tree/lib/commands/index.ts (edit command moved to separate package)
  - Added shell functionality in core/kernel/src/tree/shell.ts (71 new lines)
  - Enhanced terminal and filesystem modules

  Files Modified: 9 files (+166, -327)

  ***

  2. b4454a1 - chore: Bump turbo package version from 2.5.4 to 2.7.2

  Type: Dependency Update

  Changes:

  - Updated Turbo monorepo tool from version 2.5.4 to 2.7.2
  - Updated package.json and pnpm-lock.yaml files

  Impact: Infrastructure improvement for better monorepo tooling support

  ***

  3. 6660f4c - chore: Update pnpm-lock.yaml files across multiple applications and modules

  Type: Dependency Maintenance

  Changes:

  - Cleaned up outdated checksum entries in pnpm-lock.yaml files
  - Ensured consistency in package versions across the monorepo
  - Updated lockfiles in:
    - Multiple apps (ai, boilerplate, code, news, python, webamp)
    - Core packages (bios, jaffa, kernel, metal, swapi, types, utils)
    - Device packages (audio, battery, bluetooth, echo, gamepad, geo, gpu, hid, midi, presentation, sensors, serial, usb, webgl)
    - Modules and utils

  Impact: Improved dependency consistency and resolved potential checksum issues

  ***

  4. 01da80e - feat: improve and move edit command to its own package

  Type: Feature (Major Refactor)
  Date: Wed Dec 31 12:48:45 2025

  Changes:

  - Extracted edit command from kernel into standalone apps/edit package
  - Created comprehensive editor implementation with:
    - Multiple editing modes: normal, insert, replace, command
    - File operations support
    - Renderer for terminal-based editing
    - Type definitions for editor state
  - Removed 292 lines of edit command code from core/kernel/src/tree/lib/commands/index.ts
  - Added build configuration (build.cjs)
  - Updated package dependencies

  Files Modified: 14 files (+1,054, -304)

  Impact: Better separation of concerns, improved maintainability, and enhanced editor functionality

  ***

  5. 90072ec - feat: add 'ln' command and enhance 'ls' command to support symbolic and hard link information

  Type: Feature
  Date: Wed Dec 31 13:11:53 2025

  Changes:

  - Added new ln command for creating symbolic and hard links (core/utils/src/commands/ln.ts - 108 lines)
  - Enhanced ls command to display link information:
    - Shows link count for files
    - Displays target path for symbolic links
    - Improved file listing with link details
  - Updated command exports in core/utils/src/index.ts

  Files Modified: 3 files (+196, -11)

  Impact: Better filesystem management capabilities, improved visibility into file relationships

  ***

  SUMMARY BY CATEGORY

  Features:

  - Edit Command Package: Extracted and improved editor into standalone package with multiple modes
  - Link Command: New ln command for creating symbolic and hard links
  - Enhanced LS: Improved ls command with link information display
  - Tilde Expansion: Shell command support for ~ home directory expansion

  Documentation:

  - Updated NEWS and README files with latest changes

  Infrastructure:

  - Turbo version bump (2.5.4 -> 2.7.2)
  - Dependency lockfile cleanup across entire monorepo

  Code Quality:

  - Better separation of concerns (edit command extraction)
  - Improved filesystem type recognition
  - Enhanced terminal command handling

  ***

  AFFECTED PACKAGES

  Core Packages:

  - @ecmaos/kernel - Shell, terminal, filesystem enhancements
  - @ecmaos/types - Shell type updates
  - @ecmaos/utils - New ln command, enhanced ls command

  Applications:

  - apps/edit - New standalone editor package

  Dependencies:

  - All packages: Lockfile updates for consistency

  ***

  BREAKING CHANGES

  None identified. All changes appear to be additive or internal refactoring.

  ***

  MIGRATION NOTES

  - The edit command has been moved from the kernel to apps/edit package. Any code referencing the edit command in the kernel should be updated to use the new package.
  - The ls command now shows additional link information, which may affect scripts parsing its output.
  - Shell commands now support tilde expansion (~), which may affect scripts that previously handled paths differently.

- Updated dependencies [ae8f619]
  - @ecmaos/types@0.4.2

## 0.1.1

### Patch Changes

- f2fa236: Update README for clarity on local package installation and enhance kernel command descriptions. Refactor command handling to integrate coreutils commands, streamline terminal command definitions, and improve prompt formatting. Add command substitution support in shell. Update user environment variables during login. Adjust package dependencies in various apps.
- Updated dependencies [f2fa236]
  - @ecmaos/types@0.4.1
