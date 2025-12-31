---
"@ecmaos-apps/edit": patch
"@ecmaos/kernel": patch
"@ecmaos/types": patch
"@ecmaos/coreutils": patch
---

OVERVIEW

Total Commits: 5
Files Changed: 56 files
Additions: +1,632 lines
Deletions: -539 lines
Net Change: +1,093 lines

---

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

---

2. b4454a1 - chore: Bump turbo package version from 2.5.4 to 2.7.2

Type: Dependency Update

Changes:

- Updated Turbo monorepo tool from version 2.5.4 to 2.7.2
- Updated package.json and pnpm-lock.yaml files

Impact: Infrastructure improvement for better monorepo tooling support

---

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

---

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

---

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

---

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

---

AFFECTED PACKAGES

Core Packages:

- @ecmaos/kernel - Shell, terminal, filesystem enhancements
- @ecmaos/types - Shell type updates
- @ecmaos/utils - New ln command, enhanced ls command

Applications:

- apps/edit - New standalone editor package

Dependencies:

- All packages: Lockfile updates for consistency

---

BREAKING CHANGES

None identified. All changes appear to be additive or internal refactoring.

---

MIGRATION NOTES

- The edit command has been moved from the kernel to apps/edit package. Any code referencing the edit command in the kernel should be updated to use the new package.
- The ls command now shows additional link information, which may affect scripts parsing its output.
- Shell commands now support tilde expansion (~), which may affect scripts that previously handled paths differently.
