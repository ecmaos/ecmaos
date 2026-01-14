import topbar from 'topbar'
import type { DomOptions } from '@ecmaos/types'
import type { TopbarConfigOptions } from 'topbar'

export const DefaultDomOptions: DomOptions = { topbar: true }

export class Dom {
  private _document: Document = globalThis.document
  private _navigator: Navigator = globalThis.navigator
  private _window: Window = globalThis.window
  private _topbarEnabled: boolean = false
  private _topbarShow: boolean = false

  get document() { return this._document }
  get navigator() { return this._navigator }
  get window() { return this._window }

  constructor(_options: DomOptions = DefaultDomOptions) {
    const options = { ...DefaultDomOptions, ..._options }
    this._topbarEnabled = options.topbar ?? true
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
}
