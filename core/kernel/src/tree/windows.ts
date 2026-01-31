import 'winbox'
import 'winbox/dist/css/winbox.min.css'
// @ts-ignore
import WinBox from 'winbox/src/js/winbox.js'

import type { WindowId, Windows as IWindows } from '@ecmaos/types'

declare const WinBox: WinBox.WinBoxConstructor;

declare module 'winbox' {
  interface WinBoxConstructor {
    stack(): WinBox[];
  }
}

const DefaultWindowOptions: WinBox.Params = {
  background: 'black',
  border: 1,
  class: 'ecmaos-window',
  height: 300,
  title: 'Untitled',
  width: 300,
  x: 'center',
  y: 'center'
}

const DefaultDialogOptions: WinBox.Params = {
  ...DefaultWindowOptions,
  modal: true,
  width: 320,
  height: 200,
}

export class Windows implements IWindows {
  private _manager: Map<WindowId, WinBox> = new Map()

  get stack() { return WinBox.stack() }

  all() {
    return this._manager.entries()
  }

  close(id: WindowId) {
    this._manager.get(id)?.close()
  }
  
  create(_options: WinBox.Params = DefaultWindowOptions): WinBox {
    const options = { ...DefaultWindowOptions, ..._options }
    const id = options.id || Math.random().toString(36).substring(2, 8)
    
    const self = this
    
    const originalOnMinimize = options.onminimize
    options.onminimize = function(this: WinBox, force: boolean) {
      setTimeout(() => self._updateBodyClass(), 0)
      originalOnMinimize?.call(this, force)
    }

    const originalOnRestore = options.onrestore
    options.onrestore = function(this: WinBox) {
      setTimeout(() => self._updateBodyClass(), 0)
      originalOnRestore?.call(this)
    }

    const originalOnMaximize = options.onmaximize
    options.onmaximize = function(this: WinBox) {
      setTimeout(() => self._updateBodyClass(), 0)
      originalOnMaximize?.call(this)
    }

    const originalOnClose = options.onclose
    options.onclose = function(this: WinBox, force: boolean) {
      setTimeout(() => self._updateBodyClass(), 0)
      self.remove(id)
      return originalOnClose?.call(this, force)
    }

    const win = new WinBox(options)
    this._manager.set(id, win)
    return win
  }

  private _updateBodyClass() {
    let minimizedCount = 0
    for (const win of this._manager.values()) {
      // @ts-ignore
      if (win.min) minimizedCount++
    }

    if (minimizedCount > 0) {
      document.body.classList.add('has-minimized-windows')
    } else {
      document.body.classList.remove('has-minimized-windows')
    }
  }

  dialog(options: WinBox.Params = DefaultDialogOptions) {
    return this.create({ ...DefaultDialogOptions, ...options })
  }

  get(id: WindowId) {
    return this._manager.get(id)
  }

  remove(id: WindowId) {
    this._manager.delete(id)
  }
}
