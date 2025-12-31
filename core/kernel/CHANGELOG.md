# @ecmaos/kernel

## 0.6.5

### Patch Changes

- 97b4dbf: implement passkey management and login
- Updated dependencies [97b4dbf]
  - @ecmaos/coreutils@0.1.4
  - @ecmaos-devices/audio@0.1.0
  - @ecmaos-devices/battery@0.1.0
  - @ecmaos-devices/bluetooth@0.1.0
  - @ecmaos-devices/gamepad@0.1.0
  - @ecmaos-devices/geo@0.1.0
  - @ecmaos-devices/gpu@0.1.0
  - @ecmaos-devices/hid@0.1.0
  - @ecmaos-devices/midi@0.1.0
  - @ecmaos-devices/presentation@0.1.0
  - @ecmaos-devices/sensors@0.1.0
  - @ecmaos-devices/serial@0.1.0
  - @ecmaos-devices/usb@0.1.0
  - @ecmaos-devices/webgl@0.1.0

## 0.6.4

### Patch Changes

- Updated dependencies [ebc97d6]
  - @ecmaos/coreutils@0.1.3

## 0.6.3

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
  - @ecmaos/coreutils@0.1.2
  - @ecmaos-devices/audio@0.1.0
  - @ecmaos-devices/battery@0.1.0
  - @ecmaos-devices/bluetooth@0.1.0
  - @ecmaos-devices/gamepad@0.1.0
  - @ecmaos-devices/geo@0.1.0
  - @ecmaos-devices/gpu@0.1.0
  - @ecmaos-devices/hid@0.1.0
  - @ecmaos-devices/midi@0.1.0
  - @ecmaos-devices/presentation@0.1.0
  - @ecmaos-devices/sensors@0.1.0
  - @ecmaos-devices/serial@0.1.0
  - @ecmaos-devices/usb@0.1.0
  - @ecmaos-devices/webgl@0.1.0

## 0.6.2

### Patch Changes

- c2ceff4: Enhance filesystem operations with a new ensureDirectory function to handle directory creation and conflict resolution. Add uninstall command to package management with appropriate options. Update terminal output to display protocol with color coding and icons for better user experience. Improve documentation regarding environment variable settings.

## 0.6.1

### Patch Changes

- 8c19676: fix vite config and coreutils

## 0.6.0

### Minor Changes

- f2fa236: Update README for clarity on local package installation and enhance kernel command descriptions. Refactor command handling to integrate coreutils commands, streamline terminal command definitions, and improve prompt formatting. Add command substitution support in shell. Update user environment variables during login. Adjust package dependencies in various apps.

### Patch Changes

- Updated dependencies [f2fa236]
  - @ecmaos/coreutils@0.1.1
  - @ecmaos-devices/audio@0.1.0
  - @ecmaos-devices/battery@0.1.0
  - @ecmaos-devices/bluetooth@0.1.0
  - @ecmaos-devices/gamepad@0.1.0
  - @ecmaos-devices/geo@0.1.0
  - @ecmaos-devices/gpu@0.1.0
  - @ecmaos-devices/hid@0.1.0
  - @ecmaos-devices/midi@0.1.0
  - @ecmaos-devices/presentation@0.1.0
  - @ecmaos-devices/sensors@0.1.0
  - @ecmaos-devices/serial@0.1.0
  - @ecmaos-devices/usb@0.1.0
  - @ecmaos-devices/webgl@0.1.0

## 0.5.1

### Patch Changes

- 47f6a2e: fix app dependencies; cleanup

## 0.5.0

### Minor Changes

- d104ad6: fix redirection; improve processes; ai and code app updates; process table; fd table; misc updates

### Patch Changes

- @ecmaos-devices/audio@0.1.0
- @ecmaos-devices/battery@0.1.0
- @ecmaos-devices/bluetooth@0.1.0
- @ecmaos-devices/gamepad@0.1.0
- @ecmaos-devices/geo@0.1.0
- @ecmaos-devices/gpu@0.1.0
- @ecmaos-devices/hid@0.1.0
- @ecmaos-devices/midi@0.1.0
- @ecmaos-devices/presentation@0.1.0
- @ecmaos-devices/sensors@0.1.0
- @ecmaos-devices/serial@0.1.0
- @ecmaos-devices/usb@0.1.0
- @ecmaos-devices/webgl@0.1.0

