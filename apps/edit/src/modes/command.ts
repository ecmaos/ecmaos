import path from 'path'
import type { Shell, Terminal } from '@ecmaos/types'
import type { EditorState } from '../types.js'
import { saveFile } from '../file-ops.js'

export async function handleCommandMode(
  input: string,
  state: EditorState,
  shell: Shell,
  terminal: Terminal
): Promise<{ exit: boolean, message?: string }> {
  const trimmed = input.trim()
  
  if (!trimmed) {
    return { exit: false }
  }
  
  const lineNum = parseInt(trimmed, 10)
  if (!isNaN(lineNum)) {
    const targetLine = Math.max(0, Math.min(state.lines.length - 1, lineNum - 1))
    const visibleRows = terminal.rows - 1
    if (targetLine < state.startLine || targetLine >= state.startLine + visibleRows) {
      state.startLine = Math.max(0, Math.min(state.lines.length - visibleRows, targetLine - Math.floor(visibleRows / 2)))
    }
    state.cursorY = targetLine
    const lineLength = state.lines[state.cursorY]?.length ?? 0
    state.cursorX = Math.min(lineLength, state.cursorX)
    return { exit: false }
  }
  
  if (trimmed === 'q') {
    if (state.modified) {
      return { exit: false, message: 'No write since last change (add ! to override)' }
    }
    return { exit: true }
  }
  
  if (trimmed === 'q!') {
    return { exit: true }
  }
  
  if (trimmed === 'w' || trimmed === 'wq') {
    try {
      await saveFile(shell, state.filePath, state.lines)
      state.modified = false
      if (trimmed === 'wq') {
        return { exit: true, message: `Saved to ${state.filePath}` }
      }
      return { exit: false, message: `Saved to ${state.filePath}` }
    } catch (error) {
      return { exit: false, message: `Error saving file: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }
  
  const writeMatch = trimmed.match(/^w\s+(.+)$/)
  if (writeMatch && writeMatch[1]) {
    const targetPath = writeMatch[1]
    try {
      const fullPath = path.resolve(shell.cwd, targetPath)
      await saveFile(shell, targetPath, state.lines)
      state.modified = false
      return { exit: false, message: `Saved to ${fullPath}` }
    } catch (error) {
      return { exit: false, message: `Error saving file: ${error instanceof Error ? error.message : 'Unknown error'}` }
    }
  }
  
  return { exit: false, message: `Unknown command: ${trimmed}` }
}
