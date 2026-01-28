/**
  * @experimental
  * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
  * 
  * The Terminal class extends xterm.js to support ecmaOS-specific functionality.
  * 
 */

import ansi from 'ansi-escape-sequences'
import chalk from 'chalk'
import path from 'path'
import spinners from 'cli-spinners'

// import * as textCanvas from '@thi.ng/text-canvas'
// import * as textFormat from '@thi.ng/text-format'
import * as emoji from '@thi.ng/emoji'
import { IDisposable, ITerminalAddon, Terminal as XTerm } from '@xterm/xterm'
import { AttachAddon } from '@xterm/addon-attach'
import { FitAddon } from '@xterm/addon-fit'
import { ImageAddon } from '@xterm/addon-image'
import { ProgressAddon } from '@xterm/addon-progress'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'

import '@xterm/xterm/css/xterm.css'
import { TerminalCommand, TerminalCommands } from '#lib/commands/index.js' // TODO: new approach

import { Events } from '#events.ts'

import { TerminalEvents } from '@ecmaos/types'

import type {
  Kernel,
  Shell,
  Terminal as ITerminal,
  TerminalOptions,
  TerminalResizeEvent,
  TerminalMessageEvent,
  TerminalAttachEvent,
  TerminalCreatedEvent,
  TerminalMountEvent,
  TerminalListenEvent,
  TerminalUnlistenEvent,
  TerminalKeyEvent,
  TerminalInputEvent,
  TerminalInterruptEvent,
  TerminalExecuteEvent,
  TerminalWriteEvent,
  TerminalWritelnEvent,
  TerminalPasteEvent
} from '@ecmaos/types'

export enum CommandPath {
  KERNEL = 'kernel'
}

export const DefaultTerminalOptions: TerminalOptions = {
  fontFamily: 'FiraCode Nerd Font Mono, Ubuntu Mono, courier-new, courier, monospace',
  fontSize: 16,
  smoothScrollDuration: 100,
  convertEol: true,
  cursorBlink: true,
  macOptionIsMeta: true,
  allowProposedApi: true,
  theme: {
    background: '#000000',
    foreground: '#00FF00',
    promptColor: 'green'
  },
  linkHandler: {
    allowNonHttpProtocols: true,

    activate: (event, text, range) => {
      console.log('activate', event, text, range)
      if (text.startsWith('http')) window.open(text, '_blank', 'noopener,noreferrer')
      if (text.startsWith('ecmaos://')) {
        const [protocol, argstr] = text.replace('ecmaos://', '').split('?')
        if (!protocol || !argstr) return
        const commandPath = protocol.split('.')

        const args: Record<string, string> = {}
        for (const arg of argstr.split('&')) {
          const [key, value] = arg.split('=')
          if (!key || !value) continue
          args[key] = value
        }

        switch (commandPath[0]) {
          case CommandPath.KERNEL: // TODO: Limit the power of links and/or require user confirmation
            switch (commandPath[1]) {
              case 'execute':
                if (!args['command']) break
                globalThis?.kernel?.execute({ command: args['command'], args: args['args']?.split(' ') || [], shell: globalThis?.kernel?.shell })
                break
            }; break
        }
      }
    },

    // hover: (event, text, range) => {
      // console.log('hover', event, text, range)
    // },

    // leave: (event, text, range) => {
      // console.log('leave', event, text, range)
    // }
  }
}

/**
  * @experimental
  * @author Jay Mathis <code@mathis.network> (https://github.com/mathiscode)
  * 
  * The Terminal class extends xterm.js to support ecmaOS-specific functionality.
  * 
 */
export class Terminal extends XTerm implements ITerminal {
  private _addons: TerminalOptions['addons'] = new Map()
  private _ansi: typeof ansi = ansi
  private _cmd: string = ''
  private _commands: { [key: string]: TerminalCommand }
  private _cursorPosition: number = 0
  private _events: Events
  private _history: Record<number, string[]> = {}
  private _historyPosition: number = 0
  private _id: string = crypto.randomUUID()
  private _kernel: Kernel
  private _keyListener: IDisposable | undefined
  private _promptTemplate: string = '{user}:{cwd}# '
  private _shell: Shell
  private _socket?: WebSocket
  private _socketKey?: JsonWebKey
  private _stdin: ReadableStream<Uint8Array>
  private _stdout: WritableStream<Uint8Array>
  private _stderr: WritableStream<Uint8Array>
  private _stdinSubscribers: Set<(data: Uint8Array) => void> = new Set()
  private _multiLineMode: boolean = false
  private _multiLineBuffer: string = ''
  private _tabCompletionIndex: number = 0
  private _lastTabCommand: string = ''
  private _isTabCycling: boolean = false
  private _isMobile: boolean = false
  private _visualViewportSupported: boolean = false
  private _viewportListeners: Array<() => void> = []
  private _passwordInputElement: HTMLInputElement | null = null
  private _isResizing: boolean = false
  private _lastViewportHeight: number = 0
  private _resizeTimeout: ReturnType<typeof setTimeout> | null = null
  private _mobileInputElement: HTMLInputElement | null = null
  private _mobileInputListener: IDisposable | null = null
  private _tty: number
  private _ttySwitchHandler: ((event: KeyboardEvent) => void) | null = null

  get addons() { return this._addons as Map<string, ITerminalAddon> }
  get ansi() { return this._ansi }
  get commands() { return this._commands }
  get cmd() { return this._cmd }
  get cwd() { return this._shell.cwd }
  get emojis() { return emoji }
  get events() { return this._events }
  get id() { return this._id }
  get socket() { return this._socket }
  get socketKey() { return this._socketKey }
  get stdin() { return this._stdin }
  get stdout() { return this._stdout }
  get stderr() { return this._stderr }
  get tty() { return this._tty }

  get promptTemplate() { return this._promptTemplate }
  set promptTemplate(value: string) { this._promptTemplate = value }

