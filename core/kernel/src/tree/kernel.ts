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

import { JSONSchemaForNPMPackageJsonFiles } from '@schemastore/package'

import { Notyf } from 'notyf'
import { addDevice, CredentialInit, credentials, DeviceDriver, resolveMountConfig, useCredentials } from '@zenfs/core'
import { Emscripten } from '@zenfs/emscripten'

import './../themes/default.scss'
import 'notyf/notyf.min.css'

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
import { Shell } from '#shell.ts'
import { Storage } from '#storage.ts'
import { Users } from '#users.ts'
import { Wasm } from '#wasm.ts'
import { Windows } from '#windows.ts'
import { Workers } from '#workers.ts'

import createBIOS, { BIOSModule } from '@ecmaos/bios'
import { TerminalCommands } from '#lib/commands/index.js'

import {
  KernelEvents,
  KernelState
} from '@ecmaos/types'

import type {
  BootOptions,
  Kernel as IKernel,
  KernelDevice,
  KernelExecuteEvent,
  KernelExecuteOptions,
  KernelOptions,
  KernelPanicEvent,
  Terminal as ITerminal,
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
  public bios?: BIOSModule
  /** Broadcast channel for inter-kernel communication */
  public readonly channel: BroadcastChannel
  /** Web Components manager */
  public readonly components: Components
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
  /** Map of available screensavers */
  public readonly screensavers: Map<string, { default: (options: { terminal: ITerminal }) => Promise<void>, exit: () => Promise<void> }>
  /** Service management system */
  public readonly service: Service
  /** Shell for command interpretation and execution */
  public readonly shell: Shell
  /** Storage provider interface */
  public readonly storage: Storage
  /** Terminal interface for user interaction */
  public readonly terminal: ITerminal
  /** Toast notification service */
  public readonly toast: Notyf
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
    this.filesystem = new Filesystem()
    this.i18n = new I18n(this.options.i18n)
    this.intervals = new Intervals()
    this.keyboard = navigator.keyboard
    this.log = this.options.log ? new Log(this.options.log) : new Log()
    this.memory = new Memory()
    this.modules = new Map()
    this.processes = new ProcessManager()
    this.protocol = new Protocol({ kernel: this })
    this.screensavers = new Map()
    this.service = new Service({ kernel: this, ...this.options.service })
    this.shell = new Shell({ kernel: this, uid: 0, gid: 0 })
    this.storage = new Storage({ kernel: this })
    this.terminal = new Terminal({ kernel: this, socket: this.options.socket })
    this.toast = new Notyf(this.options.toast)
    this.users = new Users({ kernel: this })
    this.windows = new Windows()
    this.wasm = new Wasm({ kernel: this })
    this.workers = new Workers()

    this.shell.attach(this.terminal)
    createBIOS().then((biosModule: BIOSModule) => {
      this.bios = biosModule
      resolveMountConfig({ backend: Emscripten, FS: biosModule.FS })
        .then(config => this.filesystem.fsSync.mount('/bios', config))
    })
  }

  /**
   * Boots the kernel and initializes all core services.
   * @param options - Boot configuration options
   * @throws {Error} If boot process fails
   */
  async boot(options: BootOptions = DefaultBootOptions) {
    let spinner
    const t = this.i18n.i18next.getFixedT(this.i18n.language, 'kernel')

    // @ts-expect-error
    globalThis.process.exit = () => {}
    globalThis.process.cwd = () => this.shell.cwd
    globalThis.process.chdir = (dir: string) => {
      this.shell.cwd = dir
      localStorage.setItem(`cwd:${this.shell.credentials.uid}`, dir)
    }

    try {
      this.dom.topbar()
      this.terminal.unlisten()

      // TODO: Customize and synchronize with vite.config.ts to allow slimmer builds
      const polyfills = {
        assert: await import('node:assert'),
        child_process: await import('node:child_process'),
        cluster: await import('node:cluster'),
        console: await import('node:console'),
        constants: await import('node:constants'),
        crypto: await import('node:crypto'),
        events: await import('node:events'),
        fs: this.filesystem.fsSync,
        'fs/promises': this.filesystem.fs,
        http: await import('node:http'),
        http2: await import('node:http2'),
        https: await import('node:https'),
        os: await import('node:os'),
        path: await import('node:path'),
        punycode: await import('node:punycode'),
        querystring: await import('node:querystring'),
        stream: await import('node:stream'),
        string_decoder: await import('node:string_decoder'),
        timers: await import('node:timers'),
        timers_promises: await import('node:timers/promises'),
        tty: await import('node:tty'),
        url: await import('node:url'),
        util: await import('node:util'),
        vm: await import('node:vm'),
        zlib: await import('node:zlib')
      }

      polyfills.tty.isatty = () => true
      globalThis.module = { exports: {} } as NodeModule

      // @ts-expect-error
      globalThis.requiremap = new Map()
      // @ts-expect-error
      globalThis.require = (id: string) => {
        // TODO: One day, I'm sure a more professional solution will be found
        // A lot of this complexity is necessary only because of this unfortunate combination of issues:
        // 1. Using IndexedDB gets unusably slow with lots of files unless disableAsyncCache is true
        // 2. When disabling sync caching, we lose all synchronous fs methods
        // 3. Require has to be synchronous
        if (id.startsWith('node:')) return polyfills[id.replace('node:', '') as keyof typeof polyfills]

        const caller = (new Error()).stack?.split("\n")[2]?.trim().split(" ")[1]
        const url = caller?.replace(/:\d+:\d+$/, '')
        if (!id.startsWith('blob:') && url === 'eval' && polyfills[id.includes(':') ? id.split(':')[1] as keyof typeof polyfills : id as keyof typeof polyfills]) {
          return polyfills[id.includes(':') ? id.split(':')[1] as keyof typeof polyfills : id as keyof typeof polyfills]
        }

        if (url && (globalThis.requiremap.has(url) || url === 'eval')) {
          const { code } = globalThis.requiremap.get(id)
          const cleanCode = code.startsWith('#!') ? code.split('\n').slice(1).join('\n') : code
          let finalCode = cleanCode

          // const defaultExport = code.match(/module.exports = (.*)/)?.[1]
          // if (defaultExport) finalCode = finalCode.replace(/module.exports = (.*)/, 'globalThis.module.exports.default = $1')
          // finalCode = finalCode.replace(/module.exports = (.*)/, 'globalThis.module.exports.default = $1')

          const func = new Function(finalCode)
          console.log({ func })
          const result = func.call(globalThis)
          console.log(result, globalThis.module)
          return globalThis.module.exports
        }

        const mod = id.split(':').length > 1 ? id.split(':')[1] : id
        return polyfills[mod as keyof typeof polyfills]
      }

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
          this.terminal.writeln(colorFiglet(figletColor, logoFiglet))
        } catch (error) {
          this.log.error(`Failed to load figlet font ${figletFont}: ${(error as Error).message}`)
        }

        this.terminal.writeln(`${this.terminal.createSpecialLink(import.meta.env['HOMEPAGE'], import.meta.env['NAME'] || 'ecmaOS')} v${import.meta.env['VERSION']}`)
        this.terminal.writeln(`${t('kernel.madeBy', 'Made with ❤️  by Jay Mathis')} ${this.terminal.createSpecialLink(
          import.meta.env['AUTHOR']?.url || 'https://github.com/mathiscode',
          `${import.meta.env['AUTHOR']?.name} <${import.meta.env['AUTHOR']?.email}>`
        )}`)

        this.terminal.writeln(import.meta.env['REPOSITORY'] + '\n')
        this.terminal.writeln(chalk.red.bold(`🐉  ${t('kernel.experimental', 'EXPERIMENTAL')} 🐉`))

        if (import.meta.env['KNOWN_ISSUES']) {
          this.terminal.writeln(chalk.yellow.bold(t('kernel.knownIssues', 'Known Issues')))
          this.terminal.writeln(chalk.yellow(import.meta.env['KNOWN_ISSUES'].map((issue: string) => `- ${issue}`).join('\n')) + '\n')
        }

        if (import.meta.env['TIPS']) {
          this.terminal.writeln(chalk.green.bold(t('kernel.tips', 'Tips')))
          this.terminal.writeln(chalk.green(import.meta.env['TIPS'].map((tip: string) => `- ${tip}`).join('\n')) + '\n')
        }

        spinner = this.terminal.spinner('arrow3', chalk.yellow(this.i18n.t('Booting')))
        spinner.start()

        if (logoFiglet) console.log(`%c${logoFiglet}`, 'color: green')
        console.log(`%c${import.meta.env['REPOSITORY'] || 'https://github.com/ecmaos/ecmaos'}`, 'color: blue; text-decoration: underline; font-size: 16px')
        this.log.info(`${import.meta.env['NAME'] || 'ecmaOS'} v${import.meta.env['VERSION']}`)

        if (Notification?.permission === 'default') Notification.requestPermission()
        if (Notification?.permission === 'denied') this.log.warn(t('kernel.permissionNotificationDenied', 'Notification permission denied'))

        this.intervals.set('title-blink', () => {
          globalThis.document.title = globalThis.document.title.includes('_') ? 'ecmaos# ' : 'ecmaos# _'
        }, 600)

        this.toast.success(`${import.meta.env['NAME']} v${import.meta.env['VERSION']}`)
      }

      await this.configure({ filesystem: Filesystem.options() })

      // We don't strictly conform to the FHS, but we try to follow it as closely as possible where relevant
      // User packages can use them as they see fit, and we'll find more uses for them as we go along
      const requiredPaths = [
        '/bin', '/sbin', '/boot', '/proc', '/tmp', '/home', '/lib', '/run', '/root', '/opt', '/sys',
        '/etc', '/etc/opt',
        '/var', '/var/cache', '/var/lib', '/var/log', '/var/spool', '/var/tmp', '/var/lock', '/var/opt', '/var/games',
        '/usr', '/usr/bin', '/usr/lib', '/usr/sbin', '/usr/share', '/usr/include', '/usr/local'
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

      this.intervals.set('/proc', this.registerProc.bind(this), import.meta.env['VITE_KERNEL_INTERVALS_PROC'] ?? 1000)

      // Load kernel modules
      const modules = import.meta.env['VITE_KERNEL_MODULES']
      if (modules) {
        const mods = modules.split(',')
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
      try {
        if (!await this.filesystem.fs.exists('/etc/passwd')) await this.users.add({ username: 'root', password: 'root', home: '/root' }, { noHome: true })
        else await this.users.load()
      } catch (err) {
        this.log.error(err)
        this.terminal.writeln(chalk.red((err as Error).message))
        throw err
      }

      spinner?.stop()

      // Show login prompt or auto-login
      if (this.options.credentials) {
        const { cred } = await this.users.login(this.options.credentials.username, this.options.credentials.password)
        this.shell.credentials = cred
        useCredentials(cred)
      } else {
        if (import.meta.env['VITE_APP_SHOW_DEFAULT_LOGIN'] === 'true') this.terminal.writeln(chalk.yellow.bold('Default Login: root / root\n'))

        this.terminal.writeln(`${Intl.DateTimeFormat(this.memory.config.get('locale') as string || 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(new Date())}`)

        const issue = await this.filesystem.fs.exists('/etc/issue')
          ? await this.filesystem.fs.readFile('/etc/issue', 'utf-8')
          : null

        if (issue) this.terminal.writeln(issue)

        while (true) {
          try {
            const username = await this.terminal.readline(`👤  ${this.i18n.t('Username')}: `)
            const password = await this.terminal.readline(`🔒  ${this.i18n.t('Password')}: `, true)
            const { cred } = await this.users.login(username, password)
            this.shell.credentials = cred
            useCredentials(cred)
            break
          } catch (err) {
            console.error(err)
            this.terminal.writeln(chalk.red((err as Error).message) + '\n')
          }
        }
      }

      const motd = await this.filesystem.fs.exists('/etc/motd')
        ? await this.filesystem.fs.readFile('/etc/motd', 'utf-8')
        : null

      if (motd) this.terminal.writeln('\n' + motd)

      const user = this.users.get(this.shell.credentials.uid ?? 0)
      if (!user) throw new Error(t('kernel.userNotFound', 'User not found'))

      this.shell.cwd = localStorage.getItem(`cwd:${this.shell.credentials.uid}`) ?? (
        user.uid === 0 ? '/' : (user.home || '/')
      )

      // TODO: Customizable prompt templates loaded from fs
      if (user.uid !== 0) this.terminal.promptTemplate = `{user}:{cwd}$ `

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

      // Init doesn't exit; tradition - init should become a more full-featured init system in the future
      class InitProcess extends Process { override async exit() {} }
      if (!await this.filesystem.fs.exists('/boot/init')) await this.filesystem.fs.writeFile('/boot/init', '#!ecmaos:bin:script:init\n\n')

      const initProcess = new InitProcess({
        args: [],
        command: 'init',
        uid: user.uid,
        gid: user.gid,
        kernel: this,
        shell: this.shell,
        terminal: this.terminal,
        entry: async () => await this.sudo(async () => await this.execute({ command: '/boot/init', shell: this.shell }))
      })

      initProcess.start()
      this._state = KernelState.RUNNING

      // Install recommended apps if desired by user on first boot
      if (!this.storage.local.getItem('ecmaos:first-boot')) {
        const recommendedApps = import.meta.env['VITE_RECOMMENDED_APPS']
        if (recommendedApps) {
          const apps = recommendedApps.split(',')
          this.terminal.writeln('\n' + chalk.yellow.bold(this.i18n.t('kernel.recommendedApps', 'Recommended apps:')))
          this.terminal.writeln(chalk.green(apps.map((app: string) => `- ${app}`).join('\n')))
          this.terminal.write(chalk.green.bold(this.i18n.t('kernel.installRecommendedApps', 'Do you want to install the recommended apps? (Y/n)')))

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
      this.log.error(error)
      this._state = KernelState.PANIC
      this.events.dispatch<KernelPanicEvent>(KernelEvents.PANIC, { error: error as Error })
      this.toast.error({
        message: t('kernel.panic', 'Uh oh, kernel panic! Check the logs for more details.'),
        duration: 0,
        dismissible: false
      })
    } finally {
      this.dom.topbar()
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
  async execute(options: KernelExecuteOptions) {
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

      const header = await this.readFileHeader(options.command)
      if (!header) return -1

      let exitCode: number | void = -1
      switch (header.type) {
        case 'bin':
          switch (header.namespace) {
            case 'terminal': // left for backward-compatibility
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
              exitCode = await this.executeNode(options) // TODO: Use WebContainer if possible
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
          entry: async (params) => await main(params)
        })

        await process.start()
        exitCode = 0
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
    const command = this.terminal.commands[options.command as keyof typeof this.terminal.commands]
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
      stdout: options.stdout,
      stderr: options.stderr
    })

    await process.start()
    return 0
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

      const debugContents = contents.split('\n').map((line, i) => i === 1 ? `debugger\n${line}` : line).join('\n')
      const finalContents = debugContents
      // const finalContents = contents

      const code = await this.replaceImports(finalContents, filePath)
      const blob = new Blob([code], { type: 'text/javascript' })
      url = URL.createObjectURL(blob)

      globalThis.requiremap.set(url, {
        command: options.command,
        code,
        filePath,
        binLink,
        argv: [...globalThis.process.argv],
        argv0: globalThis.process.argv0
      })

      await import(/* @vite-ignore */ url)
      exitCode = 0
    } catch (error) {
      this.log.error(`Failed to execute node script: ${error}`)
      this.terminal.writeln(chalk.red((error as Error).message))
      exitCode = -1
    } finally {
      globalThis.requiremap.delete(url)
    }

    return exitCode
  }

  /**
   * Executes a script file
   * @param options - Execution options containing script path and shell
   * @returns Exit code of the script
   */
  async executeScript(options: KernelExecuteOptions): Promise<number> {
    const header = await this.readFileHeader(options.command)
    if (!header) return -1

    if (header.type !== 'bin' || header.namespace !== 'script') {
      this.log.error(`File is not a script: ${options.command}`)
      return -1
    }

    const script = await this.filesystem.fs.readFile(options.command, 'utf-8')
    if (script) {
      for (const line of script.split('\n')) {
        if (line.startsWith('#') || line.trim() === '') continue
        await options.shell.execute(line)
      }

      return 0
    } else this.log.error(`Script ${options.command} not found`)

    return -1
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
   * @returns {Promise<FileHeader|null>} Parsed header information or null if invalid
   */
  async readFileHeader(filePath: string): Promise<FileHeader | null> {
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

    return new Promise((resolve, reject) => {
      (async () => {
        try {
          if (!await this.filesystem.fs.exists(filePath)) return resolve(null)
          const readable = this.filesystem.fsSync.createReadStream(filePath)
          readable.on('data', (chunk: Buffer) => resolve(parseHeader(chunk.toString().split('\n')[0] || '')))
          readable.on('error', (error: Error) => reject(error))
          readable.on('close', () => resolve(null))
        } catch (error) {
          this.log.error(error)
          reject(error)
        }
      })()
    })
  }

  /**
   * Reboots the kernel by performing a shutdown and page reload
   */
  async reboot() {
    this.log.warn(this.i18n.t('Rebooting'))
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
    for (const device of Object.values(DefaultDevices)) {
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
        this.log.warn('Failed to get connection data')
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
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g
    const requires = contents.matchAll(requireRegex) || []
    for (const match of requires) {
      const id = match[1]
      if (!id || !id.startsWith('.')) continue

      const resolvedPath = path.resolve(packagePath, id)
      const depContents = await this.filesystem.fs.readFile(resolvedPath, 'utf-8')
      const finalContents = await this.replaceImports(depContents, path.dirname(resolvedPath))

      let depUrl = id

      for (const [key, value] of Object.entries(globalThis.requiremap.entries())) {
        if ((value as { filePath: string }).filePath === resolvedPath) {
          depUrl = key
          break
        }
      }

      // // if (!globalThis.requiremap.has(resolvedPath)) {
      const blob = new Blob([finalContents], { type: 'text/javascript' })
      depUrl = URL.createObjectURL(blob)
      globalThis.requiremap.set(depUrl, {
        code: finalContents,
        command: 'ecmaos:require',
        filePath: resolvedPath,
        binLink: null,
        argv: [...globalThis.process.argv],
        argv0: globalThis.process.argv0
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
   * Executes an operation with root (or other) privileges
   * @param {() => Promise<T>} operation - Operation to execute
   * @param {Partial<Credentials>} cred - Optional credentials to use
   * @returns {Promise<T>} Result of the operation
   */
  private async sudo<T>(
    operation: () => Promise<T>,
    cred: CredentialInit = { uid: 0, gid: 0 }
  ): Promise<T | undefined> {
    const currentCredentials = { ...credentials }
    let result: T | undefined

    try {
      useCredentials(cred)
      result = await operation()
    } catch (error) {
      this.log.error(error)
    } finally {
      useCredentials(currentCredentials)
    }

    return result
  }
}
