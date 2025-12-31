import type { Shell } from '@ecmaos/types'

export type EditorMode = 'normal' | 'insert' | 'replace' | 'command'

export interface EditorState {
  lines: string[]
  cursorX: number
  cursorY: number
  mode: EditorMode
  startLine: number
  message?: string
  filePath: string
  modified: boolean
  shell: Shell
}
