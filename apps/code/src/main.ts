import type { ProcessEntryParams } from '@ecmaos/types'
import path from 'node:path'

// TODO: Get workers to import properly in the kernel (rewrite /assets)
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

import styles from './styles.module.css'

declare global {
  var editor: monaco.editor.IStandaloneCodeEditor
  var monaco: any // eslint-disable-line no-var
}

globalThis.monaco = monaco
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

const createMenuBar = (
  win: WinBox,
  editor: monaco.editor.IStandaloneCodeEditor,
  params: ProcessEntryParams,
  file: string
) => {
  const { kernel } = params
  const menuBar = document.createElement('div')
  menuBar.style.cssText = `
    width: 100%;
    height: 30px;
    background: #252526;
    display: flex;
    align-items: center;
    padding: 0 8px;
    border-bottom: 1px solid #3c3c3c;
  `

  // Track active dropdown to close it when clicking elsewhere
  let activeDropdown: HTMLElement | null = null
  document.addEventListener('click', (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target as Node)) {
      activeDropdown.style.display = 'none'
      activeDropdown = null
    }
  })

  const createMenuItem = (text: string, items: { label: string, action?: () => Promise<void> | void }[]) => {
    const menuItemContainer = document.createElement('div')
    menuItemContainer.style.position = 'relative'
    
    const menuItem = document.createElement('div')
    menuItem.textContent = text
    menuItem.style.cssText = `
      color: #cccccc;
      padding: 0 8px;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      height: 30px;
      line-height: 30px;
    `
    
    const dropdown = document.createElement('div')
    dropdown.style.cssText = `
      position: absolute;
      top: 100%;
      left: 0;
      background: #252526;
      border: 1px solid #3c3c3c;
      display: none;
      min-width: 180px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 1000;
    `

    items.forEach(item => {
      if (item.label === '-') {
        const separator = document.createElement('div')
        separator.style.cssText = 'height: 1px; background: #3c3c3c; margin: 4px 0;'
        dropdown.appendChild(separator)
        return
      }

      const dropdownItem = document.createElement('div')
      dropdownItem.textContent = item.label
      dropdownItem.style.cssText = `
        padding: 6px 12px;
        cursor: pointer;
        color: #cccccc;
        font-size: 13px;
      `

      dropdownItem.addEventListener('mouseenter', () => dropdownItem.style.background = '#37373d')
      dropdownItem.addEventListener('mouseleave', () => dropdownItem.style.background = 'transparent')

      if (item.action) {
        dropdownItem.addEventListener('click', async () => {
          await item.action?.()
          dropdown.style.display = 'none'
          activeDropdown = null
        })
      }
      
      dropdown.appendChild(dropdownItem)
    })

    menuItem.addEventListener('click', (e) => {
      e.stopPropagation()
      if (activeDropdown && activeDropdown !== dropdown) {
        activeDropdown.style.display = 'none'
      }
      const isVisible = dropdown.style.display === 'block'
      dropdown.style.display = isVisible ? 'none' : 'block'
      activeDropdown = isVisible ? null : dropdown
    })

    menuItem.addEventListener('mouseenter', () => menuItem.style.background = '#37373d')
    menuItem.addEventListener('mouseleave', () => menuItem.style.background = 'transparent')

    menuItemContainer.appendChild(menuItem)
    menuItemContainer.appendChild(dropdown)
    return menuItemContainer
  }

  const fileMenu = createMenuItem('File', [
    {
      label: 'Save',
      action: async () => {
        await kernel.filesystem.fs.writeFile(file, editor.getValue())
        kernel.toast.success('File saved')
      }
    },
    { label: '-' },
    {
      label: 'Exit',
      action: () => {
        win.close()
      }
    }
  ])

  const editMenu = createMenuItem('Edit', [
    {
      label: 'Undo',
      action: () => editor.trigger('menu', 'undo', null)
    },
    {
      label: 'Redo',
      action: () => editor.trigger('menu', 'redo', null)
    },
    { label: '-' },
    {
      label: 'Cut',
      action: () => editor.trigger('menu', 'cut', null)
    },
    {
      label: 'Copy',
      action: () => editor.trigger('menu', 'copy', null)
    },
    {
      // TODO: Fix paste
      label: 'Paste',
      action: () => editor.trigger('source', 'paste', null)
    }
  ])

  menuBar.appendChild(fileMenu)
  menuBar.appendChild(editMenu)
  return menuBar
}

const main = async (params: ProcessEntryParams) => {
  const { args, kernel, shell, terminal } = params
  const file = args?.[0] ? path.resolve(shell.cwd, args[0]) : path.resolve(shell.cwd, 'Untitled.txt')
  if (!file) { terminal.writeln('Usage: code <file>'); return 1 }

  try { await kernel.filesystem.fs.mkdir(path.dirname(file), { recursive: true }) } catch {}
  await shell.execute(`touch ${file}`)

  const value = await kernel.filesystem.fs.readFile(file, 'utf-8')
  let language = 'plaintext'

  const extension = file.split('.').pop() || ''
  const languages = monaco.languages.getLanguages()
  
  for (const lang of languages) {
    if (lang.extensions?.includes(`.${extension}`)) { language = lang.id; break }
  }

  const container = document.createElement('div')
  container.style.width = '100%'
  container.style.height = '100%'
  container.style.display = 'flex'
  container.style.flexDirection = 'column'

  const editorContainer = document.createElement('div')
  editorContainer.style.flex = '1'

  const icon = await import('./icon.png?inline')
  const win = await kernel.windows.create({
    title: `Code Editor - ${file}`,
    width: Math.floor(window.innerWidth * 0.75),
    height: Math.floor(window.innerHeight * 0.75),
    icon: icon.default,
    class: styles.window
  })

  const editor = monaco.editor.create(editorContainer, {
    value,
    language,
    theme: 'vs-dark',
    automaticLayout: true
  })

  const menuBar = createMenuBar(win, editor, params, file)
  container.appendChild(menuBar)
  container.appendChild(editorContainer)

  win.mount(container)
  globalThis.editor = editor
  editor.focus()

  container.addEventListener('keydown', async (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault()
      await kernel.filesystem.fs.writeFile(file, editor.getValue())
      kernel.toast.success('File saved')
    }
  })

  return 0
}

export default main
