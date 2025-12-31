import type { ProcessEntryParams } from '@ecmaos/types'
import { Editor } from './editor.js'

const main = async (params: ProcessEntryParams) => {
  const { args, shell, terminal } = params
  
  if (!args || args.length === 0 || !args[0]) {
    terminal.writeln('Usage: edit <file>')
    return 1
  }
  
  const filePath = args[0]
  const editor = new Editor(terminal, shell, filePath)
  
  return await editor.start()
}

export default main