## 0.4.0

### Minor Changes

- ae313df: updated zenfs; proper shell contexts; device updates; fixes

### Patch Changes

- Updated dependencies [ae313df]
  - @ecmaos-devices/presentation@0.1.0
  - @ecmaos-devices/bluetooth@0.1.0
  - @ecmaos-devices/battery@0.1.0
  - @ecmaos-devices/gamepad@0.1.0
  - @ecmaos-devices/sensors@0.1.0
  - @ecmaos-devices/serial@0.1.0
  - @ecmaos-devices/audio@0.1.0
  - @ecmaos-devices/webgl@0.1.0
  - @ecmaos-devices/midi@0.1.0
  - @ecmaos-devices/geo@0.1.0
  - @ecmaos-devices/gpu@0.1.0
  - @ecmaos-devices/hid@0.1.0
  - @ecmaos-devices/usb@0.1.0
  - @ecmaos/bios@0.2.0

## 0.2.8

### Patch Changes

- 9acd5b4: Basic experimental Node emulation
  - @ecmaos-devices/audio@0.0.2
  - @ecmaos-devices/battery@0.0.2
  - @ecmaos-devices/bluetooth@0.0.2
  - @ecmaos-devices/gamepad@0.0.2
  - @ecmaos-devices/geo@0.0.2
  - @ecmaos-devices/gpu@0.0.2
  - @ecmaos-devices/hid@0.0.2
  - @ecmaos-devices/midi@0.0.2
  - @ecmaos-devices/presentation@0.0.2
  - @ecmaos-devices/sensors@0.0.2
  - @ecmaos-devices/serial@0.0.2
  - @ecmaos-devices/usb@0.0.2
  - @ecmaos-devices/webgl@0.0.2

## 0.2.7

### Patch Changes

- 38dec37: Update README; kernel.log is now mandatory; changes to script format
  - @ecmaos-devices/audio@0.0.2
  - @ecmaos-devices/battery@0.0.2
  - @ecmaos-devices/bluetooth@0.0.2
  - @ecmaos-devices/gamepad@0.0.2
  - @ecmaos-devices/geo@0.0.2
  - @ecmaos-devices/gpu@0.0.2
  - @ecmaos-devices/hid@0.0.2
  - @ecmaos-devices/midi@0.0.2
  - @ecmaos-devices/presentation@0.0.2
  - @ecmaos-devices/sensors@0.0.2
  - @ecmaos-devices/serial@0.0.2
  - @ecmaos-devices/usb@0.0.2
  - @ecmaos-devices/webgl@0.0.2

## 0.2.6

### Patch Changes

- b7bd827: various updates to package installation and loading

## 0.2.5

### Patch Changes

- 628a467: update README

## 0.2.4

### Patch Changes

- f5e173c: add code editor app; misc improvements
  - @ecmaos/device-audio@0.0.2
  - @ecmaos/device-battery@0.0.2
  - @ecmaos/device-bluetooth@0.0.2
  - @ecmaos/device-gamepad@0.0.2
  - @ecmaos/device-geo@0.0.2
  - @ecmaos/device-gpu@0.0.2
  - @ecmaos/device-hid@0.0.2
  - @ecmaos/device-midi@0.0.2
  - @ecmaos/device-presentation@0.0.2
  - @ecmaos/device-sensors@0.0.2
  - @ecmaos/device-serial@0.0.2
  - @ecmaos/device-usb@0.0.2
  - @ecmaos/device-webgl@0.0.2

## 0.2.3

### Patch Changes

- 99a1452: various updates to SWAPI, module loading, user credentials, and package management
  - @ecmaos/device-audio@0.0.2
  - @ecmaos/device-battery@0.0.2
  - @ecmaos/device-bluetooth@0.0.2
  - @ecmaos/device-gamepad@0.0.2
  - @ecmaos/device-geo@0.0.2
  - @ecmaos/device-gpu@0.0.2
  - @ecmaos/device-hid@0.0.2
  - @ecmaos/device-midi@0.0.2
  - @ecmaos/device-presentation@0.0.2
  - @ecmaos/device-sensors@0.0.2
  - @ecmaos/device-serial@0.0.2
  - @ecmaos/device-usb@0.0.2
  - @ecmaos/device-webgl@0.0.2