  constructor(options: TerminalOptions & { tty?: number } = DefaultTerminalOptions) {
    if (!options.kernel) {
      const message = globalThis.kernel?.i18n?.ns.terminal('requiresKernel') || 'Terminal requires a kernel'
      throw new Error(message)
    }
    super({ ...DefaultTerminalOptions, ...options })
    this._tty = options.tty ?? 0
    globalThis.terminals?.set(this.id, this)

    // Create the primary stdin stream (terminal's own stdin)
    this._stdin = this.createSubscribedInputStream().stream

    // Create stdout stream that writes to the terminal
    this._stdout = new WritableStream({
      write: (chunk) => {
        const text = new TextDecoder().decode(chunk)
        this.write(text)
      }
    })

    // Create stderr stream that writes to the terminal in red
    this._stderr = new WritableStream({
      write: (chunk) => {
        const text = new TextDecoder().decode(chunk)
        this.write(chalk.red(text))
      }
    })

    // Connect keyboard input to all subscribers
    this.onKey(({ key }) => {
      if (key && key.length > 0) {
        const data = new TextEncoder().encode(key)
        for (const callback of this._stdinSubscribers) {
          try {
            callback(data)
          } catch {
            // Subscriber may be closed, will be cleaned up
          }
        }
      }
    })

    // Handle bell character
    this.onBell(() => {
      const theme = { ...this.options.theme }
      theme.background = '#FFFFFF'
      this.options.theme = theme

      setTimeout(() => {
        const theme = { ...this.options.theme }
        theme.background = '#000000'
        this.options.theme = theme
      }, 100)
    })

    this._events = new Events()

    this._addons = options.addons || new Map([
      ['fit', new FitAddon()],
      ['image', new ImageAddon()],
      ['progress', new ProgressAddon()],
      ['search', new SearchAddon()],
      ['serialize', new SerializeAddon()],
      ['web-links', new WebLinksAddon()]
    ])

    for (const addon of this._addons.values()) this.loadAddon(addon)
    if (this.addons?.get('fit')) (this.addons.get('fit') as FitAddon).fit()
    if (this.addons?.get('progress')) {
      const defaultBarColors = {
        0: "rgba(26,  188, 156, .9)",
        ".25": "rgba(52,  152, 219, .9)",
        ".50": "rgba(241, 196, 15,  .9)",
        ".75": "rgba(230, 126, 34,  .9)",
        "1.0": "rgba(211, 84,  0,   .9)"
      }

      const errorBarColors = {
        0: "rgba(220, 20, 60, .9)",
        ".25": "rgba(200, 0, 0, .9)",
        ".50": "rgba(178, 34, 34, .8)",
        ".75": "rgba(139, 0, 0, .8)",
        "1.0": "rgba(255, 0, 0, .7)"
      }

      const pauseBarColors = {
        0: "rgba(127, 140, 141, .9)",
        ".25": "rgba(189, 195, 199, .9)",
        ".50": "rgba(241, 196, 15,  .7)",
        ".75": "rgba(230, 126, 34, .7)",
        "1.0": "rgba(231, 76, 60,  .7)"
      }

      ;(this.addons.get('progress') as ProgressAddon).onChange(({ state, value }) => {
        console.log('progress', state, value)
        switch (state) {
          case 0: // Remove
            this._kernel.dom.topbar(false)
            this._kernel.dom.topbarProgress(0)
            break
          case 1: // Set
            this._kernel.dom.topbarConfig({
              autoRun: false,
              barColors: defaultBarColors
            })
            this._kernel.dom.topbar(true)
            this._kernel.dom.topbarProgress(value / 100)
            break
          case 2: // Error
            this._kernel.dom.topbar(true)
            this._kernel.dom.topbarProgress(value / 100)
            this._kernel.dom.topbarConfig({
              autoRun: false,
              barColors: errorBarColors
            })
            break
          case 3: // Indeterminate
            this._kernel.dom.topbarConfig({ autoRun: false, barColors: defaultBarColors })
            this._kernel.dom.topbarProgress(1)
            this._kernel.dom.topbar(true)
            break
          case 4: // Pause
            this._kernel.dom.topbarConfig({
              autoRun: false,
              barColors: pauseBarColors
            })
            this._kernel.dom.topbar(true)
            break
        }
      })
    }

    globalThis.addEventListener('resize', () => {
      if (this.addons?.get('fit')) (this.addons.get('fit') as FitAddon).fit()
      this.events.dispatch<TerminalResizeEvent>(TerminalEvents.RESIZE, { cols: this.cols, rows: this.rows })
    })

    if (options.socket) {
      this._socket = options.socket

      this._socket.addEventListener('message', (event) => {
        this.writeln(this._kernel.i18n.ns.terminal('socketConnected', { url: this._socket!.url }))
        this._kernel.events.dispatch<TerminalMessageEvent>(TerminalEvents.MESSAGE, { terminal: this, message: event })

        if (event.data.startsWith('@ecmaos/metal')) {
          const [name, version, id, encodedPublicKey] = event.data.split(':')
          this._kernel.log.info(`${name}:${version}:${id} connected`)
          this._socketKey = JSON.parse(atob(encodedPublicKey))
        }
      })

      const attachSocket = async () => {
        await new Promise<void>(resolve => {
          const checkState = () => {
            if (options.kernel?.state === 'running') resolve()
            else setTimeout(checkState, 100)
          }

          checkState()
        })

        if (this._socket) {
          try {
            await new Promise<void>((resolve, reject) => {
              if (this._socket!.readyState === WebSocket.OPEN) resolve()
              else {
                const onOpen = () => {
                  this._socket!.removeEventListener('open', onOpen)
                  resolve()
                }
                const onError = () => {
                  this._socket!.removeEventListener('error', onError)
                  reject(new Error(this._kernel.i18n.ns.terminal('socketFailedToOpen')))
                }

                this._socket!.addEventListener('open', onOpen)
                this._socket!.addEventListener('error', onError)
              }
            })

            const attachAddon = new AttachAddon(this._socket)
            this.loadAddon(attachAddon)
            this._kernel.events.dispatch<TerminalAttachEvent>(TerminalEvents.ATTACH, { terminal: this, socket: this._socket })
          } catch (err) {
            console.error(err)
            // TODO: AttachErrorEvent
          }
        }
      }

      attachSocket()
    }

    this.onKey(this.shortcutKeyHandler.bind(this))

    this._keyListener = this.onKey(this.keyHandler.bind(this))
    this._shell = options.shell || options.kernel.shell
    this._kernel = options.kernel
    this._commands = TerminalCommands(this._kernel, this._shell, this)
    this._history[this._shell.credentials.uid] = this._kernel.storage.local.getItem(`history:${this._shell.credentials.uid}`) ? JSON.parse(this._kernel.storage.local.getItem(`history:${this._shell.credentials.uid}`) || '[]') : []
    this._historyPosition = this._history[this._shell.credentials.uid]?.length || 0

    this._detectMobileSupport()

    this.events.dispatch<TerminalCreatedEvent>(TerminalEvents.CREATED, { terminal: this })
    this.element?.setAttribute('enterkeyhint', 'search')
  }

  mount(element: HTMLElement) {
    this.open(element)
    if (this.addons?.get('fit')) (this.addons.get('fit') as FitAddon).fit()
    
    const textarea = element.querySelector('textarea')
    if (textarea) {
      textarea.addEventListener('paste', (e: ClipboardEvent) => this.paste(e.clipboardData?.getData('text/plain') || ''))
      
      if (this._isMobile) {
        textarea.setAttribute('inputmode', 'text')
        textarea.setAttribute('autocapitalize', 'off')
        textarea.setAttribute('autocorrect', 'off')
        textarea.setAttribute('spellcheck', 'false')
        
        textarea.addEventListener('focus', () => {
          setTimeout(() => this._resizeTerminalToViewport(), 50)
          setTimeout(() => this._resizeTerminalToViewport(), 200)
          setTimeout(() => this._resizeTerminalToViewport(), 500)
        })
        
        textarea.addEventListener('input', () => {
          setTimeout(() => this._scrollTerminalToBottom(), 0)
        })
      }
    }
    
    this._setupKeyboardHandling()
    
    if (this._isMobile) {
      setTimeout(() => this._resizeTerminalToViewport(), 100)
    }
    
    this.events.dispatch<TerminalMountEvent>(TerminalEvents.MOUNT, { terminal: this, element })
  }

