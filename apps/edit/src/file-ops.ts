import path from 'path'
import type { Shell } from '@ecmaos/types'

export async function loadFile(shell: Shell, filePath: string): Promise<string[]> {
  const fullPath = path.resolve(shell.cwd, filePath)
  
  try {
    const content = await shell.context.fs.promises.readFile(fullPath, 'utf-8')
    const lines = content.split('\n')
    return lines.length === 0 ? [''] : lines
  } catch {
    return ['']
  }
}

export async function saveFile(shell: Shell, filePath: string, lines: string[]): Promise<void> {
  const fullPath = path.resolve(shell.cwd, filePath)
  const content = lines.join('\n')
  await shell.context.fs.promises.writeFile(fullPath, content, 'utf-8')
}