## 0.2.2

### Patch Changes

- 0cf6dda: fix typings; rebuild docs
  - @ecmaos/device-audio@0.0.2
  - @ecmaos/device-battery@0.0.2
  - @ecmaos/device-bluetooth@0.0.2
  - @ecmaos/device-gamepad@0.0.2
  - @ecmaos/device-geo@0.0.2
  - @ecmaos/device-gpu@0.0.2
  - @ecmaos/device-hid@0.0.2
  - @ecmaos/device-midi@0.0.2
  - @ecmaos/device-presentation@0.0.2
  - @ecmaos/device-sensors@0.0.2
  - @ecmaos/device-serial@0.0.2
  - @ecmaos/device-usb@0.0.2
  - @ecmaos/device-webgl@0.0.2

## 0.2.1

### Patch Changes

- ac98305: override figlet fonts for now

## 0.2.0

### Minor Changes

- f4395ec: many updates to various systems including app/package installation; tab completion improvements; switch to IndexedDB as root

### Patch Changes

- @ecmaos/device-audio@0.0.2
- @ecmaos/device-battery@0.0.2
- @ecmaos/device-bluetooth@0.0.2
- @ecmaos/device-gamepad@0.0.2
- @ecmaos/device-geo@0.0.2
- @ecmaos/device-gpu@0.0.2
- @ecmaos/device-hid@0.0.2
- @ecmaos/device-midi@0.0.2
- @ecmaos/device-presentation@0.0.2
- @ecmaos/device-sensors@0.0.2
- @ecmaos/device-serial@0.0.2
- @ecmaos/device-usb@0.0.2
- @ecmaos/device-webgl@0.0.2

## 0.1.3

### Patch Changes

- 36111f6: prepare publishing kernel module support
  - @ecmaos/device-audio@0.0.2
  - @ecmaos/device-battery@0.0.2
  - @ecmaos/device-bluetooth@0.0.2
  - @ecmaos/device-gamepad@0.0.2
  - @ecmaos/device-geo@0.0.2
  - @ecmaos/device-gpu@0.0.2
  - @ecmaos/device-hid@0.0.2
  - @ecmaos/device-midi@0.0.2
  - @ecmaos/device-presentation@0.0.2
  - @ecmaos/device-sensors@0.0.2
  - @ecmaos/device-serial@0.0.2
  - @ecmaos/device-usb@0.0.2
  - @ecmaos/device-webgl@0.0.2

## 0.1.2

### Patch Changes

- 3261835: small fixes; cleanup
- 9348f4b: WASM module loading
  - @ecmaos/device-audio@0.0.2
  - @ecmaos/device-battery@0.0.2
  - @ecmaos/device-bluetooth@0.0.2
  - @ecmaos/device-gamepad@0.0.2
  - @ecmaos/device-geo@0.0.2
  - @ecmaos/device-gpu@0.0.2
  - @ecmaos/device-hid@0.0.2
  - @ecmaos/device-midi@0.0.2
  - @ecmaos/device-presentation@0.0.2
  - @ecmaos/device-sensors@0.0.2
  - @ecmaos/device-serial@0.0.2
  - @ecmaos/device-usb@0.0.2
  - @ecmaos/device-webgl@0.0.2

## 0.1.1

### Patch Changes

- 3a2a173: many updates; bumping versions for new publications
- Updated dependencies [3a2a173]
  - @ecmaos/bios@0.1.1
  - @ecmaos/device-audio@0.0.2
  - @ecmaos/device-battery@0.0.2
  - @ecmaos/device-bluetooth@0.0.2
  - @ecmaos/device-gamepad@0.0.2
  - @ecmaos/device-geo@0.0.2
  - @ecmaos/device-gpu@0.0.2
  - @ecmaos/device-hid@0.0.2
  - @ecmaos/device-midi@0.0.2
  - @ecmaos/device-presentation@0.0.2
  - @ecmaos/device-sensors@0.0.2
  - @ecmaos/device-serial@0.0.2
  - @ecmaos/device-usb@0.0.2
  - @ecmaos/device-webgl@0.0.2