  attachShell(shell: Shell) {
    this._shell = shell
    this._commands = TerminalCommands(this._kernel, this._shell, this)
  }

  hide() {
    if (this.element) this.element.style.display = 'none'
  }

  show() {
    if (this.element) this.element.style.display = 'block'
  }

  dispose() {
    this._cleanupViewportListeners()
    if (this._resizeTimeout) {
      clearTimeout(this._resizeTimeout)
      this._resizeTimeout = null
    }
    if (this._passwordInputElement) {
      this._passwordInputElement.remove()
      this._passwordInputElement = null
    }
    super.dispose()
  }

  private _cleanupViewportListeners() {
    for (const cleanup of this._viewportListeners) {
      try {
        cleanup()
      } catch (error) {
        console.warn('Error cleaning up viewport listener:', error)
      }
    }
    this._viewportListeners = []
  }

  createSpecialLink(uri: string, text: string) {
    return `\x1b]8;;${uri}\x1b\\${text}\x1b]8;;\x1b\\`
  }

  progress(state: string | number, value: number) {
    this.write(`\x1b]9;4;${state};${value}\x07`)
  }

  connect(socket: WebSocket) {
    this.loadAddon(new AttachAddon(socket))
  }

  listen() {
    this.unlisten()
    
    if (this._isMobile) {
      this._setupMobileInput()
    } else {
      if (this.element) {
        this._ttySwitchHandler = async (event: KeyboardEvent) => {
          if (event.ctrlKey && event.shiftKey) {
            const codeMatch = event.code.match(/^Digit([0-9])$/)
            if (codeMatch && codeMatch[1]) {
              event.preventDefault()
              event.stopPropagation()
              event.stopImmediatePropagation()
              const ttyNumber = parseInt(codeMatch[1])
              if (this._kernel.switchTty) {
                try {
                  await this._kernel.switchTty(ttyNumber)
                } catch (err) {
                  console.error('Failed to switch TTY:', err)
                }
              }
            }
          }
        }
        
        this.element.addEventListener('keydown', this._ttySwitchHandler, true)
      }
      
      this._keyListener = this.onKey(this.keyHandler.bind(this))
    }
    
    this.events.dispatch<TerminalListenEvent>(TerminalEvents.LISTEN, { terminal: this })
  }
  
