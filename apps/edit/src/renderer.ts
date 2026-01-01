import ansi from 'ansi-escape-sequences'
import type { Terminal } from '@ecmaos/types'
import type { EditorState } from './types.js'

let lastStartLine = -1
let lastVisibleLines: string[] = []
let lastCursorY = -1
let lastCursorX = -1
let lastMode: EditorState['mode'] | null = null

export function resetRenderer(): void {
  lastStartLine = -1
  lastVisibleLines = []
  lastCursorY = -1
  lastCursorX = -1
  lastMode = null
}

export function renderScreen(terminal: Terminal, state: EditorState, forceFullRender = false): void {
  const visibleRows = terminal.rows - 1
  const visibleLines = state.lines.slice(state.startLine, state.startLine + visibleRows)
  
  const needsFullRender = forceFullRender || 
    state.startLine !== lastStartLine ||
    state.mode !== lastMode ||
    visibleLines.length !== lastVisibleLines.length ||
    state.cursorY < state.startLine ||
    state.cursorY >= state.startLine + visibleRows

  if (needsFullRender) {
    terminal.write(ansi.erase.display(2) + ansi.cursor.position(1, 1))
    
    visibleLines.forEach((line: string) => {
      terminal.writeln(line)
    })
    
    lastStartLine = state.startLine
    lastVisibleLines = [...visibleLines]
    lastCursorY = state.cursorY
    lastCursorX = state.cursorX
    lastMode = state.mode
  } else {
    const relativeY = state.cursorY - state.startLine + 1
    const lastRelativeY = lastCursorY >= state.startLine && lastCursorY < state.startLine + visibleRows 
      ? lastCursorY - state.startLine + 1 
      : -1
    
    if (relativeY >= 1 && relativeY <= visibleRows) {
      const currentLine = visibleLines[relativeY - 1] || ''
      const lastLine = lastVisibleLines[relativeY - 1] || ''
      
      if (currentLine !== lastLine) {
        terminal.write(`\x1b[${relativeY};1H`)
        terminal.write(ansi.erase.inLine(0))
        terminal.write(currentLine)
        lastVisibleLines[relativeY - 1] = currentLine
      }
    }
    
    if (lastRelativeY >= 1 && lastRelativeY <= visibleRows && lastRelativeY !== relativeY) {
      const lastLine = lastVisibleLines[lastRelativeY - 1] || ''
      const currentLastLine = state.lines[lastCursorY] || ''
      if (lastLine !== currentLastLine) {
        terminal.write(`\x1b[${lastRelativeY};1H`)
        terminal.write(ansi.erase.inLine(0))
        terminal.write(currentLastLine)
        lastVisibleLines[lastRelativeY - 1] = currentLastLine
      }
    }
    
    if (state.cursorY !== lastCursorY || state.cursorX !== lastCursorX) {
      const cursorRelativeY = state.cursorY - state.startLine + 1
      if (cursorRelativeY >= 1 && cursorRelativeY <= visibleRows && state.mode !== 'command') {
        const currentLine = state.lines[state.cursorY] || ''
        const cursorCol = currentLine.length === 0 ? 1 : Math.min(state.cursorX + 1, currentLine.length + 1)
        terminal.write(`\x1b[${cursorRelativeY};${cursorCol}H`)
      }
    }
    
    lastCursorY = state.cursorY
    lastCursorX = state.cursorX
  }
  
  const statusRow = terminal.rows
  terminal.write(ansi.cursor.position(statusRow, 1) + ansi.erase.inLine(0))
  
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
      const currentLine = state.lines[state.cursorY] || ''
      const cursorCol = currentLine.length === 0 ? 1 : Math.min(state.cursorX + 1, currentLine.length + 1)
      terminal.write(`\x1b[${relativeY};${cursorCol}H`)
    }
  }
}
