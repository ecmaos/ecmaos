---
"@ecmaos/kernel": minor
"@ecmaos/types": minor
"@ecmaos/coreutils": minor
---

Major Features:

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
