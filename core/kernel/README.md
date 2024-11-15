# The Web Kernel

[ecmaOS](https://github.com/ecmaos) is a browser-based operating system kernel and suite of applications written in TypeScript. It's the successor of [web3os](https://github.com/web3os-org/kernel).

The goal is to create a kernel and supporting apps that tie together modern web technologies and utilities to form an "operating system" that can run on modern browsers, not just to create a "desktop experience". Its main use case is to provide a consistent environment for running web apps, but it has features that allow for more powerful custom scenarios. The kernel could also be used as a platform for custom applications, games, and more.

[![API Reference](https://img.shields.io/badge/API-Reference-success)](https://docs.ecmaos.sh)
[![Version](https://img.shields.io/github/package-json/v/ecmaos/ecmaos?color=success)](https://ecmaos.sh)
[![Site Status](https://img.shields.io/website?url=https%3A%2F%2Fecmaos.sh)](https://ecmaos.sh)
[![Last Commit](https://img.shields.io/github/last-commit/ecmaos/ecmaos.svg)](https://github.com/ecmaos/ecmaos/commit/master)
[![Open issues](https://img.shields.io/github/issues/ecmaos/ecmaos.svg)](https://github.com/ecmaos/ecmaos/issues)
[![Closed issues](https://img.shields.io/github/issues-closed/ecmaos/ecmaos.svg)](https://github.com/ecmaos/ecmaos/issues?q=is%3Aissue+is%3Aclosed)

[![Sponsors](https://img.shields.io/github/sponsors/mathiscode?color=red)](https://github.com/sponsors/mathiscode)
[![Contributors](https://img.shields.io/github/contributors/ecmaos/ecmaos?color=yellow)](https://github.com/ecmaos/ecmaos/graphs/contributors)
[![GitHub license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/ecmaos/ecmaos/blob/master/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-blue.svg)](https://github.com/ecmaos/ecmaos/compare)

## Features

- TypeScript, WebAssembly
- Filesystem supporting multiple backends powered by [@zenfs/core](https://github.com/zen-fs/core)
- Terminal interface powered by [xterm.js](https://xtermjs.org)
- Pseudo-streams, allowing redirection and piping
- Device framework with a common interface for working with hardware: WebBluetooth, WebSerial, WebHID, WebUSB, etc.
- Some devices have a builtin CLI, so you can run them like normal commands: `# /dev/bluetooth`
- Install any client-side npm package (this doesn't mean it will work out of the box as expected)
- Event manager for dispatching and subscribing to events
- Process manager for running applications and daemons
- Interval manager for scheduling recurring operations
- Memory manager for managing pseudo-memory: Collections, Config, Heap, and Stack
- Storage manager for managing Storage API capabilities: IndexedDB, localStorage, etc.
- Internationalization framework for translating text powered by [i18next](https://www.i18next.com)
- Window manager powered by [WinBox](https://github.com/nextapps-de/winbox)
- `SWAPI`: An API server running completely inside a service worker using [Hono](https://hono.dev)
- `Metal`: An API server for allowing connections to physical systems from ecmaOS using [Hono](https://hono.dev)

## Basic Overview

- `Kernel`
  - Authentication (WebAuthn)
  - Components (Web Components/Custom Elements)
  - Devices
  - DOM
  - Events (CustomEvents)
  - Filesystem (ZenFS)
  - Internationalization (i18next)
  - Interval Manager (setInterval)
  - Log Manager (tslog)
  - Memory Manager (Abstractions)
  - Process Manager
  - Protocol Handlers (ecmaos+web://...)
  - Service Worker Manager
  - Shell
  - Storage (IndexedDB, localStorage, sessionStorage, etc.)
  - Terminal (xterm.js)
  - User Manager
  - Window Manager (WinBox)
  - Workers (Web Workers)

- `Apps`
  - These are full applications that are developed alongside ecmaOS
- `Core`
  - Core modules provide the system's essential functionality; this includes the kernel itself
- `Commands`
  - Commands are small utilities that aren't quite full Apps
- `Devices`
  - Devices get loaded on boot, e.g. /dev/bluetooth, /dev/random, /dev/battery, etc.
  - A device can support being "run" by a user, e.g. `# /dev/battery status`
  - Devices may also be directly read/written, and will behave accordingly
  - An individual device module can provide multiple device drivers, e.g. `/dev/usb` provides `/dev/usb-mydevice-0001-0002`

## Command Examples

```sh
ai "Despite all my rage" # use env OPENAI_API_KEY --set sk-
cat /var/log/kernel.log
cd /tmp
echo "Hello, world!" > hello.txt
chmod 700 hello.txt
chown user hello.txt
clear
cp /tmp/hello.txt /tmp/hi.txt
download hello.txt
edit hello.txt
env hello --set world ; env
fetch https://ipecho.net/plain > /tmp/myip.txt
install jquery
ls /dev
mkdir /tmp/zip ; cd /tmp/zip
upload
mount myuploadedzip.zip /mnt/zip -t zip
cd .. ; pwd
unzip zip/myuploaded.zip
mv zip/myuploaded.zip /tmp/backup.zip
passwd old new
play /root/test.mp3
ps
rm /tmp/backup.zip
screensaver
snake
stat /tmp/hello.txt
touch /tmp/test.bin
umount /mnt/zip
user add --username user
su user
video /root/video.mp4
zip /root/tmp.zip /tmp
```

## Device Examples

```sh
/dev/audio test
/dev/battery status
/dev/bluetooth scan
echo "This will error" > /dev/full
/dev/gamepad list
/dev/geo position
/dev/gpu test
/dev/hid list
/dev/midi list
echo "Goodbye" > /dev/null
/dev/presentation start https://wikipedia.org
cat /dev/random --bytes 10
/dev/sensors list
/dev/serial devices
/dev/usb list
/dev/webgpu test
cat /dev/zero --bytes 10 > /dev/null
```

Note: many device implementations are incomplete, but provide a solid starting point

## Early Days

The kernel is currently in active development. It is not considered stable and the structure and API are very likely to change in unexpected and possibly unannounced ways until version 1.0.0. Use cautiously and at your own risk.

Things to keep in mind:

- The kernel is designed to be run in an environment with a DOM (i.e. a browser)
- Many features are only available on Chromium-based browsers, and many more behind feature flags
- Command interfaces won't match what you might be used to from a traditional Linux environment; not all commands and options are supported. Over time, Linuxish commands will be fleshed out and made to behave in a more familiar way.
- Globbing doesn't work in the terminal yet

## Development

[Turborepo](https://turbo.build/repo) is used to manage the monorepo, and [bun](https://bun.sh) is used for package management.

A good place to start is viewing the `scripts` property of [package.json](./package.json) in the root of the repository.

```bash
# Clone
git clone https://github.com/ecmaos/ecmaos.git

# Install dependencies
cd ecmaos && bun install

# We're going to focus on the kernel for now
cd core/kernel

# Run the dev server
bun run dev

# Run the docs server
bun run dev:docs

# Build
bun run build

# Run tests
bun run test
bun run test:watch
bun run test:coverage
bun run test:bench
bun run test:ui

# Generate modules
turbo gen device # generate a new device template
```

Also see [turbo.json](./turbo.json) and [CONTRIBUTING.md](./CONTRIBUTING.md) for more information.