  private _setupMobileInput() {
    if (this._mobileInputElement) {
      this._mobileInputElement.remove()
    }
    
    const mobileInput = document.createElement('input')
    mobileInput.type = 'text'
    mobileInput.style.position = 'fixed'
    mobileInput.style.top = '0'
    mobileInput.style.left = '0'
    mobileInput.style.width = '1px'
    mobileInput.style.height = '1px'
    mobileInput.style.opacity = '0'
    mobileInput.style.pointerEvents = 'auto'
    mobileInput.style.zIndex = '-1'
    mobileInput.setAttribute('inputmode', 'text')
    mobileInput.setAttribute('autocapitalize', 'off')
    mobileInput.setAttribute('autocorrect', 'off')
    mobileInput.setAttribute('spellcheck', 'false')
    mobileInput.setAttribute('enterkeyhint', 'search')
    
    document.body.appendChild(mobileInput)
    this._mobileInputElement = mobileInput
    
    let lastValue = ''
    
    const handleInput = () => {
      const currentValue = mobileInput.value
      const diff = currentValue.length - lastValue.length
      
      if (diff > 0) {
        const newChars = currentValue.slice(lastValue.length)
        for (const char of newChars) {
          const fakeEvent = new KeyboardEvent('keydown', {
            key: char,
            code: `Key${char.toUpperCase()}`,
            bubbles: true,
            cancelable: true
          })
          Object.defineProperty(fakeEvent, 'target', { value: mobileInput, enumerable: true })
          this.keyHandler({ key: char, domEvent: fakeEvent as KeyboardEvent })
        }
      } else if (diff < 0) {
        const backspaceEvent = new KeyboardEvent('keydown', {
          key: 'Backspace',
          code: 'Backspace',
          bubbles: true,
          cancelable: true
        })
        Object.defineProperty(backspaceEvent, 'target', { value: mobileInput, enumerable: true })
        this.keyHandler({ key: '\b', domEvent: backspaceEvent as KeyboardEvent })
      }
      
      lastValue = currentValue
    }
    
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.target !== mobileInput) return
      
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        
        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        })
        Object.defineProperty(enterEvent, 'target', { value: mobileInput, enumerable: true })
        
        await this.keyHandler({ key: '\r', domEvent: enterEvent as KeyboardEvent })
        
        setTimeout(() => {
          mobileInput.value = ''
          lastValue = ''
        }, 50)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        e.stopPropagation()
        
        const fakeEvent = new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true
        })
        Object.defineProperty(fakeEvent, 'target', { value: mobileInput, enumerable: true })
        
        await this.keyHandler({ key: e.key, domEvent: fakeEvent as KeyboardEvent })
        
        setTimeout(() => {
          mobileInput.value = this._cmd
          lastValue = this._cmd
          const cursorPos = this._cursorPosition
          if (mobileInput.setSelectionRange) {
            mobileInput.setSelectionRange(cursorPos, cursorPos)
          }
        }, 0)
      } else if (e.ctrlKey && (e.key === 'c' || e.key === 'l' || e.key === 'v')) {
        e.preventDefault()
        e.stopPropagation()
        
        const fakeEvent = new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true
        })
        Object.defineProperty(fakeEvent, 'target', { value: mobileInput, enumerable: true })
        
        await this.keyHandler({ key: e.key, domEvent: fakeEvent as KeyboardEvent })
      }
    }
    
    mobileInput.addEventListener('input', handleInput)
    mobileInput.addEventListener('keydown', handleKeyDown)
    
    mobileInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (mobileInput && document.body.contains(mobileInput) && this._keyListener !== undefined) {
          mobileInput.focus()
        }
      }, 100)
    })
    
    setTimeout(() => {
      mobileInput.focus()
    }, 100)
    
    this._mobileInputListener = {
      dispose: () => {
        mobileInput.removeEventListener('input', handleInput)
        mobileInput.removeEventListener('keydown', handleKeyDown)
        if (mobileInput && document.body.contains(mobileInput)) {
          mobileInput.remove()
        }
        this._mobileInputElement = null
      }
    }
  }

  unlisten() {
    try { this._keyListener?.dispose() } catch {}
    try { this._mobileInputListener?.dispose() } catch {}
    // Remove TTY switch handler
    if (this.element && this._ttySwitchHandler) {
      this.element.removeEventListener('keydown', this._ttySwitchHandler, true)
      this._ttySwitchHandler = null
    }
    this._keyListener = undefined
    this._mobileInputListener = null
    this.events.dispatch<TerminalUnlistenEvent>(TerminalEvents.UNLISTEN, { terminal: this })
  }

  // TODO: Make configurable; expand and organize keyboard shortcut functionality
  async shortcutKeyHandler({ domEvent }: { domEvent: KeyboardEvent }) {
    this.events.dispatch<TerminalKeyEvent>(TerminalEvents.KEY, { key: domEvent.key, domEvent })

    if (!domEvent.ctrlKey && !domEvent.shiftKey) {
      switch (domEvent.key) {
        case 'F11': document.documentElement.requestFullscreen(); break
      }
    }

    if (domEvent.ctrlKey && domEvent.shiftKey) {
      switch (domEvent.key) {
        case 'F1': this.listen(); break
        case 'F2': this.unlisten(); break
        case 'Delete': this._kernel.reboot(); break
      }
    }
  }

  async readline(prompt: string = '', hide: boolean = false, noListen: boolean = false) {
    if (hide && this._isMobile) {
      return this._readlineWithPasswordInput(prompt, noListen)
    }

    if (this._isMobile) {
      return this._readlineWithMobileInput(prompt, noListen)
    }

    let input = ''
    let cursor = 0
    const wasListening = this._keyListener !== undefined
    this.unlisten()
    this.write(prompt)
    this.focus()
    if (this._isMobile) {
      setTimeout(() => this._scrollTerminalToBottom(), 100)
      setTimeout(() => this._scrollTerminalToBottom(), 300)
    }

    const result = await new Promise<string>((resolve) => {
      const disposable = this.onKey(({ domEvent }) => {
        if (domEvent.target && this._passwordInputElement && domEvent.target === this._passwordInputElement) {
          return
        }
        
        domEvent.preventDefault()
        domEvent.stopPropagation()
        
        switch(domEvent.key) {
          case 'Enter': {
            const finalInput = input
            disposable.dispose()
            this.write('\n')
            resolve(finalInput)
            break
          }
          case 'ArrowLeft': 
            if (cursor > 0) {
              this.write(ansi.cursor.back())
              cursor--
            }
            break
          case 'ArrowRight': 
            if (cursor < input.length) {
              this.write(ansi.cursor.forward())
              cursor++
            }
            break
          case 'Home': 
            this.write(ansi.cursor.horizontalAbsolute(prompt.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length + 1))
            cursor = 0
            break
          case 'End': 
            this.write(ansi.cursor.horizontalAbsolute(prompt.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length + input.length + 1))
            cursor = input.length
            break
          case 'Escape': 
            disposable.dispose()
            resolve('')
            break
          case 'Backspace':
            if (cursor > 0) {
              cursor--
              input = input.slice(0, cursor) + input.slice(cursor + 1)
              this.write(ansi.cursor.back() + ansi.erase.inLine(0) + input.slice(cursor))
              if (input.length - cursor > 0) {
                this.write(`\x1b[${input.length - cursor}D`)
              }
            } else this.write('\x07')
            break
          case 'Delete':
            if (cursor < input.length) {
              input = input.slice(0, cursor) + input.slice(cursor + 1)
              this.write(ansi.erase.inLine(0) + input.slice(cursor))
              if (input.length - cursor > 0) {
                this.write(`\x1b[${input.length - cursor}D`)
              }
            }
            break
          default:
            if (domEvent.key.length === 1 && !domEvent.ctrlKey && !domEvent.metaKey && !domEvent.altKey) {
              const charCode = domEvent.key.charCodeAt(0)
              if (charCode >= 32 && charCode <= 126) {
                input = input.slice(0, cursor) + domEvent.key + input.slice(cursor)
                if (!hide) {
                  if (cursor === input.length - 1) {
                    this.write(domEvent.key)
                  } else {
                    const promptLen = prompt.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length
                    this.write(ansi.cursor.horizontalAbsolute(promptLen + 1) + ansi.erase.inLine(0) + input)
                    if (cursor < input.length - 1) {
                      this.write(`\x1b[${input.length - cursor - 1}D`)
                    }
                  }
                }
                cursor++
              }
            }
        }

        if (cursor < 0) cursor = 0
        if (cursor > input.length) cursor = input.length
      })
    })

    if (wasListening && !noListen) this.listen()
    return result
  }

  spinner(spinner: keyof typeof spinners, prefix?: string, suffix?: string) {
    const { interval, frames } = spinners[spinner]
    if (!interval || !frames) throw new Error(this._kernel.i18n.ns.terminal('invalidSpinner'))

    return new Spinner(this, interval, frames, prefix, suffix)
  }

  /**
   * Parses a PS1-like prompt format string
   * Supports placeholders: \u (user), \h (hostname), \w (full cwd), \W (basename cwd), \$ ($ or #), \s (shell)
   * Supports colors: \C{colorname} (e.g., \C{green}, \C{cyan}, \C{red})
   * Supports reset: \C{reset} or \C{default}
   * Supports non-printing sequences: \[...\] for ANSI codes
   */
  private parsePromptFormat(format: string): string {
    const user = this._kernel.users.get(this._shell.credentials.euid ?? 0)
    const username = user?.username || 'root'
    const hostname = globalThis.location?.hostname || 'localhost'
    const shell = this._shell.env.get('SHELL') || 'ecmaos'
    const isRoot = (user?.uid ?? 0) === 0
    const promptChar = isRoot ? '#' : '$'
    
    // Get basename of cwd
    const cwdBasename = path.basename(this.cwd) || '/'
    const cwdFull = this.cwd

    let output = ''
    let i = 0

    // Color mapping
    const colorMap: Record<string, string> = {
      'black': '\x1b[30m',
      'red': '\x1b[31m',
      'green': '\x1b[32m',
      'yellow': '\x1b[33m',
      'blue': '\x1b[34m',
      'magenta': '\x1b[35m',
      'cyan': '\x1b[36m',
      'white': '\x1b[37m',
      'gray': '\x1b[90m',
      'grey': '\x1b[90m',
      'reset': '\x1b[0m',
      'default': '\x1b[0m',
      'bold': '\x1b[1m',
      'dim': '\x1b[2m',
      'italic': '\x1b[3m',
      'underline': '\x1b[4m',
    }

    // Process character by character
    while (i < format.length) {
      const char = format[i]
      const nextChar = format[i + 1]

      // Handle escape sequences
      if (char === '\\' && nextChar) {
        switch (nextChar) {
          case 'u': // username
            output += chalk.white(username)
            i += 2
            break
          case 'h': // hostname
            output += chalk.white(hostname)
            i += 2
            break
          case 'w': // full working directory
            output += chalk.cyan(cwdFull)
            i += 2
            break
          case 'W': // basename of working directory
            output += chalk.cyan(cwdBasename)
            i += 2
            break
          case '$': // prompt character ($ or #)
            output += promptChar
            i += 2
            break
          case 's': // shell name
            output += chalk.white(shell)
            i += 2
            break
          case 'n': // newline
            output += '\n'
            i += 2
            break
          case 'C': // Color: \C{colorname}
            if (format[i + 2] === '{') {
              const endBrace = format.indexOf('}', i + 3)
              if (endBrace !== -1) {
                const colorName = format.substring(i + 3, endBrace)
                const colorCode = colorMap[colorName.toLowerCase()] || ''
                output += colorCode
                i = endBrace + 1 // Skip to after the closing brace
                break
              }
            }
            // Fall through if invalid \C format
            output += char
            i++
            break
          case '[': // Start non-printing sequence
            output += '\\['
            i += 2
            break
          case ']': // End non-printing sequence
            output += '\\]'
            i += 2
            break
          default:
            // Unknown escape, output as-is
            output += char
            i++
            break
        }
      } else {
        output += char
        i++
      }
    }

    return output
  }

  /**
   * Gets the prompt string, loading from PROMPT environment variable if available
   */
  prompt(text?: string): string {
    // Try to get PROMPT from environment
    const envPrompt = this._shell.env.get('PROMPT')
    const hasEnvPrompt = envPrompt && envPrompt.trim().length > 0
    
    // Use provided text, env PROMPT, or fall back to template
    const promptFormat = text || (hasEnvPrompt ? envPrompt : this._promptTemplate)

    // If using old format with {placeholders}, convert to new format
    if (promptFormat.includes('{') && !hasEnvPrompt && !text) {
      const user = this._kernel.users.get(this._shell.credentials.euid ?? 0)
      // @ts-expect-error
      return this.ansi.style[this.options.theme?.promptColor || 'green'] + promptFormat
        .replace('{cwd}', chalk.cyan(this.cwd))
        .replace('{uid}', chalk.white(user?.uid.toString() || ''))
        .replace('{gid}', chalk.white(user?.gid.toString() || ''))
        .replace('{user}', chalk.white(user?.username || ''))
        + this.ansi.style.white
    }

    // Parse the PS1-like format
    try {
      return this.parsePromptFormat(promptFormat)
    } catch {
      // Fall back to default if parsing fails
      const user = this._kernel.users.get(this._shell.credentials.euid ?? 0)
      const defaultPrompt = user?.uid === 0 ? '{user}:{cwd}# ' : '{user}:{cwd}$ '
      // @ts-expect-error
      return this.ansi.style[this.options.theme?.promptColor || 'green'] + defaultPrompt
        .replace('{cwd}', chalk.cyan(this.cwd))
        .replace('{user}', chalk.white(user?.username || ''))
        + this.ansi.style.white
    }
  }

  override async paste(data?: string) {
    const clip = data ? data : await navigator.clipboard.readText()
    this.write(clip)
    this._cmd += clip
    this._cursorPosition += clip.length
    this.events.dispatch<TerminalPasteEvent>(TerminalEvents.PASTE, { text: clip })
    this.events.dispatch<TerminalInputEvent>(TerminalEvents.INPUT, { terminal: this, data: clip })
  }

  async keyHandler({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) {
    const keyName = domEvent.key
    if (!key && !keyName) return
    if (domEvent.ctrlKey && domEvent.shiftKey) {
      if (keyName === 'F1' || keyName === 'F2') return // Ignore listen/unlisten keys
    }

    this.events.dispatch<TerminalKeyEvent>(TerminalEvents.KEY, { key, domEvent })

    if (domEvent.ctrlKey) {
      switch (keyName) {
        case 'c':
          this.events.dispatch<TerminalInterruptEvent>(TerminalEvents.INTERRUPT, { terminal: this })
          this._cmd = ''
          this._cursorPosition = 0
          this.unlisten()
          this.write('\n' + this.prompt())
          this.listen()
          return
        case 'l':
          return this.clear()
        case 'v':
          return this.paste()
        case 'Escape':
          return this.write(ansi.erase.display(2) + ansi.cursor.position() + this.prompt())
      }
    }

    switch (keyName) {
      case 'Enter':
        if (this._cmd.trim().endsWith('\\')) {
          this._multiLineBuffer += this._cmd.slice(0, -1) + '\n'
          this._multiLineMode = true
          this._cmd = ''
          this._cursorPosition = 0
          this.write('\n> ')
          break
        }

        if (this._multiLineMode) {
          this._multiLineBuffer += this._cmd
          this._cmd = this._multiLineBuffer
          this._multiLineMode = false
          this._multiLineBuffer = ''
        }

        this.write('\n')

        if (this._cmd.trim().length > 0) {
          const uid = this._shell.credentials.uid
          // Don't save history if the command begins with a space or is the same as the last command
          if (this._cmd[0] !== ' ' && this._cmd !== this._history[uid]?.[this._history[uid]?.length - 1]) {
            // TODO: Save to $HOME/.history instead and don't load entire history - index history file by line
            this._history[uid] = this._history[uid] || []
            this._history[uid].push(this._cmd)
            try { this._kernel.storage.local.setItem(`history:${uid}`, JSON.stringify(this._history[uid] || [])) }
            catch (error) { this._kernel.log.error(this._kernel.i18n.ns.terminal('failedToSaveHistory'), error) }
          }

          this._historyPosition = this._history[uid]?.length || 0

          try {
            this.events.dispatch<TerminalExecuteEvent>(TerminalEvents.EXECUTE, { terminal: this, command: this._cmd })
            await this._shell.execute(this._cmd)
          } catch (error) {
            this.writeln(chalk.red(`${error}`))
          }
        }

        this._cmd = ''
        this._cursorPosition = 0
        this.write(ansi.erase.inLine(2) + this.prompt())
        break
      case 'Backspace':
        if (this._cursorPosition > 0) {
          const tail = this._cmd.slice(this._cursorPosition)
          this._cmd = this._cmd.slice(0, this._cursorPosition - 1) + tail
          this._cursorPosition--
          this.write('\b' + ansi.erase.inLine(0) + tail)
          if (tail.length > 0) {
            this.write(`\x1b[${tail.length}D`)
          }
        } else this.write('\x07')
        break
      case 'Delete':
        if (this._cursorPosition < this._cmd.length) {
          const tail = this._cmd.slice(this._cursorPosition + 1)
          this._cmd = this._cmd.slice(0, this._cursorPosition) + tail
          this.write(ansi.erase.inLine(0) + tail)
          if (tail.length > 0) {
            this.write(`\x1b[${tail.length}D`)
          }
        }
        break
      case 'ArrowUp':
        if (this._historyPosition > 0) {
          this._historyPosition--
          this._cmd = this._history[this._shell.credentials.uid]?.[this._historyPosition] || ''
          this._cursorPosition = this._cmd.length
          this.write('\x1b[2K\r')
          if (this._multiLineMode) {
            const parts = this._cmd.split('#')
            if (parts.length > 1) {
              this.write('> ' + parts[0] + chalk.gray('#' + parts.slice(1).join('#')))
            } else {
              this.write('> ' + this._cmd)
            }
          } else {
            const parts = this._cmd.split('#')
            if (parts.length > 1) {
              this.write(this.prompt() + parts[0] + chalk.gray('#' + parts.slice(1).join('#')))
            } else {
              this.write(this.prompt() + this._cmd)
            }
          }
        }
        break
      case 'ArrowDown':
        if (this._historyPosition < (this._history[this._shell.credentials.uid]?.length || 0)) {
          this._historyPosition++
          this._cmd = this._history[this._shell.credentials.uid]?.[this._historyPosition] || ''
          this._cursorPosition = this._cmd.length
          this.write('\x1b[2K\r')
          if (this._multiLineMode) {
            const parts = this._cmd.split('#')
            if (parts.length > 1) {
              this.write('> ' + parts[0] + chalk.gray('#' + parts.slice(1).join('#')))
            } else {
              this.write('> ' + this._cmd)
            }
          } else {
            const parts = this._cmd.split('#')
            if (parts.length > 1) {
              this.write(this.prompt() + parts[0] + chalk.gray('#' + parts.slice(1).join('#')))
            } else {
              this.write(this.prompt() + this._cmd)
            }
          }
        }
        break
      case 'ArrowLeft':
        if (this._cursorPosition > 0) { this._cursorPosition--; this.write('\b') }
        break
      case 'ArrowRight':
        if (this._cursorPosition < this._cmd.length) { this._cursorPosition++; this.write(key) }
        break
      case 'Home':
        this._cursorPosition = 0
        this.write(ansi.cursor.horizontalAbsolute(this.prompt().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length + 1))
        break
      case 'End':
        this._cursorPosition = this._cmd.length + 1
        this.write(ansi.cursor.horizontalAbsolute(this.prompt().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length + this._cmd.length + 1))
        break
      case 'Tab': {
        domEvent.preventDefault()

        // If this is a new tab completion attempt (not cycling)
        if (!this._isTabCycling) {
          this._tabCompletionIndex = -1 // Start at -1 so first increment gets us to 0
          this._lastTabCommand = this._cmd
          this._isTabCycling = true
        }

        const matches = await this.getCompletionMatches(this._lastTabCommand) // Use original command for matches
        if (this._cmd.endsWith('/')) { // show possible entries in directory
          const pathArg = this._cmd.split(' ').slice(-1)[0]
          if (!pathArg) break
          const expandedPath = this._shell.expandTilde(pathArg)
          if (!(await this._kernel.filesystem.fs.exists(expandedPath))) break
          await this.write('\n')
          await this._shell.execute(`ls ${expandedPath}`)
          this.write(this.prompt() + this._cmd)
        } else if (matches.length > 0) {
          this.write('\r' + ansi.erase.inLine())
          this._tabCompletionIndex = (this._tabCompletionIndex + 1) % matches.length
          const newCmd = matches[this._tabCompletionIndex] || ''
          this._cmd = newCmd
          this._cursorPosition = newCmd.length
          const parts = newCmd.split('#')
          if (parts.length > 1) {
            this.write(this.prompt() + parts[0] + chalk.gray('#' + parts.slice(1).join('#')))
          } else {
            this.write(this.prompt() + newCmd)
          }
        }

        break
      }
      default:
        this._isTabCycling = false // Reset cycling state on other keypresses
        if (key.length === 1) {
          const wasAtEnd = this._cursorPosition === this._cmd.length
          this._cmd = this._cmd.slice(0, this._cursorPosition) + key + this._cmd.slice(this._cursorPosition)
          this._cursorPosition++

          if (wasAtEnd) {
            this.write(key)
          } else {
            const tail = this._cmd.slice(this._cursorPosition)
            this.write(key + tail)
            if (tail.length > 0) {
              this.write(`\x1b[${tail.length}D`)
            }
          }
        }
    }
  }

  serialize() {
    if (this.addons?.get('serialize')) return (this.addons.get('serialize') as SerializeAddon).serialize()
    else return null
  }

  override write(data: string | Uint8Array) {
    super.write(data)
    this.events.dispatch<TerminalWriteEvent>(TerminalEvents.WRITE, { text: data instanceof Uint8Array ? new TextDecoder().decode(data) : data })
    if (this._isMobile) {
      setTimeout(() => this._scrollTerminalToBottom(), 0)
    }
  }

  override writeln(data: string | Uint8Array) {
    super.writeln(data)
    this.events.dispatch<TerminalWritelnEvent>(TerminalEvents.WRITELN, { text: data instanceof Uint8Array ? new TextDecoder().decode(data) : data })
    if (this._isMobile) {
      setTimeout(() => this._scrollTerminalToBottom(), 0)
    }
  }

  /**
   * Creates a new ReadableStream subscribed to keyboard input.
   * Each call returns an independent stream that receives all keyboard input.
   * The stream is automatically unsubscribed when cancelled or closed.
   */
  private createSubscribedInputStream(): { stream: ReadableStream<Uint8Array>, close: () => void } {
    let callback: ((data: Uint8Array) => void) | null = null
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null
    
    const stream = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        controller = ctrl
        callback = (data: Uint8Array) => {
          try {
            controller!.enqueue(data)
          } catch {
            // Stream closed, unsubscribe
            if (callback) {
              this._stdinSubscribers.delete(callback)
              callback = null
            }
          }
        }
        this._stdinSubscribers.add(callback)
      },
      cancel: () => {
        if (callback) {
          this._stdinSubscribers.delete(callback)
          callback = null
        }
        controller = null
      }
    })

    const close = () => {
      if (controller) {
        try {
          controller.close()
        } catch {
          // Controller may already be closed
        }
        controller = null
      }
      if (callback) {
        this._stdinSubscribers.delete(callback)
        callback = null
      }
    }

    return { stream, close }
  }

  /**
   * Get a new input stream subscribed to keyboard input.
   * Each call returns an independent stream.
   */
  getInputStream(): ReadableStream<Uint8Array> {
    return this.createSubscribedInputStream().stream
  }

  /**
   * Get a new input stream with a close function to signal EOF.
   * Use this when you need to close the stream gracefully (e.g., for Ctrl+D).
   */
  getInputStreamWithClose(): { stream: ReadableStream<Uint8Array>, close: () => void } {
    return this.createSubscribedInputStream()
  }

  /**
   * Dispatch data to all stdin subscribers.
   * Used to send keyboard input to processes reading from stdin.
   */
  dispatchStdin(key: string) {
    if (key && key.length > 0) {
      const data = new TextEncoder().encode(key)
      for (const callback of this._stdinSubscribers) {
        try {
          callback(data)
        } catch {
          // Subscriber may be closed, will be cleaned up
        }
      }
    }
  }

  clearCommand() {
    const currentLine = this._cmd
    this._cmd = ''
    this._cursorPosition = 0
    this.write('\r' + ansi.erase.inLine(2))
    return currentLine
  }

  restoreCommand(cmd: string) {
    this._cmd = cmd
    this._cursorPosition = cmd.length
    const parts = cmd.split('#')
    if (parts.length > 1) {
      this.write(this.prompt() + parts[0] + chalk.gray('#' + parts.slice(1).join('#')))
    } else {
      this.write(this.prompt() + cmd)
    }
  }

  private _detectMobileSupport() {
    this._isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (typeof window !== 'undefined' && 'ontouchstart' in window) ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)

    this._visualViewportSupported = typeof window !== 'undefined' && 
      'visualViewport' in window &&
      window.visualViewport !== null
  }

  private _setupKeyboardHandling() {
    if (!this._isMobile) return

    if (this._visualViewportSupported) {
      try {
        const viewport = window.visualViewport!
        
        const handleViewportChange = () => {
          if (this._resizeTimeout) {
            clearTimeout(this._resizeTimeout)
          }
          this._resizeTimeout = setTimeout(() => {
            this._resizeTerminalToViewport()
          }, 50)
        }
        
        viewport.addEventListener('resize', handleViewportChange)
        
        const cleanup = () => {
          if (this._resizeTimeout) {
            clearTimeout(this._resizeTimeout)
            this._resizeTimeout = null
          }
          viewport.removeEventListener('resize', handleViewportChange)
        }
        this._viewportListeners.push(cleanup)
        
        this._lastViewportHeight = viewport.height
        this._resizeTerminalToViewport()
      } catch (error) {
        console.warn('Failed to setup Visual Viewport API:', error)
      }
    }
  }

  private _resizeTerminalToViewport() {
    if (!this._isMobile || this._isResizing) return
    
    const viewport = this._visualViewportSupported ? window.visualViewport : null
    if (!viewport) return
    
    const terminalContainer = document.getElementById('terminal')
    if (!terminalContainer) return
    
    const newHeight = viewport.height
    
    if (Math.abs(newHeight - this._lastViewportHeight) < 1) {
      return
    }
    
    this._isResizing = true
    this._lastViewportHeight = newHeight
    
    try {
      terminalContainer.style.height = `${newHeight}px`
      terminalContainer.style.maxHeight = `${newHeight}px`
      
      if (this.element) {
        this.element.style.height = `${newHeight}px`
      }
      
      if (this.addons?.get('fit')) {
        (this.addons.get('fit') as FitAddon).fit()
      }
      
      this._scrollTerminalToBottom()
    } finally {
      this._isResizing = false
    }
  }
  
  private _scrollTerminalToBottom() {
    if (!this.element) return
    
    const viewportElement = this.element.querySelector('.xterm-viewport') as HTMLElement
    if (viewportElement) {
      viewportElement.scrollTop = viewportElement.scrollHeight
    }
    
    this.scrollToBottom()
  }

  private async _readlineWithMobileInput(prompt: string, noListen: boolean): Promise<string> {
    const wasListening = this._keyListener !== undefined
    this.unlisten()
    this.write(prompt)
    
    const textInput = document.createElement('input')
    textInput.type = 'text'
    textInput.style.position = 'fixed'
    textInput.style.top = '0'
    textInput.style.left = '0'
    textInput.style.width = '1px'
    textInput.style.height = '1px'
    textInput.style.opacity = '0'
    textInput.style.pointerEvents = 'auto'
    textInput.style.zIndex = '-1'
    textInput.setAttribute('inputmode', 'text')
    textInput.setAttribute('autocapitalize', 'off')
    textInput.setAttribute('autocorrect', 'off')
    textInput.setAttribute('spellcheck', 'false')
    textInput.setAttribute('enterkeyhint', 'search')
    textInput.addEventListener('keydown', (e) => { window.alert(`Keydown: ${e.key}, code: ${e.code}`) })
    textInput.addEventListener('keyup', (e) => { window.alert(`Keyup: ${e.key}, code: ${e.code}`) })
    textInput.addEventListener('keypress', (e) => { window.alert(`Keypress: ${e.key}, code: ${e.code}`) })
    textInput.addEventListener('input', (e) => { window.alert(`Input: ${(e.target as HTMLInputElement).value}`) })
    
    document.body.appendChild(textInput)
    
    this._scrollTerminalToBottom()
    this._resizeTerminalToViewport()
    
    setTimeout(() => {
      textInput.focus()
    }, 100)

    const result = await new Promise<string>((resolve) => {
      let resolved = false
      let keyListener: IDisposable | null = null
      
      const cleanup = () => {
        if (resolved) return
        resolved = true
        textInput.removeEventListener('input', handleInput)
        textInput.removeEventListener('keydown', handleKeyDown)
        textInput.removeEventListener('blur', handleBlur)
        if (keyListener) {
          keyListener.dispose()
          keyListener = null
        }
        textInput.remove()
      }
      
      const updateDisplay = () => {
        const promptLen = prompt.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length
        const displayText = textInput.value
        this.write('\r' + ansi.cursor.horizontalAbsolute(promptLen + 1) + ansi.erase.inLine(0) + displayText)
      }

      const handleInput = () => {
        updateDisplay()
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target !== textInput) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        
        switch (e.key) {
          case 'Enter': {
            e.preventDefault()
            e.stopPropagation()
            const inputValue = textInput.value.trim()
            cleanup()
            this.write('\n')
            setTimeout(() => {
              resolve(inputValue)
            }, 0)
            break
          }
          case 'Escape': {
            e.preventDefault()
            e.stopPropagation()
            cleanup()
            resolve('')
            break
          }
        }
      }
      
      const handleBlur = () => {
        setTimeout(() => {
          if (textInput && document.body.contains(textInput) && !resolved) {
            textInput.focus()
          }
        }, 100)
      }

      textInput.addEventListener('input', handleInput)
      textInput.addEventListener('keydown', handleKeyDown)
      textInput.addEventListener('blur', handleBlur)

      keyListener = this.onKey(({ domEvent }) => {
        if (domEvent.target !== textInput) {
          domEvent.preventDefault()
          domEvent.stopPropagation()
        }
      })
    })

    if (wasListening && !noListen) this.listen()
    return result
  }

  private async _readlineWithPasswordInput(prompt: string, noListen: boolean): Promise<string> {
    const wasListening = this._keyListener !== undefined
    this.unlisten()
    this.write(prompt)
    
    const passwordInput = document.createElement('input')
    passwordInput.type = 'password'
    passwordInput.style.position = 'fixed'
    passwordInput.style.top = '0'
    passwordInput.style.left = '0'
    passwordInput.style.width = '1px'
    passwordInput.style.height = '1px'
    passwordInput.style.opacity = '0'
    passwordInput.style.pointerEvents = 'auto'
    passwordInput.style.zIndex = '-1'
    passwordInput.setAttribute('inputmode', 'text')
    passwordInput.setAttribute('autocapitalize', 'off')
    passwordInput.setAttribute('autocorrect', 'off')
    passwordInput.setAttribute('spellcheck', 'false')
    passwordInput.setAttribute('enterkeyhint', 'search')
    
    document.body.appendChild(passwordInput)
    this._passwordInputElement = passwordInput
    
    this._scrollTerminalToBottom()
    this._resizeTerminalToViewport()
    
    setTimeout(() => {
      passwordInput.focus()
    }, 100)

    const result = await new Promise<string>((resolve) => {
      let resolved = false
      let keyListener: IDisposable | null = null
      
      const cleanup = () => {
        if (resolved) return
        resolved = true
        passwordInput.removeEventListener('input', handleInput)
        passwordInput.removeEventListener('keydown', handleKeyDown)
        passwordInput.removeEventListener('blur', handleBlur)
        if (keyListener) {
          keyListener.dispose()
          keyListener = null
        }
        passwordInput.remove()
        this._passwordInputElement = null
      }
      
      const updateDisplay = () => {
        const promptLen = prompt.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length
        const stars = '*'.repeat(passwordInput.value.length)
        this.write('\r' + ansi.cursor.horizontalAbsolute(promptLen + 1) + ansi.erase.inLine(0) + stars)
      }

      const handleInput = () => {
        updateDisplay()
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target !== passwordInput) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        
        switch (e.key) {
          case 'Enter': {
            e.preventDefault()
            e.stopPropagation()
            const passwordValue = passwordInput.value.trim()
            cleanup()
            this.write('\n')
            setTimeout(() => {
              resolve(passwordValue)
            }, 0)
            break
          }
          case 'Escape':
            e.preventDefault()
            e.stopPropagation()
            cleanup()
            resolve('')
            break
        }
      }
      
      const handleBlur = () => {
        setTimeout(() => {
          if (passwordInput && document.body.contains(passwordInput) && !resolved) {
            passwordInput.focus()
          }
        }, 100)
      }

      passwordInput.addEventListener('input', handleInput)
      passwordInput.addEventListener('keydown', handleKeyDown)
      passwordInput.addEventListener('blur', handleBlur)

      keyListener = this.onKey(({ domEvent }) => {
        if (domEvent.target !== passwordInput) {
          domEvent.preventDefault()
          domEvent.stopPropagation()
        }
      })
    })

    if (this._passwordInputElement) {
      this._passwordInputElement.remove()
      this._passwordInputElement = null
    }

    if (wasListening && !noListen) this.listen()
    return result
  }

  private async getCompletionMatches(partial: string): Promise<string[]> {
    const parts = partial.split(' ')
    const lastWord = parts[parts.length - 1]
    if (!lastWord) return []
    
    // Check if the last word is a path (starts with ./ or / or ~)
    const isPath = lastWord.startsWith('./') || lastWord.startsWith('/') || lastWord.startsWith('~')
    
    // If this is the first word (command), search in PATH (unless it's a path)
    if (parts.length === 1 && !isPath) {
      const pathDirs = (this._shell.env.get('PATH') || '').split(':')
      const matches: string[] = []
      
      // First check built-in commands
      const builtinMatches = Object.keys(this._commands).filter(cmd => 
        cmd.toLowerCase().startsWith(lastWord.toLowerCase())
      )
      matches.push(...builtinMatches)

      // Then check executables in PATH
      for (const dir of pathDirs) {
        try {
          const entries = await this._kernel.filesystem.fs.readdir(dir)
          const dirMatches = entries.filter((entry: string) => 
            entry.toLowerCase().startsWith(lastWord.toLowerCase())
          )
          matches.push(...dirMatches)
        } catch {
          continue // Skip invalid directories
        }
      }

      return [...new Set(matches)].map(match => match) // Remove duplicates
    }

    // Expand tilde in the last word for filesystem operations
    const expandedLastWord = this._shell.expandTilde(lastWord)
    const home = this._shell.env.get('HOME') || ''
    
    // Existing file/directory completion logic
    const lastSlashIndex = expandedLastWord.lastIndexOf('/')
    const searchDir = lastSlashIndex !== -1 ? 
      path.resolve(this._shell.cwd, expandedLastWord.substring(0, lastSlashIndex + 1)) : 
      this._shell.cwd
    const searchTerm = lastSlashIndex !== -1 ? 
      expandedLastWord.substring(lastSlashIndex + 1) : 
      expandedLastWord

    try {
      const entries = await this._kernel.filesystem.fs.readdir(searchDir)
      const matches = entries.filter((entry: string) => {
        if (!searchTerm) return true
        return entry.toLowerCase().startsWith(searchTerm.toLowerCase())
      })

      // Determine the prefix to use - preserve tilde if original had it
      const hadTilde = lastWord.startsWith('~')
      const expandedPrefix = lastSlashIndex !== -1 ? expandedLastWord.substring(0, lastSlashIndex + 1) : ''
      
      const matchesMap = await Promise.all(matches.map(async (match: string) => {
        const fullPath = path.join(searchDir, match)
        const isDirectory = (await this._kernel.filesystem.fs.stat(fullPath)).isDirectory()
        const escapedMatch = match.replace(/([ ()[\]{}|&;<>`$"'\\])/g, '\\$1')
        const matchWithSlash = isDirectory ? escapedMatch + '/' : escapedMatch
        
        // If the original had tilde and the path is within HOME, convert back to tilde notation
        let completionPath: string
        if (hadTilde && home && fullPath.startsWith(home + '/')) {
          const relativePath = path.relative(home, fullPath)
          const tildePath = `~/${relativePath}`
          completionPath = isDirectory && !tildePath.endsWith('/') ? tildePath + '/' : tildePath
        } else if (hadTilde && home && fullPath === home) {
          completionPath = '~' + (isDirectory ? '/' : '')
        } else {
          // Use the expanded prefix
          completionPath = expandedPrefix + matchWithSlash
        }
        
        const newParts = [...parts]
        newParts[newParts.length - 1] = completionPath
        return newParts.join(' ')
      }))

      return matchesMap
    } catch {
      return []
    }
  }
}


// --- Spinner ---
type Timer = ReturnType<typeof setInterval>

export class Spinner {
  terminal: Terminal
  interval: number
  frames: string[]
  loop?: Timer
  prefix?: string
  suffix?: string

  constructor(terminal: Terminal, interval: number, frames: string[], prefix?: string, suffix?: string) {
    this.terminal = terminal
    this.interval = interval
    this.frames = frames
    this.prefix = prefix
    this.suffix = suffix
  }

  once() {
    this.start()
    setTimeout(() => this.stop(), this.interval * this.frames.length)
  }

  start() {
    let index = 0
    this.terminal.write(ansi.cursor.hide)
    const interval = setInterval(() => {
      const currentFrame = this.frames[index];
      const fullText = `${this.prefix ? this.prefix + ' ' : ''}${currentFrame}${this.suffix ? ' ' + this.suffix : ''}`;

      this.terminal.write(fullText)
      index = (index + 1) % this.frames.length

      // Calculate the visual width of the full text
      const fullWidth = [...fullText].reduce((width, char) => {
        if (/\p{Emoji}/ug.test(char)) return width + 1; // Emoji generally takes 2 spaces
        if (/[\u3000\u3001-\u303F]|[\u3040-\u309F]|[\u30A0-\u30FF]|[\uFF00-\uFFEF]|[\u4E00-\u9FAF]|[\u2605-\u2606]|[\u2190-\u2195]|\u203B/ug.test(char)) return width + 2; // Wide characters
        return width + 1; // Regular character
      }, 0);

      this.terminal.write(`\x1b[${fullWidth}D`)
    }, this.interval) as Timer

    this.loop = interval
    return interval
  }

  stop() {
    clearInterval(this.loop)
    this.terminal.write(ansi.cursor.show)
  }
}
