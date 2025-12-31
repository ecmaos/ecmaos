import type { Terminal } from '@ecmaos/types'
import type { EditorState } from '../types.js'

export async function handleNormalMode(
  event: globalThis.KeyboardEvent,
  state: EditorState,
  terminal: Terminal
): Promise<boolean> {
  switch (event.key) {
    case 'Insert':
    case 'i':
      state.mode = 'insert'
      break
    case 'r':
      state.mode = 'replace'
      break
    case 'ArrowLeft':
    case 'h':
      state.cursorX = Math.max(0, state.cursorX - 1)
      break
    case 'ArrowDown':
    case 'j':
      if (state.cursorY < state.lines.length - 1) {
        state.cursorY++
        if (state.cursorY >= state.startLine + terminal.rows - 1) {
          state.startLine++
        }
      }
      break
    case 'ArrowUp':
    case 'k':
      if (state.cursorY > 0) {
        state.cursorY--
        if (state.cursorY < state.startLine) {
          state.startLine--
        }
      }
      break
    case 'ArrowRight':
    case 'l':
      {
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        if (lineLength === 0) {
          state.cursorX = 0
        } else {
          state.cursorX = Math.min(lineLength - 1, state.cursorX + 1)
        }
      }
      break
    case 'Home':
      state.cursorX = 0
      break
    case 'End':
      {
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = Math.max(0, lineLength - 1)
      }
      break
    case 'PageUp':
      if (state.cursorY > 0) {
        const pageSize = terminal.rows - 2
        state.cursorY = Math.max(0, state.cursorY - pageSize)
        state.startLine = Math.max(0, state.startLine - pageSize)
        if (state.cursorY < state.startLine) {
          state.startLine = state.cursorY
        }
      }
      break
    case 'PageDown':
      if (state.cursorY < state.lines.length - 1) {
        const pageSize = terminal.rows - 2
        state.cursorY = Math.min(state.lines.length - 1, state.cursorY + pageSize)
        state.startLine = Math.min(state.lines.length - pageSize, state.startLine + pageSize)
        if (state.cursorY >= state.startLine + pageSize) {
          state.startLine = state.cursorY - pageSize + 1
        }
      }
      break
    case 'Delete':
    case 'd':
      {
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        if (state.cursorX < lineLength) {
          state.lines[state.cursorY] = 
            (state.lines[state.cursorY]?.slice(0, state.cursorX) ?? '') + 
            (state.lines[state.cursorY]?.slice(state.cursorX + 1) ?? '')
          state.modified = true
        } else if (state.cursorY < state.lines.length - 1) {
          state.lines[state.cursorY] = (state.lines[state.cursorY] ?? '') + (state.lines[state.cursorY + 1] ?? '')
          state.lines.splice(state.cursorY + 1, 1)
          state.modified = true
        }
      }
      break
    case ':':
      return true
    case 'Escape':
      state.mode = 'normal'
      break
  }
  
  return false
}
