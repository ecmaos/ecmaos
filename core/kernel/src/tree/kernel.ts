/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * The Kernel class is the core of the ecmaOS system.
 * It manages the system's resources and provides a framework for system services.
 *
 */

import ansi from 'ansi-escape-sequences'
import chalk from 'chalk'
import figlet from 'figlet'
import Module from 'node:module'
import path from 'node:path'
import semver from 'semver'

import { addDevice, bindContext, Credentials, DeviceDriver } from '@zenfs/core'
// import { Emscripten } from '@zenfs/emscripten'
import { JSONSchemaForNPMPackageJsonFiles } from '@schemastore/package'
import { WebContainer } from '@webcontainer/api'
import { context, trace } from '@opentelemetry/api'

import './../themes/default.scss'

import { Auth } from '#auth.ts'
import { Components } from '#components.ts'
import { DefaultDevices } from '#device.ts'
import { DefaultDomOptions, Dom } from '#dom.ts'
import { DefaultFilesystemOptions, Filesystem } from '#filesystem.ts'
import { DefaultLogOptions, Log } from '#log.ts'
import { Terminal } from '#terminal.ts'
import { Events } from '#events.ts'
import { I18n } from '#i18n.ts'
import { Intervals } from '#intervals.ts'
import { Memory } from '#memory.ts'
import { Process, ProcessManager } from '#processes.ts'
import { Protocol } from '#protocol.ts'
import { DefaultServiceOptions, Service } from '#service.ts'
import { Sockets } from '#sockets.ts'
import { Shell } from '#shell.ts'
import { Storage } from '#storage.ts'
import { FitAddon } from '@xterm/addon-fit'
import { Telemetry } from '#telemetry.ts'
import { Users } from '#users.ts'
import { Wasm } from '#wasm.ts'
import { Windows } from '#windows.ts'
import { Workers } from '#workers.ts'

// import createBIOS, { BIOSModule } from '@ecmaos/bios'
import { TerminalCommands } from '#lib/commands/index.js'
import { parseCrontabFile } from '#lib/crontab.ts'
import { parseFstabFile } from '#lib/fstab.ts'

import {
  KernelEvents,
  KernelState,
  TerminalEvents
} from '@ecmaos/types'

import type {
  BootOptions,
  Kernel as IKernel,
  KernelDevice,
  KernelExecuteEvent,
  KernelExecuteOptions,
  KernelOptions,
  KernelPanicEvent,
  Shell as IShell,
  Terminal as ITerminal,
  User,
  Wasm as IWasm,
  Windows as IWindows,
  Workers as IWorkers,
  EventCallback,
  ProcessEntryParams,
  FileHeader,
  KernelShutdownEvent,
  KernelModule,
  KernelModules,
  Timer
} from '@ecmaos/types'

const DefaultKernelOptions: KernelOptions = {
  devices: DefaultDevices,
  dom: DefaultDomOptions,
  log: DefaultLogOptions,
  filesystem: DefaultFilesystemOptions,
  service: DefaultServiceOptions
}

const DefaultBootOptions: BootOptions = { silent: false }
const DefaultFigletFonts = [
  '3-D',
  '3x5',
  '3D-ASCII',
  '5 Line Oblique',
  'Acrobatic',
  'Big',
  'Big Money-ne',
  'Broadway',
  'Bubble',
  'Caligraphy',
  'Caligraphy2',
  'Coinstak',
  'Computer',
  'Cosmike',
  'Cyberlarge',
  'Diamond',
  'Doom',
  'Keyboard',
  'Larry 3D',
  'OS2',
  'Poison',
  'Rounded',
  'Runyc',
  'S Blood'
]

/**
 * @experimental
 * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
 *
 * The Kernel class is the core of the ecmaOS system.
 * It manages the system's resources and provides a framework for system services.
 *
 * @returns {Kernel} The unbooted kernel instance.
 *
 * @example
 * ```javascript
 * const kernel = new Kernel()
 * await kernel.boot()
 * ```
 */
export class Kernel implements IKernel {
  /** Unique identifier for this kernel instance */
  public readonly id: string = crypto.randomUUID()
  /** Name of the kernel */
  public readonly name: string = import.meta.env['NAME'] || 'ecmaOS'
  /** Version string of the kernel */
  public readonly version: string = import.meta.env['VERSION'] || '?.?.?'

  /** Authentication and authorization service */
  public readonly auth: Auth
  /** BIOS module providing low-level functionality */
  // public bios?: BIOSModule
  /** Broadcast channel for inter-kernel communication */
  public readonly channel: BroadcastChannel
  /** Web Components manager */
  public readonly components: Components
  /** WebContainer instance */
  public container?: WebContainer
  /** DOM manipulation service */
  public readonly dom: Dom
  /** Map of registered devices and their drivers */
  public readonly devices: Map<string, { device: KernelDevice, drivers?: DeviceDriver[] }> = new Map()
  /** Event management system */
  public readonly events: Events
  /** Virtual filesystem */
  public readonly filesystem: Filesystem
  /** Internationalization service */
  public readonly i18n: I18n
  /** Interval management service */
  public readonly intervals: Intervals
  /** Keyboard interface */
  public readonly keyboard: Keyboard
  /** Logging system */
  public readonly log: Log
  /** Memory management service */
  public readonly memory: Memory
  /** Map of loaded modules */
  public readonly modules: KernelModules = new Map()
  /** Configuration options passed to the kernel */
  public readonly options: KernelOptions
  /** Map of loaded packages */
  public readonly packages: Map<string, Module> = new Map()
  /** Process management service */
  public readonly processes: ProcessManager
  /** Protocol handler service */
  public readonly protocol: Protocol
  /** Socket connection management service */
  public readonly sockets: Sockets
  /** Map of available screensavers */
  public readonly screensavers: Map<string, { default: (options: { terminal: ITerminal }) => Promise<void>, exit: () => Promise<void> }>
  /** Service management system */
  public readonly service: Service
  /** Shell for command interpretation and execution */
  public readonly shell: Shell
  /** Storage provider interface */
  public readonly storage: Storage
  /** Telemetry service for OpenTelemetry tracing */
  public readonly telemetry: Telemetry
  /** Terminal interface for user interaction */
  public readonly terminal: ITerminal
  /** User management service */
  public readonly users: Users
  /** WebAssembly service */
  public readonly wasm: IWasm
  /** Window management service */
  public readonly windows: IWindows
  /** Web Worker management service */
  public readonly workers: IWorkers

  /** Current state of the kernel */
  private _state: KernelState = KernelState.BOOTING
  get state() { return this._state }

  /** Map of all shells by TTY number */
  private _shells: Map<number, Shell> = new Map()
  /** Currently active TTY number */
  private _activeTty: number = 0
  get activeTty() { return this._activeTty }
  get shells() { return this._shells }

  /** Add an event listener; alias for `events.on` */
  get addEventListener() { return this.events.on }
  /** Remove an event listener; alias for `events.off` */
  get removeEventListener() { return this.events.off }

  constructor(_options: KernelOptions = DefaultKernelOptions) {
    this.options = { ...DefaultKernelOptions, ..._options }

    this.auth = new Auth()
    this.channel = new BroadcastChannel(import.meta.env['NAME'] || 'ecmaos')
    this.components = new Components()
    this.dom = new Dom(this.options.dom)
    this.devices = new Map<string, { device: KernelDevice, drivers?: DeviceDriver[] }>()
    this.events = new Events()
    this.filesystem = new Filesystem(this)
    this.i18n = new I18n(this.options.i18n)
    this.intervals = new Intervals()
    this.keyboard = navigator.keyboard
    this.log = this.options.log ? new Log(this.options.log) : new Log()
    this.memory = new Memory()
    this.modules = new Map()
    this.processes = new ProcessManager()
    this.protocol = new Protocol({ kernel: this })
    this.sockets = new Sockets({ kernel: this })
    this.screensavers = new Map()
    this.service = new Service({ kernel: this, ...this.options.service })
    this.shell = new Shell({ kernel: this, uid: 0, gid: 0, tty: 0 })
    this.storage = new Storage({ kernel: this })
    this.telemetry = new Telemetry({ kernel: this })
    this.terminal = new Terminal({ kernel: this, socket: this.options.socket, tty: 0 })
    this.users = new Users({ kernel: this })
    this.windows = new Windows()
    this.wasm = new Wasm({ kernel: this })
    this.workers = new Workers()

    this.shell.attach(this.terminal)
    this._shells.set(0, this.shell)
    // createBIOS().then((biosModule: BIOSModule) => {
    //   this.bios = biosModule
    //   resolveMountConfig({ backend: Emscripten, FS: biosModule.FS })
    //     .then(config => this.filesystem.fsSync.mount('/bios', config))
    // })

    // WebContainer.boot().then(container => this.container = container)
  }

