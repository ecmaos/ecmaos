import topbar from 'topbar'
import { Notyf } from 'notyf'
import 'notyf/notyf.min.css'
import type { DomOptions } from '@ecmaos/types'
import type { TopbarConfigOptions } from 'topbar'

export const DefaultDomOptions: DomOptions = { topbar: true }

export class Dom {
  private _document: Document = globalThis.document
  private _navigator: Navigator = globalThis.navigator
  private _window: Window = globalThis.window
  private _topbarEnabled: boolean = false
  private _topbarShow: boolean = false
  private _toast: Notyf

  get document() { return this._document }
  get navigator() { return this._navigator }
  get window() { return this._window }
  get toast() { return this._toast }

  constructor(_options: DomOptions = DefaultDomOptions) {
    const options = { ...DefaultDomOptions, ..._options }
    this._topbarEnabled = options.topbar ?? true
    this._toast = new Notyf(options.toast)
  }

  async topbar(show?: boolean) {
    if (!this._topbarEnabled) return
    this._topbarShow = show ?? !this._topbarShow
    if (this._topbarShow) topbar.show()
    else topbar.hide()
  }

  async topbarConfig(options: TopbarConfigOptions) {
    if (!this._topbarEnabled) return
    topbar.config(options)
  }

  async topbarProgress(value: number) {
    if (!this._topbarEnabled) return
    topbar.progress(value)
  }

  /**
   * Shows a quick flash indicator for the TTY number in the top-right corner
   * @param ttyNumber - TTY number to display
   */
  showTtyIndicator(ttyNumber: number): void {
    const existingIndicator = this._document.getElementById('tty-indicator')
    if (existingIndicator) existingIndicator.remove()

    const indicator = this._document.createElement('div')
    indicator.id = 'tty-indicator'
    indicator.className = 'tty-indicator'
    indicator.textContent = `TTY ${ttyNumber}`
    this._document.body.appendChild(indicator)

    requestAnimationFrame(() => indicator.classList.add('show'))

    setTimeout(() => {
      indicator.classList.remove('show')
      setTimeout(() => {
        if (indicator.parentNode) indicator.remove()
      }, 300)
    }, 1500)
  }
}
