import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: web [OPTIONS] [URL]
Open a URL in a new contained window.
Many sites will block the COR, so this is mostly useful for local/bespoke/credentialless resources.
To open in a new tab/browser window, use the 'open' command instead.

  --help                               display this help and exit
  --no-navbar                          hide the navigation bar

Examples:
  web https://example.com              open a URL in a browser window
  web --no-navbar https://example.com  open a URL without navigation bar
  web example.com                      open a URL (https:// will be prepended)
  web http://example.com               open a URL with http protocol`
  writelnStderr(process, terminal, usage)
}

function normalizeUrl(url: string): string {
  const urlPattern = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
  if (urlPattern.test(url)) return url

  return `https://${url}`
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'web',
    description: 'Open a URL in a browser window',
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

      // Parse arguments
      let hideNavbar = false
      const urlArgs: string[] = []

      for (const arg of argv) {
        const trimmedArg = arg.trim()
        if (trimmedArg === '--no-navbar' || trimmedArg === '--hide-navbar') {
          hideNavbar = true
        } else if (trimmedArg && trimmedArg !== '--help' && trimmedArg !== '-h') {
          // Remove any flag prefixes that might have been concatenated
          let cleanArg = trimmedArg
          if (cleanArg.startsWith('--no-navbar')) {
            cleanArg = cleanArg.replace(/^--no-navbar/, '').trim()
            hideNavbar = true
          } else if (cleanArg.startsWith('--hide-navbar')) {
            cleanArg = cleanArg.replace(/^--hide-navbar/, '').trim()
            hideNavbar = true
          }
          if (cleanArg) {
            urlArgs.push(cleanArg)
          }
        }
      }

      if (urlArgs.length === 0) {
        await writelnStderr(process, terminal, `web: missing URL argument`)
        await writelnStderr(process, terminal, `Try 'web --help' for more information.`)
        return 1
      }

      const urlString = urlArgs.join(' ').trim()
      if (!urlString) {
        await writelnStderr(process, terminal, `web: missing URL argument`)
        return 1
      }

      const url = normalizeUrl(urlString)

      try {
        // Validate URL
        new URL(url)
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`web: invalid URL: ${urlString}`))
        return 1
      }

      // Create container for browser UI
      const container = document.createElement('div')
      container.style.width = '100%'
      container.style.height = '100%'
      container.style.display = 'flex'
      container.style.flexDirection = 'column'
      container.style.background = '#fff'
      container.style.overflow = 'hidden'
      container.style.boxSizing = 'border-box'

      // Create navigation bar
      const navBar = document.createElement('div')
      navBar.style.display = 'flex'
      navBar.style.alignItems = 'center'
      navBar.style.gap = '4px'
      navBar.style.padding = '6px 8px'
      navBar.style.borderBottom = '1px solid #ccc'
      navBar.style.background = '#f5f5f5'
      navBar.style.flexShrink = '0'
      navBar.style.boxSizing = 'border-box'

      // Back button
      const backButton = document.createElement('button')
      backButton.innerHTML = '←'
      backButton.style.padding = '0'
      backButton.style.margin = '0'
      backButton.style.cursor = 'pointer'
      backButton.style.border = '1px solid #ccc'
      backButton.style.borderRadius = '4px'
      backButton.style.background = '#fff'
      backButton.style.color = '#000'
      backButton.style.fontSize = '16px'
      backButton.style.width = '32px'
      backButton.style.height = '28px'
      backButton.style.display = 'flex'
      backButton.style.alignItems = 'center'
      backButton.style.justifyContent = 'center'
      backButton.style.flexShrink = '0'
      backButton.style.boxSizing = 'border-box'
      backButton.style.lineHeight = '1'
      backButton.style.verticalAlign = 'middle'
      backButton.disabled = true
      backButton.style.opacity = backButton.disabled ? '0.5' : '1'

      // Forward button
      const forwardButton = document.createElement('button')
      forwardButton.innerHTML = '→'
      forwardButton.style.padding = '0'
      forwardButton.style.margin = '0'
      forwardButton.style.cursor = 'pointer'
      forwardButton.style.border = '1px solid #ccc'
      forwardButton.style.borderRadius = '4px'
      forwardButton.style.background = '#fff'
      forwardButton.style.color = '#000'
      forwardButton.style.fontSize = '16px'
      forwardButton.style.width = '32px'
      forwardButton.style.height = '28px'
      forwardButton.style.display = 'flex'
      forwardButton.style.alignItems = 'center'
      forwardButton.style.justifyContent = 'center'
      forwardButton.style.flexShrink = '0'
      forwardButton.style.boxSizing = 'border-box'
      forwardButton.style.lineHeight = '1'
      forwardButton.style.verticalAlign = 'middle'
      forwardButton.disabled = true
      forwardButton.style.opacity = forwardButton.disabled ? '0.5' : '1'

      // URL input
      const urlInput = document.createElement('input')
      urlInput.type = 'text'
      urlInput.value = url
      urlInput.style.flex = '1'
      urlInput.style.minWidth = '0'
      urlInput.style.padding = '6px 12px'
      urlInput.style.border = '1px solid #ccc'
      urlInput.style.borderRadius = '4px'
      urlInput.style.fontSize = '14px'
      urlInput.style.height = '28px'
      urlInput.style.boxSizing = 'border-box'
      urlInput.style.margin = '0'
      urlInput.style.verticalAlign = 'middle'

      // Refresh button
      const refreshButton = document.createElement('button')
      refreshButton.innerHTML = '↻'
      refreshButton.style.padding = '0'
      refreshButton.style.margin = '0'
      refreshButton.style.cursor = 'pointer'
      refreshButton.style.border = '1px solid #ccc'
      refreshButton.style.borderRadius = '4px'
      refreshButton.style.background = '#fff'
      refreshButton.style.color = '#000'
      refreshButton.style.fontSize = '16px'
      refreshButton.style.width = '32px'
      refreshButton.style.height = '28px'
      refreshButton.style.display = 'flex'
      refreshButton.style.alignItems = 'center'
      refreshButton.style.justifyContent = 'center'
      refreshButton.style.flexShrink = '0'
      refreshButton.style.boxSizing = 'border-box'
      refreshButton.style.lineHeight = '1'
      refreshButton.style.verticalAlign = 'middle'

      navBar.appendChild(backButton)
      navBar.appendChild(forwardButton)
      navBar.appendChild(urlInput)
      navBar.appendChild(refreshButton)

      const iframeContainer = document.createElement('div')
      iframeContainer.style.flex = '1'
      iframeContainer.style.position = 'relative'
      iframeContainer.style.overflow = 'hidden'

      const iframe = document.createElement('iframe')
      iframe.style.width = '100%'
      iframe.style.height = '100%'
      iframe.style.border = 'none'
      iframe.setAttribute('credentialless', '')
      iframe.src = url

      iframeContainer.appendChild(iframe)
      
      // Only append navbar if not hidden
      if (!hideNavbar) container.appendChild(navBar)
      container.appendChild(iframeContainer)

      // Navigation history
      const history: string[] = [url]
      let historyIndex = 0

      // Update navigation buttons state
      const updateNavButtons = () => {
        if (!hideNavbar) {
          backButton.disabled = historyIndex <= 0
          backButton.style.opacity = backButton.disabled ? '0.5' : '1'
          forwardButton.disabled = historyIndex >= history.length - 1
          forwardButton.style.opacity = forwardButton.disabled ? '0.5' : '1'
        }
      }

      // Navigate to URL
      const navigateTo = (targetUrl: string, addToHistory = true) => {
        try {
          const normalizedUrl = normalizeUrl(targetUrl)
          new URL(normalizedUrl) // Validate URL

          if (addToHistory) {
            // Remove forward history if we're navigating to a new URL
            if (historyIndex < history.length - 1) history.splice(historyIndex + 1)

            history.push(normalizedUrl)
            historyIndex = history.length - 1
          }

          iframe.src = normalizedUrl
          if (!hideNavbar) {
            urlInput.value = normalizedUrl
          }
          updateNavButtons()
        } catch (error) {
          terminal.writeln(chalk.red(`Invalid URL: ${targetUrl}`))
        }
      }

      // Only set up button handlers if navbar is visible
      if (!hideNavbar) {
        // Add hover effects
        const addHoverEffect = (button: HTMLButtonElement) => {
          button.addEventListener('mouseenter', () => {
            if (!button.disabled) {
              button.style.background = '#f0f0f0'
            }
          })
          button.addEventListener('mouseleave', () => {
            button.style.background = '#fff'
          })
        }
        addHoverEffect(backButton)
        addHoverEffect(forwardButton)
        addHoverEffect(refreshButton)

        // Back button handler
        backButton.addEventListener('click', () => {
          if (historyIndex > 0) {
            historyIndex--
            const targetUrl = history[historyIndex]
            if (targetUrl) {
              iframe.src = targetUrl
              urlInput.value = targetUrl
              updateNavButtons()
            }
          }
        })

        // Forward button handler
        forwardButton.addEventListener('click', () => {
          if (historyIndex < history.length - 1) {
            historyIndex++
            const targetUrl = history[historyIndex]
            if (targetUrl) {
              iframe.src = targetUrl
              urlInput.value = targetUrl
              updateNavButtons()
            }
          }
        })
      }

      // Only set up navbar event handlers if navbar is visible
      if (!hideNavbar) {
        // URL input handler (Enter key or blur)
        const handleUrlSubmit = () => {
          const inputValue = urlInput.value.trim()
          if (inputValue) {
            navigateTo(inputValue)
          }
        }

        urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleUrlSubmit()
          }
        })

        urlInput.addEventListener('blur', handleUrlSubmit)

        // Refresh button handler
        refreshButton.addEventListener('click', () => {
          iframe.src = iframe.src
        })

        // Update URL bar when iframe navigates (for same-origin or when possible)
        iframe.addEventListener('load', () => {
          try {
            // Try to get the current URL from iframe (may fail due to CORS)
            const iframeUrl = iframe.contentWindow?.location.href
            if (iframeUrl && iframeUrl !== urlInput.value) {
              urlInput.value = iframeUrl
              // Only add to history if it's a different URL
              if (iframeUrl !== history[historyIndex]) navigateTo(iframeUrl)
            }
          } catch (e) {
            // CORS: Can't access iframe location, that's okay
            // The URL bar will show what we set it to
          }
          updateNavButtons()
        })
      } else {
        // Still track history even without navbar
        iframe.addEventListener('load', () => {
          try {
            const iframeUrl = iframe.contentWindow?.location.href
            if (iframeUrl && iframeUrl !== history[historyIndex]) {
              navigateTo(iframeUrl, true)
            }
          } catch (e) {
            // CORS: Can't access iframe location
          }
        })
      }

      // Create window
      const win = kernel.windows.create({
        title: url,
        width: Math.floor(window.innerWidth * 0.75),
        height: Math.floor(window.innerHeight * 0.75),
        x: 'center',
        y: 'center',
        onclose: () => false
      })

      // Mount container to window
      win.mount(container)

      // Update window title when URL changes (only if navbar is visible)
      if (!hideNavbar) {
        const updateTitle = () => win.setTitle(urlInput.value)
        urlInput.addEventListener('input', updateTitle)
      }

      return 0
    }
  })
}
