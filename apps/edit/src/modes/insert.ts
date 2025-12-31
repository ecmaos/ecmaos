import type { Terminal } from '@ecmaos/types'
import type { EditorState } from '../types.js'

export function handleInsertMode(
  event: globalThis.KeyboardEvent,
  state: EditorState,
  terminal: Terminal
): void {
  switch (event.key) {
    case 'Escape':
      state.mode = 'normal'
      break
    case 'Enter':
      {
        const currentLine = state.lines[state.cursorY] ?? ''
        const beforeCursor = currentLine.slice(0, state.cursorX)
        const afterCursor = currentLine.slice(state.cursorX)
        state.lines[state.cursorY] = beforeCursor
        state.lines.splice(state.cursorY + 1, 0, afterCursor)
        state.cursorY++
        state.cursorX = 0
        if (state.cursorY >= state.startLine + terminal.rows - 1) {
          state.startLine++
        }
        state.modified = true
      }
      break
    case 'Backspace':
      if (state.cursorX > 0) {
        const currentLine = state.lines[state.cursorY] ?? ''
        state.lines[state.cursorY] = currentLine.slice(0, state.cursorX - 1) + currentLine.slice(state.cursorX)
        state.cursorX--
        state.modified = true
      } else if (state.cursorY > 0) {
        const prevLineLength = state.lines[state.cursorY - 1]?.length ?? 0
        state.lines[state.cursorY - 1] = (state.lines[state.cursorY - 1] ?? '') + (state.lines[state.cursorY] ?? '')
        state.lines.splice(state.cursorY, 1)
        state.cursorY--
        state.cursorX = prevLineLength
        if (state.cursorY < state.startLine) {
          state.startLine--
        }
        state.modified = true
      }
      break
    case 'Delete':
      {
        const currentLine = state.lines[state.cursorY] ?? ''
        if (state.cursorX < currentLine.length) {
          state.lines[state.cursorY] = currentLine.slice(0, state.cursorX) + currentLine.slice(state.cursorX + 1)
          state.modified = true
        } else if (state.cursorY < state.lines.length - 1) {
          state.lines[state.cursorY] = currentLine + (state.lines[state.cursorY + 1] ?? '')
          state.lines.splice(state.cursorY + 1, 1)
          state.modified = true
        }
      }
      break
    case 'ArrowLeft':
      state.cursorX = Math.max(0, state.cursorX - 1)
      break
    case 'ArrowUp':
      if (state.cursorY > 0) {
        state.cursorY--
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = Math.min(lineLength, state.cursorX)
        if (state.cursorY < state.startLine) {
          state.startLine--
        }
      }
      break
    case 'ArrowDown':
      if (state.cursorY < state.lines.length - 1) {
        state.cursorY++
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = Math.min(lineLength, state.cursorX)
        if (state.cursorY >= state.startLine + terminal.rows - 1) {
          state.startLine++
        }
      }
      break
    case 'ArrowRight':
      {
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = Math.min(lineLength, state.cursorX + 1)
      }
      break
    case 'Home':
      state.cursorX = 0
      break
    case 'End':
      {
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = lineLength
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
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = Math.min(lineLength, state.cursorX)
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
        const lineLength = state.lines[state.cursorY]?.length ?? 0
        state.cursorX = Math.min(lineLength, state.cursorX)
      }
      break
    default:
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const currentLine = state.lines[state.cursorY] ?? ''
        state.lines[state.cursorY] = currentLine.slice(0, state.cursorX) + event.key + currentLine.slice(state.cursorX)
        state.cursorX++
        state.modified = true
      }
      break
  }
}
