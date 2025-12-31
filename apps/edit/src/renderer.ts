import ansi from 'ansi-escape-sequences'
import type { Terminal } from '@ecmaos/types'
import type { EditorState } from './types.js'

export function renderScreen(terminal: Terminal, state: EditorState): void {
  terminal.write(ansi.erase.display(2) + ansi.cursor.position(0, 0))
  
  const visibleRows = terminal.rows - 1
  const visibleLines = state.lines.slice(state.startLine, state.startLine + visibleRows)
  
  visibleLines.forEach((line: string) => {
    terminal.writeln(line)
  })
  
  const statusRow = terminal.rows
  terminal.write(ansi.cursor.position(statusRow, 0) + ansi.erase.inLine())
  
  if (state.message) {
    terminal.write(state.message)
  } else {
    const modeStr = state.mode.toUpperCase()
    const posStr = `${state.cursorY + 1},${state.cursorX + 1}`
    const modifiedStr = state.modified ? ' [Modified]' : ''
    const status = `-- ${modeStr} MODE (${posStr})${modifiedStr} --`
    
    let modeColor = terminal.ansi.style.gray
    if (state.mode === 'insert') {
      modeColor = terminal.ansi.style.green
    } else if (state.mode === 'replace') {
      modeColor = terminal.ansi.style.red
    }
    
    terminal.write(modeColor + status)
  }
  
  if (state.mode !== 'command') {
    const relativeY = state.cursorY - state.startLine + 1
    if (relativeY >= 1 && relativeY <= visibleRows) {
      terminal.write(`\x1b[${relativeY};${state.cursorX + 1}H`)
    }
  }
}
