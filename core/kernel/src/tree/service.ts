import path from 'path'
import { Kernel } from '#kernel.ts'

declare global {
  interface BackgroundFetchManager {
    fetch(id: string, urls: string[], options: object): Promise<BackgroundFetchRegistration>
  }

  interface BackgroundFetchRegistration extends EventTarget {
    readonly id: string;
    readonly uploadTotal: number;
    readonly uploaded: number;
    readonly downloadTotal: number;
    readonly downloaded: number;
    readonly result: unknown;
    readonly failureReason: unknown;
  
    match(request: RequestInfo, options?: CacheQueryOptions): Promise<Response | undefined>;
    matchAll(): Promise<Response[]>;
    onprogress: ((this: BackgroundFetchRegistration, ev: ProgressEvent<BackgroundFetchRegistration>) => unknown) | null;
  }
}

type ExtendedServiceWorkerRegistration = ServiceWorkerRegistration & {
  backgroundFetch: BackgroundFetchManager
}

export const DefaultServiceOptions: ServiceOptions = {
  path: import.meta.env.SERVICE_WORKER_PATH || '/swapi.js',
  register: import.meta.env.NODE_ENV !== 'test'
}

export class Service {
  private _fetches: Record<string, BackgroundFetchRegistration> = {}
  private _kernel: Kernel
  private _options: ServiceOptions
  private _registration?: ExtendedServiceWorkerRegistration

  get fetches() { return this._fetches }
  get options() { return this._options }
  get registration() { return this._registration }

  constructor(options: ServiceOptions) {
    options = { ...DefaultServiceOptions, ...options }
    if (!options.kernel) throw new Error('Kernel is required to initialize a Service Worker.')
    this._kernel = options.kernel
    this._options = options

    navigator.serviceWorker?.ready.then(() => this.message(`Kernel ${this._kernel.id} has registered a Service Worker!`))
    if (options.register) this.register()
  }

  /**
   * Fetch a list of URLs and save them to the kernel's filesystem using the Background Fetch API.
   * 
   * @param id - The id of the fetch (used as directory name for the downloaded files).
   * @param urls - The URLs to fetch.
   * @param options - The options to pass to the fetch.
   * @returns The fetch registration.
   */
  async fetch(id: string, urls: string[], options: object) {
    if (this._fetches[id]) throw new Error(`Fetch with id ${id} already exists.`)
    if (!urls || urls.length === 0) throw new Error('No URLs provided to fetch.')
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker API not supported in this browser.')
    if (!('BackgroundFetchManager' in globalThis)) throw new Error('Background Fetch API not supported in this browser.')
    if (!this.registration) throw new Error('Service Worker is not registered.')

    let downloadTotal = undefined
    for (const url of urls) {
      if (typeof downloadTotal !== 'number') downloadTotal = 0
      const response = await fetch(url, { method: 'HEAD' })
      downloadTotal += parseInt(response.headers.get('content-length') || '0')
    }

    const registration = await this.registration.backgroundFetch.fetch(id, urls, { ...options, downloadTotal })
    this._fetches[id] = registration

    registration.addEventListener('progress', () => {
      if (!registration.downloadTotal) return
      const percent = Math.round(registration.downloaded / registration.downloadTotal * 100)
      this._kernel.log?.info(`${percent}% of ${urls.length} files downloaded.`)
    })

    navigator.serviceWorker.addEventListener('message', async e => {
      const root = this._kernel.shell.cwd || '/tmp'
      const destination = path.resolve(root, e.data.id)

      if (e.data.type === 'backgroundfetchsuccess') {
        if (!await this._kernel.filesystem.fs.exists(destination)) await this._kernel.filesystem.fs.mkdir(destination)

        for (const url of urls) {
          try {
            const response = await fetch(url)
            const buffer = await response.arrayBuffer()
            await this._kernel.filesystem.fs.writeFile(`${destination}/${url.split('/').pop()}`, new Uint8Array(buffer))
            this._kernel.log?.info(`Saved ${url} to ${destination}/${url.split('/').pop()}.`)
          } catch (error) {
            this._kernel.log?.error(`Failed to fetch ${url}: ${error}`)
          }
        }

        delete this._fetches[id]
      }

      if (e.data.type === 'backgroundfetchclick') {
        this._kernel.terminal.writeln(`\nYour download of ${urls.length} ${urls.length === 1 ? 'file' : 'files'} has completed and is located at ${destination}`)
        this._kernel.terminal.write(this._kernel.terminal.prompt())
      }

      // if (e.data.type === 'backgroundfetchfailure' || e.data.type === 'backgroundfetchabort') delete this._fetches[e.data.id]
      if (e.data.type === 'backgroundfetchfailure') {
        this._kernel.terminal.writeln(`\nYour download of ${urls.length} ${urls.length === 1 ? 'file' : 'files'} failed!`)
        this._kernel.terminal.write(this._kernel.terminal.prompt())
      }
    })

    return registration
  }

  async message(message: string) {
    if ('serviceWorker' in navigator) this.registration?.active?.postMessage(message)
    else throw new Error('Service Worker API not supported in this browser.')
  }

  async register() {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.register(this.options.path || '/swapi.js')
      this._registration = registration as ExtendedServiceWorkerRegistration
      return registration
    } else throw new Error('Service Worker API not supported in this browser.')
  }

  async unregister() {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of registrations) await registration.unregister()
    } else throw new Error('Service Worker API not supported in this browser.')
  }

  async update() {
    if ('serviceWorker' in navigator) await this.registration?.update()
    else throw new Error('Service Worker API not supported in this browser.')
  }
}

// --- Types ---

export interface ServiceOptions {
  kernel?: Kernel
  path?: string
  register?: boolean
}
