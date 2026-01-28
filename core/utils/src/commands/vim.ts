import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: vim [OPTION]... [FILE]...
Vi IMproved - a text editor.

  FILE                    file(s) to edit
  --help, -h              display this help and exit

Examples:
  vim file.txt            edit file.txt
  vim file1.txt file2.txt edit multiple files`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'vim',
    description: 'Vi IMproved - a text editor',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (!process) return 1

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      try {
        const { VimWasm, checkBrowserCompatibility } = await import('vim-wasm/vimwasm.js')

        const compatibilityError = checkBrowserCompatibility()
        if (compatibilityError !== undefined) {
          await writelnStderr(process, terminal, `vim: ${compatibilityError}`)
          return 1
        }

        const files: string[] = []
        for (const arg of argv) {
          if (arg && !arg.startsWith('-')) {
            files.push(arg)
          }
        }

        if (files.length === 0) {
          await writelnStderr(process, terminal, 'vim: no file specified')
          await writelnStderr(process, terminal, "Try 'vim --help' for more information.")
          return 1
        }

        const fileContents: Record<string, string> = {}
        const dirs = new Set<string>()
        const cmdArgs: string[] = []

        const cwd = shell.cwd
        let currentCwd = cwd
        while (currentCwd !== '/' && currentCwd !== '') {
          dirs.add(currentCwd)
          currentCwd = path.dirname(currentCwd)
        }
        
        const homeDir = shell.expandTilde('~')
        if (homeDir && homeDir !== '~') {
          let currentDir = homeDir
          while (currentDir !== '/' && currentDir !== '') {
            dirs.add(currentDir)
            currentDir = path.dirname(currentDir)
          }

          const vimrcPath = path.join(homeDir, '.vim', 'vimrc')
          const vimrcExists = await shell.context.fs.promises.exists(vimrcPath)
          if (vimrcExists) {
            const vimrcContent = await shell.context.fs.promises.readFile(vimrcPath, 'utf-8')
            const vimrcVirtualPath = '/home/web_user/.vim/vimrc'
            fileContents[vimrcVirtualPath] = vimrcContent
          }
        }

        for (const file of files) {
          const expandedPath = shell.expandTilde(file)
          const fullPath = path.resolve(shell.cwd, expandedPath)

          const exists = await shell.context.fs.promises.exists(fullPath)

          if (exists) {
            const stats = await shell.context.fs.promises.stat(fullPath)
            if (stats.isDirectory()) {
              await writelnStderr(process, terminal, `vim: ${file}: Is a directory`)
              return 1
            }

            const content = await shell.context.fs.promises.readFile(fullPath, 'utf-8')
            fileContents[fullPath] = content
          } else {
            fileContents[fullPath] = ''
          }

          const dir = path.dirname(fullPath)
          let currentDir = dir
          while (currentDir !== '/' && currentDir !== '') {
            dirs.add(currentDir)
            currentDir = path.dirname(currentDir)
          }

          cmdArgs.push(fullPath)
        }

        const emscriptenDefaultDirs = new Set(['/', '/tmp', '/home', '/home/web_user', '/home/web_user/.vim', '/dev'])
        const dirsArray = Array.from(dirs)
          .filter(d => !emscriptenDefaultDirs.has(d))
          .sort((a, b) => a.length - b.length)

        const container = document.createElement('div')
        container.style.width = '100%'
        container.style.height = '100%'
        container.style.display = 'flex'
        container.style.flexDirection = 'column'
        container.style.background = '#1e1e1e'
        container.style.overflow = 'hidden'

        const canvas = document.createElement('canvas')
        canvas.id = 'vim-canvas'
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.flex = '1'

        const input = document.createElement('input')
        input.id = 'vim-input'
        input.type = 'text'
        input.autocomplete = 'off'
        input.autofocus = true
        input.style.position = 'absolute'
        input.style.left = '-9999px'
        input.style.width = '1px'
        input.style.height = '1px'
        input.style.opacity = '0'

        container.appendChild(canvas)
        container.appendChild(input)

        const firstFile = files.length > 0 ? files[0] : undefined
        const windowTitle = firstFile ? path.basename(firstFile) : 'vim'
        const win = kernel.windows.create({
          title: windowTitle,
          width: 900,
          height: 700,
          max: false
        })

        win.mount(container)

        let workerScriptPath: string
        try {
          workerScriptPath = new URL('vim-wasm/vim.js', import.meta.url).href
        } catch {
          await writelnStderr(process, terminal, 'vim: failed to resolve worker script path. Please ensure vim-wasm is properly installed.')
          win.close()
          return 1
        }

        const vim = new VimWasm({
          canvas,
          input,
          workerScriptPath
        })

        let exitCode = 0
        let vimExited = false
        let resizeObserver: ResizeObserver | null = null

        vim.onFileExport = async (fullpath: string, contents: ArrayBuffer) => {
          try {
            const text = new TextDecoder().decode(contents)
            await shell.context.fs.promises.writeFile(fullpath, text, 'utf-8')
          } catch (error) {
            await writelnStderr(process, terminal, `vim: error writing file ${fullpath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        vim.onVimExit = (status: number) => {
          vimExited = true
          exitCode = status === 0 ? 0 : 1
          if (resizeObserver) {
            resizeObserver.disconnect()
            resizeObserver = null
          }
          win.close()
        }

        vim.onError = async (err: Error) => {
          console.error('[vim] Error callback triggered:', err)
          console.error('[vim] Error message:', err.message)
          console.error('[vim] Error stack:', err.stack)
          await writelnStderr(process, terminal, `vim: error: ${err.message}`)
          if (!vimExited) {
            exitCode = 1
            if (resizeObserver) {
              resizeObserver.disconnect()
              resizeObserver = null
            }
            win.close()
          }
        }

        vim.onTitleUpdate = (title: string) => {
          win.setTitle(title || windowTitle)
        }

        vim.onVimInit = async () => {
          try {
            await vim.cmdline('autocmd BufWritePost * :export')
          } catch (error) {
            console.error('[vim] Failed to set up auto-export:', error)
          }

          const handleResize = () => {
            if (vimExited || !vim.isRunning()) return
            
            const rect = container.getBoundingClientRect()
            const width = Math.floor(rect.width)
            const height = Math.floor(rect.height)
            
            if (width > 0 && height > 0) {
              const dpr = window.devicePixelRatio || 1
              canvas.width = width * dpr
              canvas.height = height * dpr
              
              vim.resize(width, height)
            }
          }

          resizeObserver = new ResizeObserver(handleResize)
          resizeObserver.observe(container)
        }

        for (const filePath of Object.keys(fileContents)) {
          const parentDir = path.dirname(filePath)
          if (!dirsArray.includes(parentDir)) {
            console.warn(`[vim] WARNING: Parent directory ${parentDir} of file ${filePath} is not in dirs array!`)
          }
          if (dirsArray.includes(filePath)) {
            console.error(`[vim] ERROR: File path ${filePath} is also in dirs array! This will cause ENOTDIR error.`)
          }
        }
        
        for (const dirPath of dirsArray) {
          if (fileContents[dirPath] !== undefined) {
            console.error(`[vim] ERROR: Directory path ${dirPath} is also in files object! This will cause ENOTDIR error.`)
          }
        }
        
        for (let i = 0; i < dirsArray.length; i++) {
          const dir = dirsArray[i]
          if (dir) {
            const parent = path.dirname(dir)
            if (parent !== dir && !dirsArray.slice(0, i).includes(parent)) {
              console.warn(`[vim] WARNING: Directory ${dir} has parent ${parent} that comes after it in the array!`)
            }
          }
        }

        try {
          const startOptions = {
            files: fileContents,
            dirs: dirsArray,
            cmdArgs,
            debug: false
          }
          
          vim.start(startOptions)
        } catch (startError) {
          console.error('[vim] Error calling vim.start():', startError)
          await writelnStderr(process, terminal, `vim: failed to start: ${startError instanceof Error ? startError.message : 'Unknown error'}`)
          if (startError instanceof Error && startError.stack) {
            console.error('[vim] Start error stack:', startError.stack)
          }
          win.close()
          return 1
        }

        return new Promise<number>((resolve) => {
          const checkExit = () => {
            if (vimExited) {
              resolve(exitCode)
            } else {
              setTimeout(checkExit, 100)
            }
          }
          checkExit()
        })
      } catch (error) {
        await writelnStderr(process, terminal, `vim: ${error instanceof Error ? error.message : 'Unknown error'}`)
        if (error instanceof Error && error.stack) {
          console.error(error.stack)
        }
        return 1
      }
    }
  })
}