  /**
   * Boots the kernel and initializes all core services.
   * @param options - Boot configuration options
   * @throws {Error} If boot process fails
   */
  async boot(options: BootOptions = DefaultBootOptions) {
    const tracer = this.telemetry.getTracer('ecmaos.kernel', this.version)
    const bootSpan = tracer.startSpan('kernel.boot', {
      attributes: {
        'kernel.id': this.id,
        'kernel.name': this.name,
        'kernel.version': this.version,
        'boot.silent': options.silent || false
      }
    })

    let spinner
    // Translation function will be set after locale is loaded
    let t: ReturnType<typeof this.i18n.i18next.getFixedT>

    // TODO: Remnants of experiments - to clean up or resume later
    // if (!globalThis.process.nextTick) globalThis.process.nextTick = (fn: () => void) => setTimeout(fn, 0)
    // if (!globalThis.process.exit) globalThis.process.exit = () => {}
    // if (!globalThis.process.cwd) globalThis.process.cwd = () => this.shell.cwd
    // if (!globalThis.process.chdir) globalThis.process.chdir = (dir: string) => {
    //   this.shell.cwd = dir
    //   localStorage.setItem(`cwd:${this.shell.credentials.uid}`, dir)
    // }

    try {
      this.dom.topbar()
      this.terminal.unlisten()

      // Setup polyfills and other features for node compatibility
      // TODO: Customize and synchronize with vite.config.ts to allow slimmer builds
      // const polyfills = {
      //   assert: await import('node:assert'),
      //   child_process: await import('node:child_process'),
      //   cluster: await import('node:cluster'),
      //   console: await import('node:console'),
      //   constants: await import('node:constants'),
      //   crypto: await import('node:crypto'),
      //   events: await import('node:events'),
      //   fs: this.filesystem.fsSync,
      //   'fs/promises': this.filesystem.fs,
      //   http: await import('node:http'),
      //   http2: await import('node:http2'),
      //   https: await import('node:https'),
      //   os: await import('node:os'),
      //   path: await import('node:path'),
      //   punycode: await import('node:punycode'),
      //   querystring: await import('node:querystring'),
      //   stream: await import('node:stream'),
      //   string_decoder: await import('node:string_decoder'),
      //   timers: await import('node:timers'),
      //   timers_promises: await import('node:timers/promises'),
      //   tty: await import('node:tty'),
      //   url: await import('node:url'),
      //   util: await import('node:util'),
      //   vm: await import('node:vm'),
      //   zlib: await import('node:zlib')
      // }

      // // if (polyfills.tty) polyfills.tty.isatty = () => true
      // globalThis.module = { exports: {} } as NodeModule

      // globalThis.requiremap = new Map()
      // // @ts-expect-error
      // globalThis.require = (id: string) => {
      //   // TODO: One day, I'm sure a more professional solution will be found
      //   // A lot of this complexity is necessary only because of this unfortunate combination of issues:
      //   // 1. Using IndexedDB gets unusably slow with lots of files unless disableAsyncCache is true
      //   // 2. When disabling caching, we lose all synchronous fs methods
      //   // 3. Require has to be synchronous
      //   if (id.startsWith('node:')) return polyfills[id.replace('node:', '') as keyof typeof polyfills]
      //   if (!globalThis.requiremap) globalThis.requiremap = new Map()

      //   const caller = (new Error()).stack?.split("\n")[2]?.trim().split(" ")[1]
      //   const url = caller?.replace(/:\d+:\d+$/, '')
      //   if (!id.startsWith('blob:') && url === 'eval' && polyfills[id.includes(':') ? id.split(':')[1] as keyof typeof polyfills : id as keyof typeof polyfills]) {
      //     return polyfills[id.includes(':') ? id.split(':')[1] as keyof typeof polyfills : id as keyof typeof polyfills]
      //   }

      //   if (url && (globalThis.requiremap.has(url) || url === 'eval')) {
      //     const { code } = globalThis.requiremap.get(id)!
      //     const cleanCode = code.startsWith('#!') ? code.split('\n').slice(1).join('\n') : code
      //     const func = new Function(cleanCode)
      //     func.call(globalThis)
      //     return globalThis.module.exports
      //   }

      //   const mod = id.split(':').length > 1 ? id.split(':')[1] : id
      //   return polyfills[mod as keyof typeof polyfills]
      // }

      // // Hacky, but just an initial experiment with node modules
      // const originalConsole = globalThis.console
      // globalThis.console = {
      //   ...originalConsole,
      //   log: (...args) => {
      //     originalConsole.log(...args)
      //     const caller = (new Error()).stack //?.split("\n")[2]?.trim().split(" ")[1]
      //     if (caller?.includes('blob:')) this.terminal.writeln(args.join(' '))
      //   },
      //   error: (...args) => {
      //     originalConsole.error(...args)
      //     const caller = (new Error()).stack //?.split("\n")[2]?.trim().split(" ")[1]
      //     if (caller?.includes('blob:')) this.terminal.writeln(chalk.red(args.join(' ')))
      //   },
      //   warn: (...args) => {
      //     originalConsole.warn(...args)
      //     const caller = (new Error()).stack //?.split("\n")[2]?.trim().split(" ")[1]
      //     if (caller?.includes('blob:')) this.terminal.writeln(chalk.yellow(args.join(' ')))
      //   },
      //   info: (...args) => {
      //     originalConsole.info(...args)
      //     const caller = (new Error()).stack //?.split("\n")[2]?.trim().split(" ")[1]
      //     if (caller?.includes('blob:')) this.terminal.writeln(args.join(' '))
      //   },
      //   debug: (...args) => {
      //     originalConsole.debug(...args)
      //     const caller = (new Error()).stack //?.split("\n")[2]?.trim().split(" ")[1]
      //     if (caller?.includes('blob:')) this.terminal.writeln(args.join(' '))
      //   }
      // }

      // Setup kernel logging
      this.log.attachTransport((logObj) => {
        if (!logObj?.['_meta']) return
        const acceptedLevels = ['WARN', 'ERROR']
        if (!acceptedLevels.includes(logObj['_meta'].logLevelName)) return

        let color = chalk.gray
        switch (logObj['_meta'].logLevelName) {
          case 'DEBUG': color = chalk.green; break
          case 'INFO': color = chalk.blue; break
          case 'WARN': color = chalk.yellow; break
          case 'ERROR': color = chalk.red; break
        }

        const numericKeys = Object.keys(logObj).filter(key => !isNaN(Number(key)))
        const logMessage = `${logObj['_meta'].name} ${color(logObj['_meta'].logLevelName)}\t${numericKeys.map(key => logObj[key]).join(' ') || logObj.message}`
        this.terminal.writeln(logMessage)
      })

      // Configure filesystem first (needed before we can read locale file)
      const configureSpan = tracer.startSpan('kernel.boot.configure', {}, trace.setSpan(context.active(), bootSpan))
      await this.configure({ devices: this.options.devices || DefaultDevices, filesystem: Filesystem.options() })
      configureSpan.end()

      // Create required filesystem paths (including /etc/default for locale file)
      const filesystemSpan = tracer.startSpan('kernel.boot.filesystem', {}, trace.setSpan(context.active(), bootSpan))
      const requiredPaths = [
        '/bin', '/sbin', '/boot', '/proc', '/tmp', '/home', '/lib', '/run', '/root', '/opt', '/sys',
        '/etc', '/etc/default', '/etc/opt',
        '/var', '/var/cache', '/var/lib', '/var/log', '/var/spool', '/var/tmp', '/var/lock', '/var/opt', '/var/games',
        '/usr', '/usr/bin', '/usr/lib', '/usr/sbin', '/usr/share', '/usr/share/docs', '/usr/share/licenses', '/usr/include', '/usr/local'
      ]

      const specialPermissions: Record<string, number> = {
        '/root': 0o700,
        '/proc': 0o777
      }

      for (const path of requiredPaths) {
        let mode = 0o755
        if (specialPermissions[path]) mode = specialPermissions[path]
        if (!(await this.filesystem.fs.exists(path))) await this.filesystem.fs.mkdir(path, { recursive: true, mode })
      }
      filesystemSpan.setAttribute('filesystem.paths_created', requiredPaths.length)
      filesystemSpan.end()

      const i18nResourcesSpan = tracer.startSpan('kernel.boot.i18n_resources', {}, trace.setSpan(context.active(), bootSpan))
      try {
        const i18nResult = await this.i18n.loadFilesystemResources(
          this.filesystem.fs,
          this.options.i18n?.fsTranslationsPath
        )
        i18nResourcesSpan.setAttribute('i18n.resources.bundles', i18nResult.bundles)
        i18nResourcesSpan.setAttribute('i18n.resources.files', i18nResult.files)
        if (i18nResult.errors.length > 0) {
          this.log.warn(`Loaded i18n resources with ${i18nResult.errors.length} error(s)`)
          for (const error of i18nResult.errors) this.log.warn(error)
        }
      } catch (error) {
        this.log.warn(`Failed to load filesystem i18n resources: ${(error as Error).message}`)
        i18nResourcesSpan.recordException(error as Error)
      }
      i18nResourcesSpan.end()

      // Load system-wide locale from /etc/default/locale (must happen before boot messages)
      const localeSpan = tracer.startSpan('kernel.boot.locale', {}, trace.setSpan(context.active(), bootSpan))
      try {
        const localeFilePath = '/etc/default/locale'
        let systemLocale = 'en_US'
        
        if (await this.filesystem.fs.exists(localeFilePath)) {
          const localeContent = await this.filesystem.fs.readFile(localeFilePath, 'utf-8')
          // Parse locale file: handle comments, quotes, and various formats
          // Examples: LANG=en_US, LANG="en_US", LANG='en_US', # comment, LANG=en_US.UTF-8
          for (const line of localeContent.split('\n')) {
            const trimmedLine = line.trim()
            // Skip empty lines and comments
            if (!trimmedLine || trimmedLine.startsWith('#')) continue
            
            const match = trimmedLine.match(/^LANG\s*=\s*(.+)$/)
            const localeValue = match?.[1]
            if (localeValue) {
              // Remove quotes and whitespace, then remove .UTF-8 suffix if present
              const cleaned = localeValue.trim().replace(/^["']|["']$/g, '')
              const parts = cleaned.split('.')
              systemLocale = parts[0] || 'en_US'
              break
            }
          }
        } else {
          // Create default locale file if it doesn't exist
          await this.sudo(async () => {
            await this.filesystem.fs.writeFile(localeFilePath, 'LANG=en_US\n', { mode: 0o644 })
          })
        }
        
        // Detect browser language and override system locale if they differ
        const browserLanguage = this.i18n.detectBrowserLanguage()
        const browserLocale = this.i18n.languageToLocale(browserLanguage)
        const systemLanguage = this.i18n.localeToLanguage(systemLocale)
        
        let finalLocale = systemLocale
        if (browserLanguage !== systemLanguage) {
          finalLocale = browserLocale
          // Update /etc/default/locale to match browser language
          await this.sudo(async () => {
            await this.filesystem.fs.writeFile(localeFilePath, `LANG=${finalLocale}\n`, { mode: 0o644 })
          })
          localeSpan.setAttribute('locale.overridden', true)
          localeSpan.setAttribute('locale.browser', browserLanguage)
        }
        
        this.i18n.setLanguage(finalLocale)
        // Get fresh translation function after locale is loaded
        t = this.i18n.i18next.getFixedT(this.i18n.language, 'kernel')
        localeSpan.setAttribute('locale.system', systemLocale)
        localeSpan.setAttribute('locale.final', finalLocale)
        localeSpan.setAttribute('locale.language', this.i18n.language)
      } catch (error) {
        this.log.warn(`Failed to load system locale: ${(error as Error).message}`)
        localeSpan.recordException(error as Error)
        this.i18n.setLanguage('en_US')
        // Fallback translation function
        t = this.i18n.i18next.getFixedT(this.i18n.language, 'kernel')
      }
      localeSpan.end()

      // Show verbose boot messages
      if (!options.silent && this.log) {
        const figletFont = options.figletFontRandom
          ? DefaultFigletFonts[Math.floor(Math.random() * DefaultFigletFonts.length)]
          : options.figletFont
            || getComputedStyle(document.documentElement).getPropertyValue('--figlet-font').trim()
            || 'Poison'
            

        const figletColor = options.figletColor
          || getComputedStyle(document.documentElement).getPropertyValue('--figlet-color').trim()
          || '#00FF00'

        const colorFiglet = (color: string, text: string) => {
          const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
          if (rgb) return chalk.rgb(parseInt(rgb[1] ?? 'FF'), parseInt(rgb[2] ?? 'FF'), parseInt(rgb[3] ?? 'FF'))(text)
          if (color.startsWith('#')) return chalk.hex(color)(text)
          return (chalk as unknown as { [key: string]: (text: string) => string })[color]?.(text) || text
        }

        let logoFiglet: string | undefined
        try {
          // TODO: A lot of trouble with Figlet fonts; revamp later - default to Poison now
          // const loadedFont = await import(`figlet/importable-fonts/${figletFont}.js`)
          // @ts-expect-error
          const loadedFont = await import('figlet/importable-fonts/Poison.js')
          figlet.parseFont(figletFont || 'Poison', loadedFont.default)
          logoFiglet = figlet.textSync(import.meta.env['FIGLET_TEXT'] || 'ECMAOS', { font: figletFont as keyof typeof figlet.fonts })
          // TODO: Fancier detection of figlet width and terminal width
          if (document.body.clientWidth >= 650) this.terminal.writeln(colorFiglet(figletColor, logoFiglet))
        } catch (error) {
          this.log.error(`Failed to load figlet font ${figletFont}: ${(error as Error).message}`)
        }

        const dependencyLinks = [
          { name: '@xterm/xterm', link: this.terminal.createSpecialLink('https://github.com/xtermjs/xterm.js', '@xterm/xterm') + `@${import.meta.env['XTERM_VERSION']}` },
          { name: '@zen-fs/core', link: this.terminal.createSpecialLink('https://github.com/zen-fs/core', '@zenfs/core') + `@${import.meta.env['ZENFS_VERSION']}` },
        ]

        this.terminal.writeln(chalk.red.bold(`🐉  ${this.i18n.ns.kernel('experimental')} 🐉`))
        this.terminal.writeln(
          `${this.terminal.createSpecialLink(import.meta.env['HOMEPAGE'], import.meta.env['NAME'] || 'ecmaOS')}@${import.meta.env['VERSION']}`
          + chalk.cyan(` [${dependencyLinks.map(link => link.link).join(', ')}]`))

        this.terminal.writeln(`${this.i18n.ns.kernel('madeBy')} ${this.terminal.createSpecialLink(
          import.meta.env['AUTHOR']?.url || 'https://github.com/mathiscode',
          `${import.meta.env['AUTHOR']?.name} <${import.meta.env['AUTHOR']?.email}>`
        )}`)

        this.terminal.writeln(import.meta.env['REPOSITORY'] + '\n')

        if (
          import.meta.env['KNOWN_ISSUES']
          && import.meta.env['ECMAOS_BOOT_DISABLE_ISSUES'] !== 'true'
          && !this.filesystem.fsSync.existsSync('/etc/noissues')
        ) {
          this.terminal.writeln(chalk.yellow.bold(this.i18n.ns.kernel('knownIssues')))
          this.terminal.writeln(chalk.yellow(import.meta.env['KNOWN_ISSUES'].map((issue: string) => `- ${issue}`).join('\n')) + '\n')
        }

        if (
          import.meta.env['ECMAOS_BOOT_DISABLE_TIPS'] !== 'true'
          && !this.filesystem.fsSync.existsSync('/etc/notips')
        ) {
          const tipsList = this.i18n.ns.kernel('tipsList', { returnObjects: true }) as string[]
          if (Array.isArray(tipsList) && tipsList.length > 0) {
            this.terminal.writeln(chalk.green.bold(this.i18n.ns.kernel('tips')))
            this.terminal.writeln(chalk.green(tipsList.map(tip => `- ${tip}`).join('\n')) + '\n')
          } else if (import.meta.env['TIPS']) {
            this.terminal.writeln(chalk.green.bold(this.i18n.ns.kernel('tips')))
            this.terminal.writeln(chalk.green(import.meta.env['TIPS'].map((tip: string) => `- ${tip}`).join('\n')) + '\n')
          }
        }

        spinner = this.terminal.spinner('arrow3', chalk.yellow(this.i18n.ns.common('Booting')))
        spinner.start()

        if (logoFiglet && import.meta.env['ECMAOS_BOOT_DISABLE_LOGO_CONSOLE'] !== 'true') {
          console.log(`%c${logoFiglet}`, 'color: green')
          console.log(`%c${import.meta.env['REPOSITORY'] || 'https://github.com/ecmaos/ecmaos'}`, 'color: blue; text-decoration: underline; font-size: 16px')
          this.log.info(`${import.meta.env['NAME'] || 'ecmaOS'} v${import.meta.env['VERSION']}`)
        }

        if (Notification?.permission === 'default') Notification.requestPermission()
        if (Notification?.permission === 'denied') this.log.warn(t('kernel.permissionNotificationDenied', 'Notification permission denied'))

        this.intervals.set('title-blink', () => {
          globalThis.document.title = globalThis.document.title.includes('_') ? 'ecmaos# ' : 'ecmaos# _'
        }, 600)

        this.dom.toast.success(`${import.meta.env['NAME']} v${import.meta.env['VERSION']}`)
        this.dom.showTtyIndicator(this._activeTty)
      }

      if (await this.filesystem.fs.exists('/run')) {
        const entries = await this.filesystem.fs.readdir('/run')
        for (const entry of entries) {
          const entryPath = `/run/${entry}`
          try {
            const stat = await this.filesystem.fs.stat(entryPath)
            if (stat.isFile()) {
              await this.filesystem.fs.unlink(entryPath)
            } else if (stat.isDirectory()) {
              const subEntries = await this.filesystem.fs.readdir(entryPath)
              for (const subEntry of subEntries) {
                await this.filesystem.fs.unlink(`${entryPath}/${subEntry}`)
              }
              await this.filesystem.fs.rmdir(entryPath)
            }
          } catch {}
        }
      }

      // Log to /var/log/kernel.log
      this.log.attachTransport((logObj) => {
        if (!logObj._meta) return
        const formattedDate = new Date(logObj._meta.date).toLocaleString(this.memory.config.get('locale') as string || 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          fractionalSecondDigits: 3,
          hour12: false
        }).replace(',', '')

        this.sudo(async () =>
          await this.filesystem.fs.appendFile('/var/log/kernel.log',
            `${formattedDate} [${logObj._meta?.logLevelName}] ${logObj[0] || logObj.message}\n\n`
          )
        )
      })

      // Load core kernel features
      await this.registerEvents()
      await this.registerDevices()
      await this.registerCommands()
      await this.registerProc() // TODO: This will be revamped elsewhere or implemented as a procfs backend
      await this.registerPackages()

      this.intervals.set('/proc', this.registerProc.bind(this), import.meta.env['ECMAOS_KERNEL_INTERVALS_PROC'] ?? 1000)

      // Load system crontab
      await this.loadCrontab('/etc/crontab', 'system')

      // Load and process fstab
      const fstabSpan = tracer.startSpan('kernel.boot.fstab', {}, trace.setSpan(context.active(), bootSpan))
      await this.loadFstab()
      fstabSpan.end()

      // Load kernel modules
      const modulesSpan = tracer.startSpan('kernel.boot.modules', {}, trace.setSpan(context.active(), bootSpan))
      const modules = import.meta.env['ECMAOS_KERNEL_MODULES']
      if (modules) {
        const mods = modules.split(',')
        modulesSpan.setAttribute('modules.count', mods.length)
        for (const mod of mods) {
          try {
            const spec = mod.match(/(@[^/]+\/[^@]+|[^@]+)(?:@([^/]+))?/)
            const name = spec?.[1]
            const version = spec?.[2]

            if (!name) { this.log.error(`Failed to load module ${mod}: Invalid package name format`); continue }
            if (!version) { this.log.error(`Failed to load module ${mod}: No version specified`); continue }

            this.log.info(`Loading module ${name}@${version}`)
            const [scope, pkg] = name.split('/')
            const pkgPath = `/usr/lib/${scope ? `${scope}/` : ''}${pkg}/${version}`
            const exists = await this.filesystem.fs.exists(pkgPath)

            let result
            if (!exists) {
              result = await this.shell.execute(`/bin/install ${name}@${version}`)
              if (result !== 0) throw new Error(`Failed to install module ${name}@${version}: ${result}`)
              if (!await this.filesystem.fs.exists(pkgPath)) throw new Error(`Failed to install module ${name}@${version}: ${result}`)
            }

            // load its main export from package.json
            const pkgJson = await this.filesystem.fs.readFile(`${pkgPath}/package.json`, 'utf-8')
            const pkgData = JSON.parse(pkgJson) as JSONSchemaForNPMPackageJsonFiles
            const mainFile = this.getPackageMainExport(pkgData)
            if (!mainFile) throw new Error(`Failed to load module ${name}@${version}: No main export found`)
            const mainPath = path.join(pkgPath,  mainFile)

            // Importing from a blob objectURL doesn't work for some reason, so use SWAPI
            const module = await import(/* @vite-ignore */ `/swapi/fs${mainPath}`) as KernelModule
            const modname = module.name?.value || mod
            module.init?.(this.id)
            this.modules.set(modname, module)
          } catch (error) {
            this.log.error(`Failed to load module ${mod}: ${(error as Error).message}`)
          }
        }
      }

      // Setup root user or load existing users
      const usersSpan = tracer.startSpan('kernel.boot.users', {}, trace.setSpan(context.active(), bootSpan))
      try {
        if (!await this.filesystem.fs.exists('/etc/passwd')) {
          await this.users.add({ username: 'root', password: 'root', home: '/root' }, { noHome: true })
          usersSpan.setAttribute('users.action', 'create_root')
        } else {
          await this.users.load()
          usersSpan.setAttribute('users.action', 'load')
        }
        usersSpan.setAttribute('users.count', this.users.all.size)
      } catch (err) {
        usersSpan.recordException(err as Error)
        usersSpan.setStatus({ code: 2, message: (err as Error).message })
        this.log.error(err)
        this.terminal.writeln(chalk.red((err as Error).message))
        usersSpan.end()
        throw err
      }

      usersSpan.end()
      spinner?.stop()
      this.dom.topbar()

      // Show login prompt or auto-login
      const authSpan = tracer.startSpan('kernel.boot.authentication', {}, trace.setSpan(context.active(), bootSpan))
      const autoLogin = this.options.credentials
        ? { username: this.options.credentials.username, password: this.options.credentials.password }
        : undefined
      
      await this.loginShell(this.shell, autoLogin ? { autoLogin } : undefined)
      
      if (autoLogin) {
        authSpan.setAttribute('auth.method', 'auto_login')
        authSpan.setAttribute('auth.username', autoLogin.username)
      }
      authSpan.end()

      // Display motd if it exists
      const motd = await this.filesystem.fs.exists('/etc/motd')
        ? await this.filesystem.fs.readFile('/etc/motd', 'utf-8')
        : null

      if (motd) this.terminal.writeln('\n' + motd)

      const user = this.users.get(this.shell.credentials.uid ?? 0)
      if (!user) throw new Error(t('kernel.userNotFound', 'User not found'))

      this.shell.credentials = {
        uid: user.uid,
        gid: user.gid,
        suid: user.uid,
        sgid: user.gid,
        euid: user.uid,
        egid: user.gid,
        groups: user.groups
      }

      // TODO: Fix initial prompt showing root as {user} substitution when not 0

      this.shell.cwd = localStorage.getItem(`cwd:${this.shell.credentials.uid}`) ?? (
        user.uid === 0 ? '/' : (user.home || '/')
      )

      // Load user crontab
      const userCrontabPath = path.join(user.home || '/root', '.config', 'crontab')
      await this.loadCrontab(userCrontabPath, 'user')

      // Setup screensavers
      // TODO: This shouldn't really be a part of the kernel
      const screensavers = import.meta.glob('./lib/screensavers/*.ts', { eager: true })
      for (const [key, saver] of Object.entries(screensavers)) {
        this.screensavers.set(
          key.replace('./lib/screensavers/', '').replace('.ts', ''),
          saver as { default: (options: { terminal: ITerminal }) => Promise<void>, exit: () => Promise<void> }
        )
      }

      const currentSaver = this.storage.local.getItem('screensaver') || 'matrix'
      if (currentSaver && this.screensavers.has(currentSaver)) {
        const saver = this.screensavers.get(currentSaver)

        let idleTimer: Timer
        const resetIdleTime = () => {
          clearTimeout(idleTimer)
          idleTimer = setTimeout(() => saver?.default({ terminal: this.terminal }), parseInt(this.storage.local.getItem('screensaver-timeout') ?? '60000'))
        }

        resetIdleTime()
        const events = ['mousemove', 'keydown', 'keyup', 'keypress', 'pointerdown']
        for (const event of events) globalThis.addEventListener(event, resetIdleTime)
      }

      const initSpan = tracer.startSpan('kernel.boot.init', {}, trace.setSpan(context.active(), bootSpan))
      if (!await this.filesystem.fs.exists('/boot/init')) await this.filesystem.fs.writeFile('/boot/init', '#!ecmaos:bin:script:init\n\n')
      const initProcess = new Process({
        args: [],
        command: 'init',
        uid: user.uid,
        gid: user.gid,
        kernel: this,
        shell: this.shell,
        terminal: this.terminal,
        entry: async () => await this.sudo(async () => await this.execute({ command: '/boot/init', shell: this.shell }))
      })

      initProcess.keepAlive()
      initProcess.start()
      initSpan.end()

      this._state = KernelState.RUNNING
      this.setupDebugGlobals()
      
      bootSpan.setAttribute('kernel.state', this._state)
      bootSpan.end()
      
      if (this.telemetry.active) {
        const provider = (this.telemetry as unknown as { _provider?: { forceFlush?: () => Promise<void> } })._provider
        if (provider?.forceFlush) {
          await provider.forceFlush().catch(() => {})
        }
      }

      // Install recommended apps if desired by user on first boot
      if (!this.storage.local.getItem('ecmaos:first-boot')) {
        const recommendedApps = import.meta.env['ECMAOS_RECOMMENDED_APPS']
        if (recommendedApps) {
          const apps = recommendedApps.split(',')
          this.terminal.writeln('\n' + chalk.yellow.bold(this.i18n.ns.kernel('recommendedApps')))
          this.terminal.writeln(chalk.green(apps.map((app: string) => `- ${app}`).join('\n')))
          this.terminal.write(chalk.green.bold(this.i18n.ns.kernel('installRecommendedApps')))

          const answer = await this.terminal.readline()
          if (answer.toLowerCase()[0] === 'y' || answer === '') {
            for (const app of apps) await this.shell.execute(`/bin/install --reinstall ${app}`)
          }
        }

        this.storage.local.setItem('ecmaos:first-boot', Date.now().toString())
      }

      this.terminal.write(ansi.erase.inLine(2) + this.terminal.prompt())
      this.terminal.focus()
      this.terminal.listen()
    } catch (error) {
      bootSpan.recordException(error as Error)
      bootSpan.setStatus({ code: 2, message: (error as Error).message })
      bootSpan.setAttribute('kernel.state', KernelState.PANIC)
      bootSpan.end()
      this.log.error(error)
      this._state = KernelState.PANIC
      this.events.dispatch<KernelPanicEvent>(KernelEvents.PANIC, { error: error as Error })
      this.dom.toast.error({
        message: this.i18n.ns.kernel('panic'),
        duration: 0,
        dismissible: false
      })
    }
  }

  /**
   * Configures kernel subsystems with the provided options
   * @param options - Configuration options for kernel subsystems
   */
  async configure(options: KernelOptions) {
    await this.filesystem.configure(options.filesystem ?? {})
  }

  /**
   * Gets the main entry file path from a package.json
   * @param pkgData - The parsed package.json data
   * @returns The main entry file path or null if not found
   */
  getPackageMainExport(pkgData: JSONSchemaForNPMPackageJsonFiles): string | null {
    let mainFile = null

    if (pkgData.exports) {
      const exportPaths = [
        './browser',
        '.',
        './index',
        './module',
        './main'
      ]
      
      for (const path of exportPaths) {
        const entry = (pkgData.exports as Record<string, unknown>)[path]
        if (typeof entry === 'string') {
          mainFile = entry
          break
        } else if (typeof entry === 'object' && entry !== null) {
          const subPaths = ['browser', 'module', 'default', 'import']
          for (const subPath of subPaths) {
            if (typeof (entry as Record<string, unknown>)[subPath] === 'string') {
              mainFile = (entry as Record<string, unknown>)[subPath]
              break
            }
          }

          if (mainFile) break
        }
      }
    }

    // Fallback to legacy fields if exports didn't yield a result
    if (!mainFile) {
      mainFile = pkgData.browser || pkgData.module || pkgData.main

      // Handle browser field if it's an object (remapping)
      if (typeof mainFile === 'object') {
        for (const key of Object.keys(mainFile)) {
          if (typeof mainFile[key] === 'string') {
            mainFile = mainFile[key]
            break
          }
        }
      }
    }

    return mainFile
  }

  /**
   * Executes a command in the kernel environment
   * @param options - Execution options containing command, args, and shell
   * @returns Exit code of the command
   */
  async execute(options: KernelExecuteOptions): Promise<number> {
    try {
      if (!await this.filesystem.exists(options.command)) {
        this.log.error(`File not found for execution: ${options.command}`)
        return -1
      }

      if (options.command.startsWith('/dev/')) {
        const device = Array.from(this.devices.values())
          .find(d => d.drivers?.some(driver => driver.name === options.command.replace(/^\/dev\//, '')))

        if (device) return await this.executeDevice(device.device, options.args)
      }

      const header = await this.readFileHeader(options.command, options.shell)
      if (!header) return -1

      let exitCode: number | void = -1
      switch (header.type) {
        case 'wasm':
          exitCode = await this.executeWasm(options)
          break
        case 'js':
          exitCode = await this.executeJavaScript(options)
          break
        case 'view':
          exitCode = await this.execute({
            ...options,
            command: '/bin/view',
            args: [options.command, ...(options.args || [])]
          })
          break
        case 'bin':
          switch (header.namespace) {
            case 'command':
              if (!header.name) return -1
              exitCode = await this.executeCommand({ ...options, command: header.name })
              break
            case 'app':
              if (!header.name) return -1
              exitCode = await this.executeApp({ ...options, command: header.name, file: options.command })
              break
            case 'script':
              exitCode = await this.executeScript(options)
              break
            case 'node': // we'll do what we can to try to make it run, but it may fail
              exitCode = await this.executeNode(options) // TODO: Use WebContainer later if experiments fail
              break
          }; break
      }

      exitCode = exitCode ?? 0
      options.shell.env.set('?', exitCode.toString())
      this.events.dispatch<KernelExecuteEvent>(KernelEvents.EXECUTE, { command: options.command, args: options.args, exitCode })
      return exitCode
    } catch (error) {
      console.error(error)
      this.log.error(error)
      options.shell.env.set('?', '-1')
      return -1
    }
  }

  /**
   * Executes an app
   * @param options - Execution options containing app path and shell
   * @returns Exit code of the app
   */
  async executeApp(options: KernelExecuteOptions): Promise<number> {
    try {
      const contents = await this.filesystem.fs.readFile(options.file!, 'utf-8')
      const binLink = await this.filesystem.fs.readlink(options.file!)
      const filePath = path.dirname(binLink)

      const blob = new Blob([await this.replaceImports(contents, filePath)], { type: 'text/javascript' })
      const url = URL.createObjectURL(blob)

      let exitCode = -1

      try {
        const module = await import(/* @vite-ignore */ url)
        const main = module?.main || module?.default

        if (typeof main !== 'function') throw new Error('No main function found in module')

        const process = this.processes.create({
          args: options.args || [],
          command: options.command,
          kernel: this,
          shell: options.shell || this.shell,
          terminal: options.terminal || this.terminal,
          uid: options.shell.credentials.uid,
          gid: options.shell.credentials.gid,
          entry: async (params) => await main(params),
          stdin: options.stdin,
          stdout: options.stdout,
          stderr: options.stderr
        })

        exitCode = await process.start()
      } finally {
        URL.revokeObjectURL(url)
      }

      return exitCode
    } catch (error) {
      this.log.error(`Failed to execute app: ${error}`)
      options.terminal?.writeln(chalk.red((error as Error).message))
      return -1
    }
  }

  /**
   * Executes a terminal command
   * @param options - Execution options containing command name, args, shell, and terminal
   * @returns Exit code of the command
   */
  async executeCommand(options: KernelExecuteOptions): Promise<number> {
    const terminal = options.terminal || this.terminal
    const command = terminal.commands[options.command as keyof typeof terminal.commands]
    if (!command) return -1

    const process = new Process({
      uid: options.shell.credentials.uid,
      gid: options.shell.credentials.gid,
      args: options.args,
      command: options.command,
      kernel: options.kernel || this,
      shell: options.shell || this.shell,
      terminal: options.terminal || this.terminal,
      entry: async (params: ProcessEntryParams) => await command.run.call(params, params.pid, params.args),
      stdin: options.stdin,
      stdinIsTTY: options.stdinIsTTY,
      stdout: options.stdout,
      stdoutIsTTY: options.stdoutIsTTY,
      stderr: options.stderr
    })

    const exitCode = await process.start()
    return exitCode
  }

  /**
   * Executes a device command
   * @param {KernelDevice} device - Device to execute command on
   * @param {string[]} args - Command arguments
   * @param {Shell} shell - Shell instance
   * @returns {Promise<number>} Exit code of the device command
   */
  async executeDevice(device: KernelDevice, args: string[] = [], shell: Shell = this.shell): Promise<number> {
    if (!device || !device.cli) {
      this.log.error(`Device not found or does not have a CLI`)
      return -1
    }

    let deviceProcess: Process | null = new Process({
      uid: shell.credentials.uid,
      gid: shell.credentials.gid,
      args,
      command: `/dev/${device.pkg.name}`,
      entry: async (params: ProcessEntryParams) => await device.cli?.({
        args: params.args,
        kernel: params.kernel,
        pid: params.pid,
        shell: params.shell,
        terminal: params.terminal
      }),
      kernel: this,
      shell,
      terminal: this.terminal
    })

    try {
      shell.setPositionalParameters([`/dev/${device.pkg.name}`, ...args])
      await deviceProcess.start()
    } catch (error) {
      this.log.error(error)
      this.terminal.writeln(chalk.red((error as Error).message))
      return -2
    } finally {
      deviceProcess = null
    }

    return 0
  }

  /**
   * Executes a node script (or tries to)
   *
   * @remarks
   * Don't expect it to work; this will help develop further emulation layers
   * We still need to resolve the IndexedDB/sync issues before sync fs calls will work
   *
   * @param options - Execution options containing script path and shell
   * @returns Exit code of the script
   */
  async executeNode(options: KernelExecuteOptions): Promise<number> {
    if (!options.command) return -1
    let exitCode = -1
    let url

    try {
      const contents = await this.filesystem.fs.readFile(options.command, 'utf-8')
      if (!contents) return -1

      const binLink = await this.filesystem.fs.readlink(options.command)
      const filePath = path.dirname(binLink)

      globalThis.process.execPath = '/sbin/ecmanode'
      globalThis.process.execArgv = []
      globalThis.process.argv = [globalThis.process.execPath, binLink, ...(options.args || [])]
      globalThis.process.argv0 = options.command

      // const debugContents = contents.split('\n').map((line, i) => i === 1 ? `debugger\n${line}` : line).join('\n')
      // const finalContents = debugContents
      const finalContents = contents

      const code = await this.replaceImports(finalContents, filePath)
      const blob = new Blob([code], { type: 'text/javascript' })
      url = URL.createObjectURL(blob)
      if (!url) throw new Error('Failed to create object URL')

      if (!globalThis.requiremap) globalThis.requiremap = new Map()
      globalThis.requiremap.set(url, {
        code,
        filePath,
        binLink,
        command: options.command,
        argv: [...globalThis.process.argv],
        argv0: globalThis.process.argv0
      })

      await import(/* @vite-ignore */ url)
      exitCode = 0
    } catch (error) {
      this.log.error(`Failed to execute node script: ${error}`)
      this.terminal.writeln(chalk.red((error as Error).message))
      console.error(error)
      exitCode = -1
      globalThis.requiremap?.delete(url!)
    } finally {
      URL.revokeObjectURL(url!)
    }

    return exitCode
  }

  /**
   * Executes a WebAssembly file
   * @param options - Execution options containing WASM path and shell
   * @returns Exit code of the WASM execution
   */
  async executeWasm(options: KernelExecuteOptions): Promise<number> {
    const terminal = options.terminal || this.terminal
    const stdinIsTTY = options.stdinIsTTY ?? (options.stdin ? false : true)
    const shouldUnlisten = terminal && stdinIsTTY
    let keyListener: { dispose: () => void } | null = null

    try {
      const wasmBytes = await options.shell.context.fs.promises.readFile(options.command)
      const needsWasi = await this.wasm.detectWasiRequirements(wasmBytes)

      let stdin: ReadableStream<Uint8Array>
      let closeStdin: (() => void) | null = null

      if (options.stdin) {
        stdin = options.stdin
      } else if (terminal && shouldUnlisten) {
        const stdinWithClose = terminal.getInputStreamWithClose()
        stdin = stdinWithClose.stream
        closeStdin = stdinWithClose.close
      } else {
        stdin = terminal?.getInputStream() || new ReadableStream<Uint8Array>()
      }

      const stdout = options.stdout || terminal?.stdout || new WritableStream<Uint8Array>()
      const stderr = options.stderr || terminal?.stderr || new WritableStream<Uint8Array>()

      if (shouldUnlisten) {
        terminal.clearCommand()
        terminal.unlisten()

        keyListener = terminal.onKey(({ domEvent }) => {
          console.log(domEvent.ctrlKey, domEvent.key)
          if (domEvent.ctrlKey && domEvent.key === 'c') {
            domEvent.preventDefault()
            domEvent.stopPropagation()
            terminal.events.dispatch(TerminalEvents.INTERRUPT, { terminal })
            return
          }

          if (domEvent.ctrlKey && domEvent.key === 'd') {
            domEvent.preventDefault()
            domEvent.stopPropagation()
            if (closeStdin) closeStdin()
            else stdin.cancel().catch(() => {})
            return
          }

          domEvent.preventDefault()
          domEvent.stopPropagation()

          // Echo to terminal and dispatch to stdin
          if (domEvent.key === 'Enter') {
            terminal.write('\r\n')
            // Send newline to stdin (fgets expects \n)
            terminal.dispatchStdin('\n')
          } else if (domEvent.key.length === 1) {
            terminal.write(domEvent.key)
            terminal.dispatchStdin(domEvent.key)
          }
        })
      }

      const process = new Process({
        uid: options.shell.credentials.uid,
        gid: options.shell.credentials.gid,
        args: options.args || [],
        command: options.command,
        kernel: this,
        shell: options.shell || this.shell,
        terminal: options.terminal || this.terminal,
        entry: async () => {
          if (needsWasi) {
            const result = await this.wasm.loadWasiComponent(options.command, {
              stdin,
              stdout,
              stderr
            }, [options.command, ...(options.args || [])], options.shell || this.shell, process.pid)
            return await result.exitCode
          } else {
            const { instance } = await this.wasm.loadWasm(options.command)
            const exports = instance.exports
            
            if (typeof exports._start === 'function') {
              try {
                (exports._start as () => void)()
                return 0
              } catch (error) {
                this.log.error(`WASM _start failed: ${(error as Error).message}`)
                return 1
              }
            } else if (typeof exports._initialize === 'function') {
              try {
                (exports._initialize as () => void)()
                return 0
              } catch (error) {
                this.log.error(`WASM _initialize failed: ${(error as Error).message}`)
                return 1
              }
            }
            return 0
          }
        },
        stdin,
        stdinIsTTY: options.stdinIsTTY,
        stdout,
        stdoutIsTTY: options.stdoutIsTTY,
        stderr
      })

      const exitCode = await process.start()
      return exitCode
    } catch (error) {
      this.log.error(`Failed to execute WASM: ${error}`)
      terminal?.writeln(chalk.red((error as Error).message))
      return -1
    } finally {
      if (keyListener) {
        keyListener.dispose()
        keyListener = null
      }
      if (shouldUnlisten) {
        terminal.listen()
      }
    }
  }

  /**
   * Executes a script file
   * @param options - Execution options containing script path and shell
   * @returns Exit code of the script
   */
  async executeScript(options: KernelExecuteOptions): Promise<number> {
    const header = await this.readFileHeader(options.command, options.shell)
    if (!header) return -1

    if (header.type !== 'bin' || header.namespace !== 'script') {
      this.log.error(`File is not a script: ${options.command}`)
      return -1
    }

    const script = await options.shell.context.fs.promises.readFile(options.command, 'utf-8')
    if (script) {
      const terminalCmdBefore = options.terminal?.cmd || ''
      
      for (const line of script.split('\n')) {
        if (line.startsWith('#') || line.trim() === '') continue
        await options.shell.execute(line)
      }

      if (options.terminal && terminalCmdBefore && options.terminal.cmd === terminalCmdBefore) {
        options.terminal.clearCommand()
        options.terminal.write(options.terminal.prompt())
      }

      return 0
    } else this.log.error(`Script ${options.command} not found`)

    return -1
  }

  /**
   * Executes a JavaScript file
   * @param options - Execution options containing JavaScript file path and shell
   * @returns Exit code of the JavaScript execution
   */
  async executeJavaScript(options: KernelExecuteOptions): Promise<number> {
    try {
      const code = await options.shell.context.fs.promises.readFile(options.command, 'utf-8')
      if (!code) {
        this.log.error(`JavaScript file not found or empty: ${options.command}`)
        return -1
      }

      const script = new Function(code)
      script()
      return 0
    } catch (error) {
      this.log.error(`Failed to execute JavaScript file: ${error}`)
      options.terminal?.writeln(chalk.red((error as Error).message))
      return -1
    }
  }

  /**
   * Shows a system notification if permissions are granted
   * @param {string} title - Notification title
   * @param {NotificationOptions} options - Notification options
   * @returns {Promise<Notification|void>} The created notification or void if permissions denied
   */
  async notify(title: string, options: NotificationOptions = {}): Promise<void | Notification> {
    if (Notification?.permission === 'granted') return new Notification(title, options)
    await Notification.requestPermission()
  }

  /**
   * Removes an event listener from the kernel.
   * @param {KernelEvents} event - The event to remove the listener from.
   * @param {EventCallback} listener - The listener to remove.
   * @returns {void}
   */
  off(event: KernelEvents, listener: EventCallback): void {
    this.events.off(event, listener)
  }

  /**
   * Adds an event listener to the kernel.
   * @param {KernelEvents} event - The event to listen for.
   * @param {EventCallback} listener - The listener to add.
   * @returns {void}
   */
  on(event: KernelEvents, listener: EventCallback): void {
    this.events.on(event, listener)
  }

  /**
   * Reads and parses a file header to determine its type
   * @param {string} filePath - Path to the file
   * @param {IShell} shell - Optional shell instance to use for filesystem operations
   * @returns {Promise<FileHeader|null>} Parsed header information or null if invalid
   */
  async readFileHeader(filePath: string, shell?: IShell): Promise<FileHeader | null> {
    const parseHeader = (header: string): FileHeader | null => {
      if (!header.startsWith('#!')) return null
      if (header.startsWith('#!ecmaos:')) {
        const [type, namespace, name] = header.replace('#!ecmaos:', '').split(':')
        if (!type) return null
        return { type, namespace, name }
      }

      if (header.startsWith('#!/usr/bin/env node')) return { type: 'bin', namespace: 'node', name: 'node' }
      return null
    }

    const checkMagicBytes = (buffer: Uint8Array, magicBytes: Uint8Array, offset: number = 0): boolean => {
      if (buffer.length < offset + magicBytes.length) return false
      return magicBytes.every((byte, index) => byte === buffer[offset + index])
    }

    const checkMagicBytesPattern = (buffer: Uint8Array, pattern: { bytes: Uint8Array; type: string; offset?: number; checker?: (buf: Uint8Array) => boolean }): boolean => {
      if (pattern.checker) {
        return pattern.checker(buffer)
      }
      return checkMagicBytes(buffer, pattern.bytes, pattern.offset || 0)
    }

    const shellContext = shell?.context || this.shell.context
    
    try {
      if (!await shellContext.fs.promises.exists(filePath)) return null
      
      const magicBytesPatterns: Array<{ bytes: Uint8Array; type: string; offset?: number; checker?: (buf: Uint8Array) => boolean }> = [
        { bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6D]), type: 'wasm' },
        { bytes: new Uint8Array([0xFF, 0xD8, 0xFF]), type: 'view' },
        { bytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47]), type: 'view' },
        { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]), type: 'view' },
        { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x39]), type: 'view' },
        { bytes: new Uint8Array([0x42, 0x4D]), type: 'view' },
        { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), type: 'view' },
        { bytes: new Uint8Array([0x66, 0x4C, 0x61, 0x43]), type: 'view' },
        { bytes: new Uint8Array([0x4F, 0x67, 0x67, 0x53]), type: 'view' },
        { bytes: new Uint8Array([0xFF, 0xFB]), type: 'view' },
        { bytes: new Uint8Array([0xFF, 0xF3]), type: 'view' },
        { bytes: new Uint8Array([0xFF, 0xF2]), type: 'view' },
        { bytes: new Uint8Array([0x49, 0x44, 0x33]), type: 'view' },
        { bytes: new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]), type: 'view' },
        {
          bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
          type: 'view',
          checker: (buf: Uint8Array) => {
            if (buf.length < 12) return false
            if (!checkMagicBytes(buf, new Uint8Array([0x52, 0x49, 0x46, 0x46]))) return false
            const webp = new Uint8Array([0x57, 0x45, 0x42, 0x50])
            const wave = new Uint8Array([0x57, 0x41, 0x56, 0x45])
            return checkMagicBytes(buf, webp, 8) || checkMagicBytes(buf, wave, 8)
          }
        },
        {
          bytes: new Uint8Array([0x00]),
          type: 'view',
          checker: (buf: Uint8Array) => {
            if (buf.length < 8) return false
            const ftyp = new Uint8Array([0x66, 0x74, 0x79, 0x70])
            return checkMagicBytes(buf, ftyp, 4)
          }
        }
      ]
      
      const maxMagicBytesLength = Math.max(12, ...magicBytesPatterns.map(p => (p.offset || 0) + p.bytes.length))
      
      let handle
      let firstBytes: Uint8Array | null = null

      const checkExtensionType = (filePath: string): FileHeader['type'] | null => {
        if (filePath.endsWith('.js')) return 'js'
        else if (filePath.endsWith('.md')) return 'view'
        else if (filePath.endsWith('.json')) return 'view'
        else if (filePath.endsWith('.txt')) return 'view'
        else return 'application/octet-stream'
      }
      
      try {
        handle = await shellContext.fs.promises.open(filePath, 'r')
        const buffer = new Uint8Array(maxMagicBytesLength)
        const result = await handle.read(buffer, 0, maxMagicBytesLength, 0)
        if (result.bytesRead >= maxMagicBytesLength) firstBytes = buffer
      } catch {
        const readable = shellContext.fs.createReadStream(filePath)
        return new Promise<FileHeader | null>((resolve, reject) => {
          let firstChunk: Buffer | null = null
          
          readable.on('data', (chunk: Buffer) => {
            if (firstChunk === null) {
              firstChunk = chunk
              
              if (chunk.length >= maxMagicBytesLength) {
                const chunkBytes = new Uint8Array(chunk.buffer, chunk.byteOffset, maxMagicBytesLength)
                for (const pattern of magicBytesPatterns) {
                  if (checkMagicBytesPattern(chunkBytes, pattern)) {
                    readable.destroy()
                    return resolve({ type: pattern.type as FileHeader['type'] })
                  }
                }
              }
              
              const firstLine = chunk.toString().split('\n')[0] || ''
              const header = parseHeader(firstLine)
              if (header) {
                readable.destroy()
                return resolve(header)
              }

              readable.destroy()
              const extensionType = checkExtensionType(filePath)
              return extensionType ? resolve({ type: extensionType }) : resolve(null)
            }
          })
          
          readable.on('error', (error: Error) => reject(error))
          readable.on('close', () => {
            readable.destroy()
            const extensionType = checkExtensionType(filePath)
            return extensionType ? resolve({ type: extensionType }) : resolve(null)
          })
        })
      }
      
      if (!handle) return null
      
      if (firstBytes) {
        for (const pattern of magicBytesPatterns) {
          if (checkMagicBytesPattern(firstBytes, pattern)) {
            await handle.close()
            return { type: pattern.type as FileHeader['type'] }
          }
        }
      }
      
      const firstLineBuffer = new Uint8Array(512)
      const firstLineResult = await handle.read(firstLineBuffer, 0, 512, 0)
      await handle.close()
      
      if (firstLineResult.bytesRead > 0) {
        const firstLine = new TextDecoder().decode(firstLineBuffer.slice(0, firstLineResult.bytesRead)).split('\n')[0] || ''
        const header = parseHeader(firstLine)
        if (header) return header
      }
      
      const extensionType = checkExtensionType(filePath)
      return extensionType ? { type: extensionType } : null
    } catch (error) {
      this.log.error(error)
      throw error
    }
  }

  /**
   * Reboots the kernel by performing a shutdown and page reload
   */
  async reboot() {
    this.log.warn(this.i18n.ns.common('Rebooting'))
    await this.shutdown()
    globalThis.location.reload()
  }

  /**
   * Registers the terminal commands.
   * @returns {Promise<void>} A promise that resolves when the terminal commands are registered.
   */
  async registerCommands() {
    if (!await this.filesystem.fs.exists('/bin')) await this.filesystem.fs.mkdir('/bin')
    const whitelistedCommands = Object.entries(TerminalCommands(this, this.shell, this.terminal)).filter(([name]) => !this.options.blacklist?.commands?.includes(name))
    for (const [name] of whitelistedCommands) {
      if (await this.filesystem.fs.exists(`/bin/${name}`)) continue
      await this.filesystem.fs.writeFile(`/bin/${name}`, `#!ecmaos:bin:command:${name}`, { mode: 0o755 })
    }
  }

  /**
   * Registers the devices.
   * @returns {Promise<void>} A promise that resolves when the devices are registered.
   */
  async registerDevices() {
    for (const device of Object.values(this.options.devices || DefaultDevices)) {
      const drivers = await device.getDrivers(this)
      this.devices.set(device.pkg.name, { device, drivers })
      for (const driver of drivers) {
        driver.singleton = driver.singleton ?? true
        addDevice(driver)
      }
    }
  }

  /**
   * Registers the kernel events.
   * @returns {Promise<void>} A promise that resolves when the events are registered.
   */
  async registerEvents() {
    for (const event of Object.values(KernelEvents)) {
      this.events.on(event, async (detail: unknown) => {
        switch (event) {
          case KernelEvents.PANIC:
            this.log.fatal('KernelPanic:', detail)
            
            if (this.telemetry.active) {
              const tracer = this.telemetry.getTracer('ecmaos.kernel', this.version)
              const panicSpan = tracer.startSpan('kernel.panic', {
                attributes: {
                  'kernel.id': this.id,
                  'kernel.state': this._state,
                  'kernel.version': this.version
                }
              })
              
              const panicDetail = detail as KernelPanicEvent
              if (panicDetail?.error) {
                panicSpan.recordException(panicDetail.error)
                panicSpan.setStatus({ code: 2, message: panicDetail.error.message })
                panicSpan.setAttribute('error.name', panicDetail.error.name)
                panicSpan.setAttribute('error.message', panicDetail.error.message)
                if (panicDetail.error.stack) {
                  panicSpan.setAttribute('error.stack', panicDetail.error.stack)
                }
              }
              
              panicSpan.end()
            }
            
            break
          // default:
          //   this.log.debug('KernelEvent:', event, { command, args, exitCode })
        }
      })
    }
  }

  /**
   * Registers the packages from /etc/packages that should be auto-loaded on boot.
   * @returns {Promise<void>} A promise that resolves when the packages are registered.
   */
  async registerPackages() {
    try {
      const packagesData = await this.filesystem.fs.readFile('/etc/packages', 'utf-8')
      const packages = packagesData.split('\n').filter(Boolean).filter(pkg => !pkg.startsWith('#'))
      for (const pkg of packages) {
        const spec = pkg.match(/(@[^/]+\/[^@]+|[^@]+)(?:@([^/]+))?/)
        const name = spec?.[1]
        if (!name || !await this.filesystem.fs.exists(`/usr/lib/${name}`)) continue
        const versions = await this.filesystem.fs.readdir(`/usr/lib/${name}`)
        const version = semver.maxSatisfying(versions, spec?.[2] || '*') || spec?.[2] || '*'
        const pkgData = await this.filesystem.fs.readFile(`/usr/lib/${name}/${version}/package.json`, 'utf-8')
        const pkgJson = JSON.parse(pkgData)
        const mainFile = this.getPackageMainExport(pkgJson)
        if (!mainFile) continue

        const filePath = `/usr/lib/${name}/${version}/${mainFile}`
        const fileContents = await this.filesystem.fs.readFile(filePath, 'utf-8')
        const blob = new Blob([fileContents], { type: 'text/javascript' })
        const url = URL.createObjectURL(blob)
        try {
          this.log.info(`Loading package ${name} v${version}`)
          const imports = await import(/* @vite-ignore */ url)
          this.packages.set(name, imports as Module)
        } catch (err) {
          this.log.error(`Failed to load package ${name} v${version}: ${err}`)
        } finally {
          URL.revokeObjectURL(url)
        }
      }
    } catch {}
  }

  /**
   * Loads and registers crontab entries from a file.
   * @param filePath - Path to the crontab file
   * @param scope - Scope of the crontab ('system' or 'user')
   * @returns {Promise<void>} A promise that resolves when the crontab is loaded.
   */
  async loadCrontab(filePath: string, scope: 'system' | 'user'): Promise<void> {
    try {
      let content: string
      
      if (scope === 'system') {
        if (!await this.shell.context.fs.promises.exists(filePath)) return
        content = await this.shell.context.fs.promises.readFile(filePath, 'utf-8')
      } else {
        if (!await this.shell.context.fs.promises.exists(filePath)) return
        content = await this.shell.context.fs.promises.readFile(filePath, 'utf-8')
      }

      const entries = parseCrontabFile(content)

      for (const entry of entries) {
        const jobName = `cron:${scope}:${entry.lineNumber}`
        
        // Clear existing job if it exists
        const existingHandle = this.intervals.getCron(jobName)
        if (existingHandle) {
          this.intervals.clearCron(jobName)
        }

        // Register new cron job
        this.intervals.setCron(
          jobName,
          entry.expression,
          async () => {
            try {
              await this.shell.execute(entry.command)
            } catch (error) {
              this.log.error(`Cron job ${jobName} execution failed: ${error instanceof Error ? error.message : String(error)}`)
            }
          },
          {
            errorHandler: (err) => {
              this.log.error(`Cron job ${jobName} failed: ${err instanceof Error ? err.message : String(err)}`)
            }
          }
        )
      }

      if (entries.length > 0) {
        this.log.info(`Loaded ${entries.length} cron job(s) from ${filePath}`)
      }
    } catch (error) {
      this.log.warn(`Failed to load crontab from ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Loads and processes fstab entries from /etc/fstab.
   * @returns {Promise<void>} A promise that resolves when fstab is processed.
   */
  async loadFstab(): Promise<void> {
    try {
      const fstabPath = '/etc/fstab'
      if (!await this.filesystem.fs.exists(fstabPath)) {
        return
      }

      const content = await this.filesystem.fs.readFile(fstabPath, 'utf-8')
      const entries = parseFstabFile(content)
      if (entries.length === 0) return
      this.log.info(`Processing ${entries.length} fstab entries...`)

      // Create dummy streams and terminal mock to avoid WritableStream locking issues during boot
      // These streams discard all output since we're mounting programmatically
      const createDummyStreams = () => {
        const stdout = new WritableStream<Uint8Array>({ write() {} })
        const stderr = new WritableStream<Uint8Array>({ write() {} })
        const stdin = new ReadableStream<Uint8Array>({ start() {} })
        
        const dummyTerminal = {
          stdin,
          stdout,
          stderr,
          getInputStream: () => stdin,
          write: () => {},
          writeln: () => {}
        } as unknown as ITerminal
        
        return { stdin, stdout, stderr, terminal: dummyTerminal }
      }

      for (const entry of entries) {
        try {
          await this.sudo(async () => {
            const target = path.resolve('/', entry.target)
            const source = entry.source || ''
            const type = entry.type
            const options = entry.options

            // Build mount command arguments
            const mountArgs: string[] = ['-t', type]
            
            if (options) {
              mountArgs.push('-o', options)
            }
            
            // Filesystem types that don't require a source
            const noSourceTypes = ['memory', 'singlebuffer', 'webstorage', 'webaccess', 'xml', 'dropbox', 'googledrive']
            
            // Add source only if provided AND filesystem type requires it
            if (source && !noSourceTypes.includes(type.toLowerCase())) {
              mountArgs.push(source)
            }
            
            // Add target
            mountArgs.push(target)

            // Create fresh streams and terminal mock for each mount to avoid locking issues
            const streams = createDummyStreams()
            
            // Execute mount command programmatically
            const exitCode = await this.execute({
              command: '/bin/mount',
              args: mountArgs,
              shell: this.shell,
              terminal: streams.terminal,
              stdin: streams.stdin,
              stdout: streams.stdout,
              stderr: streams.stderr,
              stdinIsTTY: false,
              stdoutIsTTY: false
            })
            
            if (exitCode === 0) {
              this.log.info(`Mounted ${type} filesystem at ${target}`)
            } else {
              throw new Error(`mount command exited with code ${exitCode} while mounting ${type} filesystem at ${target}`)
            }
          })
        } catch (error) {
          this.log.warn(`Failed to mount filesystem ${entry.target} (type: ${entry.type}): ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      this.log.info(`Processed ${entries.length} fstab entry/entries`)
    } catch (error) {
      this.log.warn(`Failed to load fstab: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Registers the initial /proc entries.
   * @returns {Promise<void>} A promise that resolves when the proc entries are registered.
   */
  async registerProc() {
    if (!await this.filesystem.fs.exists('/proc')) await this.filesystem.fs.mkdir('/proc')

    const contents = {
      memory: '?',
      platform: navigator.userAgentData?.platform || navigator?.platform || navigator.userAgent,
      querystring: location.search,
      version: `${import.meta.env['NAME']} ${import.meta.env['VERSION']}`,
      language: navigator.language,
      host: location.host,
      userAgent: navigator.userAgent,
      userAgentData: navigator.userAgentData ? JSON.stringify(navigator.userAgentData, null, 2) : null,
      connection: JSON.stringify({
        downlink: 0,
        effectiveType: 'unknown',
        rtt: 0,
        saveData: false
      }, null, 2)
    }

    if ('connection' in navigator) {
      try {
        const { downlink, effectiveType, rtt, saveData } = navigator.connection as { downlink: number; effectiveType: string; rtt: number; saveData: boolean }
        contents.connection = JSON.stringify({ downlink, effectiveType, rtt, saveData }, null, 2)
      } catch {
        this.log.warn(this.i18n.ns.kernel('connectionDataFailed'))
      }
    }

    if ('deviceMemory' in navigator) contents.memory = `>= ${navigator.deviceMemory}GB`

    for (const [key, value] of Object.entries(contents) as [string, string | null][]) {
      try {
        await this.filesystem.fs.writeFile(`/proc/${key}`, value ?? new Uint8Array(), { flag: 'w+', mode: 0o777 })
      } catch (error) {
        this.log.warn(`Failed to write proc data: ${key}`, error)
      }
    }

    // Create /proc/self directory and entries for process information
    if (!await this.filesystem.fs.exists('/proc/self')) {
      await this.filesystem.fs.mkdir('/proc/self', { mode: 0o555 })
    }

    // Get the most recent process or use PID 1 as default
    const allProcesses = Array.from(this.processes.all.values())
    const lastProcess = allProcesses.length > 0 ? allProcesses[allProcesses.length - 1] : null
    const currentPid = lastProcess?.pid || 1
    const currentProcess = this.processes.get(currentPid) || null

    // /proc/self/stat - process status (format similar to Linux /proc/self/stat)
    // Fields: pid, comm, state, ppid, pgrp, session, tty_nr, tpgid, flags, minflt, cminflt, majflt, cmajflt, utime, stime, cutime, cstime, priority, nice, num_threads, itrealvalue, starttime, vsize, rss, rsslim, startcode, endcode, startstack, kstkesp, kstkeip, signal, blocked, sigignore, sigcatch, wchan, nswap, cnswap, exit_signal, processor, rt_priority, policy, delayacct_blkio_ticks, guest_time, cguest_time, start_data, end_data, start_brk, arg_start, arg_end, env_start, env_end, exit_code
    const statFields = [
      currentPid,                    // 1: pid
      '(ecmaos)',                    // 2: comm (command name in parentheses)
      'R',                           // 3: state (R=running)
      currentProcess?.parent || 0,  // 4: ppid (parent process ID)
      currentPid,                    // 5: pgrp (process group ID)
      currentPid,                    // 6: session (session ID)
      0,                             // 7: tty_nr (controlling terminal)
      currentPid,                    // 8: tpgid (terminal process group)
      0,                             // 9: flags
      0, 0, 0, 0,                    // 10-13: minflt, cminflt, majflt, cmajflt
      0, 0, 0, 0,                    // 14-17: utime, stime, cutime, cstime
      0,                             // 18: priority
      0,                             // 19: nice
      1,                             // 20: num_threads
      0,                             // 21: itrealvalue
      Date.now(),                    // 22: starttime (jiffies since boot - using ms)
      0,                             // 23: vsize (virtual memory size)
      0,                             // 24: rss (resident set size)
      0,                             // 25: rsslim
      0, 0, 0, 0, 0,                 // 26-30: startcode, endcode, startstack, kstkesp, kstkeip
      0, 0, 0, 0,                    // 31-34: signal, blocked, sigignore, sigcatch
      0, 0, 0,                       // 35-37: wchan, nswap, cnswap
      0,                             // 38: exit_signal
      0,                             // 39: processor
      0,                             // 40: rt_priority
      0,                             // 41: policy
      0,                             // 42: delayacct_blkio_ticks
      0, 0,                          // 43-44: guest_time, cguest_time
      0, 0, 0, 0,                    // 45-48: start_data, end_data, start_brk, arg_start
      0, 0, 0,                       // 49-51: arg_end, env_start, env_end
      0                              // 52: exit_code
    ]
    const statContent = statFields.join(' ')

    // /proc/self/exe - path to executable (symlink to the command)
    const exePath = currentProcess?.command || '/bin/ecmaos'

    try {
      await this.filesystem.fs.writeFile('/proc/self/stat', statContent, { flag: 'w+', mode: 0o444 })
      // Create symlink for /proc/self/exe
      if (await this.filesystem.fs.exists('/proc/self/exe')) {
        await this.filesystem.fs.unlink('/proc/self/exe')
      }
      await this.filesystem.fs.symlink(exePath, '/proc/self/exe')
    } catch (error) {
      this.log.warn(`Failed to write /proc/self entries:`, error)
    }
  }

  /**
   * Replaces imports in a script with SWAPI URLs
   *
   * @remarks
   * I would love to just use import maps, but we need dynamic import maps
   * This is probably not our long-term solution
   *
   * @param {string} contents - The script contents
   * @returns {Promise<string>} The modified script contents
   */
  async replaceImports(contents: string, packagePath: string): Promise<string> {
    const replacements: Record<string, string> = {}
    const importRegex = /from ['"]([^'"]+)['"]/g
    const imports = contents.match(importRegex) || []
    for (const match of imports) {
      const importPath = match.replace(/from ['"]|['"]/g, '')
      const exists = await this.filesystem.fs.exists(`/usr/lib/${path.join(packagePath, importPath)}`)
      if (exists) replacements[match] = `from "${location.protocol}//${location.host}/swapi/fs${path.join(packagePath, importPath)}"`
    }

    for (const [match, replacement] of Object.entries(replacements)) contents = contents.replace(match, replacement)

    // process requires
    if (!globalThis.requiremap) globalThis.requiremap = new Map()
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g
    const requires = contents.matchAll(requireRegex) || []
    for (const match of requires) {
      const id = match[1]
      if (!id || !id.startsWith('.')) continue

      const resolvedPath = path.resolve(packagePath, id)
      const resolvedStat = await this.filesystem.fs.stat(resolvedPath)
      const finalPath = resolvedStat.isFile() ? resolvedPath : path.resolve(resolvedPath, 'index.js')
      const depContents = await this.filesystem.fs.readFile(finalPath, 'utf-8')
      const finalContents = await this.replaceImports(depContents, path.dirname(finalPath))

      let depUrl = id
      for (const key of globalThis.requiremap.keys()) {
        depUrl = key
        break
      }

      globalThis.requiremap.set(depUrl, {
        command: 'ecmaos:require',
        filePath: resolvedPath,
        binLink: '',
        argv: [...globalThis.process.argv],
        argv0: globalThis.process.argv0,
        code: finalContents
      })

      contents = contents.replace(id, depUrl)
    }

    return contents
  }

  /**
   * Shuts down the kernel.
   * @returns {Promise<void>} A promise that resolves when the kernel is shut down.
   */
  async shutdown() {
    this.terminal.unlisten()
    this._state = KernelState.SHUTDOWN
    this.events.dispatch<KernelShutdownEvent>(KernelEvents.SHUTDOWN, { data: {} })
  }

  /**
   * Updates the i18n language from the LANG environment variable if present
   * This allows users to override the system-wide locale with their LANG env var
   */
  private updateLocaleFromEnv(): void {
    const langEnv = this.shell.env.get('LANG')
    if (langEnv) {
      try {
        this.i18n.setLanguage(langEnv)
        this.log.debug(`Locale updated from LANG env var: ${langEnv} -> ${this.i18n.language}`)
      } catch (error) {
        this.log.warn(`Failed to update locale from LANG env var: ${(error as Error).message}`)
      }
    }
  }

  /**
   * Logs in a shell with user credentials
   * @param shell - Shell instance to log in
   * @param options - Login options including auto-login credentials
   */
  async loginShell(shell: Shell, options?: { autoLogin?: { username: string, password: string } }): Promise<void> {
    const terminal = shell.terminal
    const t = this.i18n.i18next.getFixedT(this.i18n.language, 'kernel')

    if (options?.autoLogin) {
      const { user, cred } = await this.users.login(options.autoLogin.username, options.autoLogin.password)
      shell.credentials = cred
      shell.context = bindContext({ root: '/', pwd: '/', credentials: cred })
      shell.env.set('UID', user.uid.toString())
      shell.env.set('GID', user.gid.toString())
      shell.env.set('SUID', cred.suid.toString())
      shell.env.set('SGID', cred.sgid.toString())
      shell.env.set('EUID', cred.euid.toString())
      shell.env.set('EGID', cred.egid.toString())
      shell.env.set('SHELL', user.shell || 'ecmaos')
      shell.env.set('HOME', user.home || '/root')
      shell.env.set('USER', user.username)
      shell.env.set('HOSTNAME', globalThis.location.hostname || 'localhost')
      process.env = Object.fromEntries(shell.env)
      await shell.loadEnvFile()
      this.updateLocaleFromEnv()
      return
    }

    if (import.meta.env['ECMAOS_APP_SHOW_DEFAULT_LOGIN'] === 'true') {
      terminal.writeln(chalk.yellow.bold(`⚠️  ${this.i18n.ns.kernel('defaultLogin')}: root / root\n`))
    }

    const holidayEmojis: Record<string, string> = {
      '01-01': '🎉 ',
      '02-14': '💝 ',
      '03-17': '☘️ ',
      '04-01': '🎭 ',
      '05-05': '🇲🇽',
      '06-19': '✊ ',
      '07-04': '🇺🇸',
      '10-31': '🎃 ',
      '11-11': '🪖 ',
      '11-24': '🦃 ',
      '12-25': '🎄 ',
      '12-31': '🎇 ',
    }

    const now = new Date()
    const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const holidayEmoji = holidayEmojis[monthDay] || '🗓️ '
    const formattedDate = Intl.DateTimeFormat(this.memory.config.get('locale') as string || 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(now)

    terminal.writeln(`${holidayEmoji} ${formattedDate}`)

    const issue = await this.filesystem.fs.exists('/etc/issue')
      ? await this.filesystem.fs.readFile('/etc/issue', 'utf-8')
      : null

    if (issue) terminal.writeln(issue)

    while (true) {
      try {
        const loc = globalThis.location
        const protocol = loc?.protocol || 'ecmaos:'
        const hostname = loc?.hostname || 'localhost'
        const port = loc && loc.port && loc.port !== '80' && loc.port !== '443' ? `:${loc.port}` : ''

        const isSecure = globalThis.window?.isSecureContext ?? false
        const protocolStr = isSecure
          ? chalk.green(protocol)
          : chalk.red(protocol)
        const icon = isSecure ? '🔒' : '🔓'

        terminal.writeln(`${icon}  ${protocolStr}//${hostname}${port}`)

        const username = await terminal.readline(`👤  ${this.i18n.ns.common('Username')}: `)
        const user = Array.from(this.users.all.values()).find(u => u.username === username)
        
        let loginSuccess = false
        let userCred: { user: User, cred: Credentials } | null = null

        if (user) {
          const passkeys = await this.users.getPasskeys(user.uid)
          if (passkeys.length > 0 && this.auth.passkey.isSupported()) {
            try {
              const challenge = crypto.getRandomValues(new Uint8Array(32))
              const rpId = globalThis.location.hostname || 'localhost'
              
              const allowCredentials = passkeys.map(pk => {
                const credentialIdBytes = Uint8Array.from(atob(pk.credentialId), c => c.charCodeAt(0))
                return {
                  id: credentialIdBytes.buffer,
                  type: 'public-key' as const,
                  transports: ['usb', 'nfc', 'ble', 'internal'] as AuthenticatorTransport[]
                }
              })

              const requestOptions: PublicKeyCredentialRequestOptions = {
                challenge,
                allowCredentials,
                rpId,
                userVerification: 'preferred',
                timeout: 60000
              }

              terminal.writeln(chalk.yellow(`🔐  ${this.i18n.ns.kernel('passkeyAuthenticate')}`))
              const credential = await this.auth.passkey.get(requestOptions)
              
              if (credential && credential instanceof PublicKeyCredential) {
                userCred = await this.users.login(username, undefined, credential)
                loginSuccess = true
              } else {
                terminal.writeln(chalk.yellow(t('kernel.passkeyCancelled', 'Passkey authentication cancelled or failed. Falling back to password...')))
              }
            } catch (err) {
              terminal.writeln(chalk.yellow(t('kernel.passkeyError', 'Passkey authentication error: {{error}}. Falling back to password...', { error: (err as Error).message })))
            }
          }
        }

        if (!loginSuccess) {
          const password = await terminal.readline(`🔑  ${this.i18n.ns.common('Password')}: `, true)
          userCred = await this.users.login(username, password)
        }

        if (!userCred) throw new Error(this.i18n.ns.kernel('loginFailed'))

        shell.credentials = userCred.cred
        shell.context = bindContext({ root: '/', pwd: '/', credentials: userCred.cred })
        await shell.loadEnvFile()
        shell.env.set('UID', userCred.user.uid.toString())
        shell.env.set('GID', userCred.user.gid.toString())
        shell.env.set('SUID', userCred.cred.suid.toString())
        shell.env.set('SGID', userCred.cred.sgid.toString())
        shell.env.set('EUID', userCred.cred.euid.toString())
        shell.env.set('EGID', userCred.cred.egid.toString())
        shell.env.set('SHELL', userCred.user.shell || 'ecmaos')
        shell.env.set('HOME', userCred.user.home || '/root')
        shell.env.set('USER', userCred.user.username)
        process.env = Object.fromEntries(shell.env)
        
        const langEnv = shell.env.get('LANG')
        if (langEnv) {
          try {
            this.i18n.setLanguage(langEnv)
            this.log.debug(`Locale updated from LANG env var: ${langEnv} -> ${this.i18n.language}`)
          } catch (error) {
            this.log.warn(`Failed to update locale from LANG env var: ${(error as Error).message}`)
          }
        }
        break
      } catch (err) {
        console.error(err)
        terminal.writeln(chalk.red((err as Error).message) + '\n')
      }
    }
  }

  /**
   * Gets a shell by TTY number
   * @param ttyNumber - TTY number (0-9)
   * @returns Shell instance or undefined if not found
   */
  getShell(ttyNumber: number): Shell | undefined {
    return this._shells.get(ttyNumber)
  }

  /**
   * Creates a new shell and terminal for a TTY
   * @param ttyNumber - TTY number (0-9)
   * @returns Created shell instance
   */
  async createShell(ttyNumber: number): Promise<Shell> {
    if (ttyNumber < 0 || ttyNumber > 9) {
      throw new Error('TTY number must be between 0 and 9')
    }

    if (this._shells.has(ttyNumber)) {
      return this._shells.get(ttyNumber)!
    }

    const terminalContainer = document.getElementById(`terminal-tty${ttyNumber}`)
    if (!terminalContainer) {
      throw new Error(`Terminal container for TTY ${ttyNumber} not found`)
    }

    const wasActive = terminalContainer.classList.contains('active')
    if (!wasActive) {
      terminalContainer.classList.add('active')
    }

    const terminal = new Terminal({ kernel: this, tty: ttyNumber })
    terminal.mount(terminalContainer as HTMLElement)

    if (!wasActive && ttyNumber !== this._activeTty) {
      terminalContainer.classList.remove('active')
    }

    const shell = new Shell({ kernel: this, uid: 0, gid: 0, tty: ttyNumber, terminal })
    terminal.attachShell(shell)

    this._shells.set(ttyNumber, shell)

    const autoLogin = this.options.credentials
      ? { username: this.options.credentials.username, password: this.options.credentials.password }
      : undefined

    await this.loginShell(shell, autoLogin ? { autoLogin } : undefined)

    const user = this.users.get(shell.credentials.uid ?? 0)
    if (!user) throw new Error(this.i18n.i18next.getFixedT(this.i18n.language, 'kernel')('kernel.userNotFound', 'User not found'))

    shell.credentials = {
      uid: user.uid,
      gid: user.gid,
      suid: user.uid,
      sgid: user.gid,
      euid: user.uid,
      egid: user.gid,
      groups: user.groups
    }

    shell.cwd = localStorage.getItem(`cwd:${shell.credentials.uid}`) ?? (
      user.uid === 0 ? '/' : (user.home || '/')
    )

    const motd = await this.filesystem.fs.exists('/etc/motd')
      ? await this.filesystem.fs.readFile('/etc/motd', 'utf-8')
      : null

    if (motd) terminal.writeln('\n' + motd)

    terminal.write(ansi.erase.inLine(2) + terminal.prompt())
    terminal.focus()

    return shell
  }

  /**
   * Switches to a different TTY
   * @param ttyNumber - TTY number to switch to (0-9)
   */
  async switchTty(ttyNumber: number): Promise<void> {
    if (ttyNumber < 0 || ttyNumber > 9) throw new Error('TTY number must be between 0 and 9')
    if (ttyNumber === this._activeTty) return

    const previousTty = this._activeTty
    this._activeTty = ttyNumber

    const currentShell = this._shells.get(previousTty)
    if (currentShell) {
      currentShell.terminal.unlisten()
      const currentContainer = document.getElementById(`terminal-tty${previousTty}`)
      if (currentContainer) currentContainer.classList.remove('active')
    }

    const targetContainer = document.getElementById(`terminal-tty${ttyNumber}`)
    if (targetContainer) targetContainer.classList.add('active')

    this.dom.showTtyIndicator(ttyNumber)

    let targetShell = this._shells.get(ttyNumber)
    if (!targetShell) targetShell = await this.createShell(ttyNumber)

    requestAnimationFrame(() => {
      if (targetShell.terminal.addons?.get('fit')) (targetShell.terminal.addons.get('fit') as FitAddon).fit()
      targetShell.terminal.focus()
      targetShell.terminal.listen()
    })
  }

  /**
   * Executes an operation with root (or other) privileges
   * @param {() => Promise<T>} operation - Operation to execute
   * @param {Partial<Credentials>} cred - Optional credentials to use
   * @returns {Promise<T>} Result of the operation
   */
  private async sudo<T>(
    operation: () => Promise<T>,
    cred: Credentials = { uid: 0, gid: 0, suid: 0, sgid: 0, euid: 0, egid: 0, groups: [] }
  ): Promise<T | undefined> {
    const currentCredentials = { ...this.shell.credentials }
    const currentContext = { ...this.shell.context }
    let result: T | undefined

    try {
      this.shell.credentials = cred
      this.shell.context = bindContext({ root: '/', pwd: '/', credentials: cred })
      result = await operation()
    } catch (error) {
      this.log.error(error)
    } finally {
      this.shell.credentials = currentCredentials
      this.shell.context = currentContext
    }

    return result
  }

  /**
   * Sets up global debug utilities for browser console access.
   * Access via: ecmaos.kernel, ecmaos.processes(), ecmaos.fd(pid?), etc.
   */
  private setupDebugGlobals() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ecmaos = (globalThis as any).ecmaos || {}
    
    Object.assign(ecmaos, {
      // Core references
      kernel: this,
      
      // Process utilities
      processes: () => {
        const procs = Array.from(this.processes.all.values()) as Process[]
        console.table(procs.map((p: Process) => ({
          pid: p.pid,
          command: p.command,
          status: p.status,
          uid: p.uid,
          gid: p.gid,
          cwd: p.cwd
        })))
        return procs
      },
      
      // File descriptor table for a specific process
      fd: (pid?: number) => {
        if (pid === undefined) {
          // Show all processes and their fd info
          const procs = Array.from(this.processes.all.values()) as Process[]
          for (const proc of procs) {
            console.group(`PID ${proc.pid}: ${proc.command}`)
            console.log('stdin:', proc.fd.stdin ? '✓' : '✗')
            console.log('stdout:', proc.fd.stdout ? '✓' : '✗')
            console.log('stderr:', proc.fd.stderr ? '✓' : '✗')
            console.log('tracked file handles:', proc.fd.fileHandles.length)
            console.groupEnd()
          }
          return procs.map(p => ({ pid: p.pid, fd: p.fd }))
        }
        
        const proc = this.processes.get(pid) as Process | undefined
        if (!proc) {
          console.error(`Process ${pid} not found`)
          return null
        }
        
        console.group(`FDTable for PID ${pid}: ${proc.command}`)
        console.log('stdin:', proc.fd.stdin)
        console.log('stdout:', proc.fd.stdout)
        console.log('stderr:', proc.fd.stderr)
        console.log('tracked file handles:', proc.fd.fileHandles)
        console.groupEnd()
        
        return proc.fd
      },
      
      // Terminal reference
      terminal: this.terminal,
      
      // Shell reference
      shell: this.shell,
      
      // Filesystem reference
      fs: this.filesystem.fs
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).ecmaos = ecmaos
    
    this.log.debug('Debug globals available: ecmaos.kernel, ecmaos.processes(), ecmaos.fd(pid?), ecmaos.terminal, ecmaos.shell, ecmaos.fs')
  }
}
