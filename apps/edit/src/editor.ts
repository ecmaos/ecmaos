import ansi from 'ansi-escape-sequences'
import type { Shell, Terminal } from '@ecmaos/types'
import { loadFile } from './file-ops.js'
import { renderScreen, resetRenderer } from './renderer.js'
import { handleNormalMode } from './modes/normal.js'
import { handleInsertMode } from './modes/insert.js'
import { handleReplaceMode } from './modes/replace.js'
import { handleCommandMode } from './modes/command.js'
import type { EditorState } from './types.js'

export class Editor {
  private state: EditorState
  private terminal: Terminal
  private shell: Shell

  constructor(terminal: Terminal, shell: Shell, filePath: string) {
    this.terminal = terminal
    this.shell = shell
    this.state = {
      lines: [''],
      cursorX: 0,
      cursorY: 0,
      mode: 'normal',
      startLine: 0,
      filePath,
      modified: false,
      shell
    }
  }

  async start(): Promise<number> {
    try {
      this.state.lines = await loadFile(this.shell, this.state.filePath)
      if (this.state.lines.length === 0) {
        this.state.lines = ['']
      }
      
      resetRenderer()
      this.terminal.unlisten()
      
      let active = true
      
      while (active) {
        renderScreen(this.terminal, this.state)
        
        if (this.state.mode === 'command') {
          this.terminal.write('\x1b[' + this.terminal.rows + ';1H')
          this.terminal.write(ansi.erase.inLine(0))
          const input = await this.terminal.readline(':', false, true)
          const result = await handleCommandMode(input, this.state, this.shell, this.terminal)
          
          if (result.message) {
            this.state.message = result.message
          }
          
          if (result.exit) {
            this.terminal.write('\x1b[' + this.terminal.rows + ';1H')
            this.terminal.write(ansi.erase.inLine(0))
            active = false
          } else {
            this.state.mode = 'normal'
          }
        } else {
          const { domEvent } = await new Promise<{ domEvent: globalThis.KeyboardEvent }>(resolve => this.terminal.onKey(resolve))
          
          if (this.state.mode === 'normal') {
            const shouldEnterCommandMode = await handleNormalMode(domEvent, this.state, this.terminal)
            if (shouldEnterCommandMode) {
              this.state.mode = 'command'
            }
          } else if (this.state.mode === 'insert') {
            handleInsertMode(domEvent, this.state, this.terminal)
          } else if (this.state.mode === 'replace') {
            handleReplaceMode(domEvent, this.state, this.terminal)
          }
        }
      }
      
      this.terminal.write('\x1b[2J')
      this.terminal.write(ansi.cursor.position(1, 1))
      this.terminal.write(this.terminal.prompt())
      this.terminal.listen()
      
      return 0
    } catch (error) {
      this.terminal.writeln(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      this.terminal.listen()
      return 1
    }
  }
}
