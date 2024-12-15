import { Events } from '#events.ts'

import { ProcessEvents, ProcessStatus } from '@ecmaos/types'

import type {
  Kernel,
  Shell,
  Terminal,
  Process as IProcess,
  ProcessEntryParams,
  ProcessOptions,
  ProcessesMap,
  ProcessExitEvent,
  ProcessPauseEvent,
  ProcessResumeEvent,
  ProcessStartEvent,
  ProcessStopEvent
} from '@ecmaos/types'

export class ProcessManager {
  private _processes: ProcessesMap = new Map()

  get all() { return this._processes }

  add(process: Process) {
    this._processes.set(process.pid, process)
    return process.pid
  }

  create(options: ProcessOptions) {
    return new Process(options)
  }

  get(pid: number) {
    return this._processes.get(pid)
  }

  pid() {
    return this._processes.size
  }

  remove(pid: number) {
    this._processes.delete(pid)
  }

  spawn(parent: number, process: Process) {
    process.parent = parent
    return this.add(process)
  }
}

export class Process implements IProcess {
  private _args: string[]
  private _code?: number
  private _command: string
  private _cwd: string
  private _entry: (params: ProcessEntryParams) => Promise<number | undefined | void>
  private _events: Events
  private _gid: number
  private _kernel: Kernel
  private _pid: number
  private _parent?: number
  private _shell: Shell
  private _status: ProcessStatus = 'stopped'
  private _stderr: WritableStream<Uint8Array>
  private _stdin: ReadableStream<Uint8Array>
  private _stdout: WritableStream<Uint8Array>
  private _terminal: Terminal
  private _uid: number

  get args() { return this._args }
  get code() { return this._code }
  get command() { return this._command }
  get cwd() { return this._cwd }
  get entry() { return this._entry }
  get events() { return this._events }
  get gid() { return this._gid }
  get kernel() { return this._kernel }
  get pid() { return this._pid }
  get shell() { return this._shell }
  get status() { return this._status }
  get stderr() { return this._stderr }
  get stdin() { return this._stdin }
  get stdout() { return this._stdout }
  get terminal() { return this._terminal }
  get uid() { return this._uid }

  get parent() { return this._parent }
  set parent(parent: number | undefined) { this._parent = parent }

  constructor(options: ProcessOptions) {
    if (!options.kernel) throw new Error('Kernel is required')
    this._args = options.args || []
    this._command = options.command || ''
    this._cwd = options.cwd || options.shell?.cwd || '/'
    this._entry = options.entry || ((params: ProcessEntryParams) => { options.kernel?.log.silly(params); return Promise.resolve(0) })
    this._events = new Events()
    this._gid = options.gid
    this._kernel = options.kernel
    this._pid = this._kernel.processes.pid()
    this._parent = options.parent
    this._shell = options.shell || this.kernel.shell
    this._terminal = options.terminal || this.kernel.terminal
    this._uid = options.uid


    this._stdin = options.stdin || this.terminal.getInputStream()
    this._stdout = options.stdout || this.terminal.stdout || new WritableStream()
    this._stderr = options.stderr || this.terminal.stderr || new WritableStream()

    this.kernel.processes.add(this as IProcess)
  }

  async cleanup() {
    this.events.clear()
    this.kernel.processes.remove(this.pid)
  }

  async exit(exitCode: number = 0) {
    this._code = exitCode
    this._status = 'exited'
    await this.cleanup()
    this.events.emit<ProcessExitEvent>(ProcessEvents.EXIT, { pid: this.pid, code: exitCode })
  }

  pause() {
    this._status = 'paused'
    this.events.emit<ProcessPauseEvent>(ProcessEvents.PAUSE, { pid: this.pid })
  }

  resume() {
    this._status = 'running'
    this.events.emit<ProcessResumeEvent>(ProcessEvents.RESUME, { pid: this.pid })
  }

  async start() {
    this._status = 'running'
    this.events.emit<ProcessStartEvent>(ProcessEvents.START, { pid: this.pid })

    const exitCode = await this.entry({
      args: this.args,
      command: this.command,
      cwd: this.cwd,
      instance: this as IProcess,
      gid: this.gid,
      kernel: this.kernel,
      pid: this.pid,
      shell: this.shell,
      terminal: this.terminal,
      stdin: this._stdin,
      stdout: this._stdout,
      stderr: this._stderr,
      uid: this.uid
    })

    await this.stop(exitCode ?? 0)
    return exitCode ?? 0
  }

  async stop(exitCode?: number) {
    this._status = 'stopped'
    this.events.emit<ProcessStopEvent>(ProcessEvents.STOP, { pid: this.pid })
    await this.exit(exitCode ?? 0)
  }

  restart() {
    this.stop()
    this.start()
  }
}
