import ansi from 'ansi-escape-sequences'
import path from 'path'

import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import type { IDisposable } from '@xterm/xterm'

import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

interface PackagePath {
  scope?: string
  package: string
  topic?: string
}

interface Metadata {
  [key: string]: unknown
}

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: man [OPTION]... [@scope/]package[/topic[/subtopic...]]
Display manual pages.

  -l, --list    list available topics for a package
  --where PATH  override default documentation path
  --help        display this help and exit

Examples:
  man package-name               display index for package-name
  man @scope/package             display index for @scope/package
  man -l @scope/package          list topics for @scope/package
  man package-name/topic         display topic from package-name
  man @scope/package/docs        display docs/index from @scope/package`
  writelnStderr(process, terminal, usage)
}

function resolveManPath(shell: Shell, whereArg?: string): string[] {
  if (whereArg) return [whereArg]

  const manpath = shell.env.get('MANPATH')
  if (manpath) return manpath.split(':').filter(p => p.length > 0)

  return ['/usr/share/docs']
}

function parsePackagePath(pathStr: string): PackagePath | null {
  if (!pathStr || pathStr.length === 0) return null

  const parts = pathStr.split('/')
  if (parts.length === 0) return null

  if (parts[0]?.startsWith('@')) {
    if (parts.length === 1) return null
    const firstPart = parts[0]
    const packageName = parts[1]
    if (!firstPart || !packageName) return null
    const scope = firstPart.slice(1)
    const topic = parts.length > 2 ? parts.slice(2).join('/') : undefined
    return { scope, package: packageName, topic }
  } else {
    const packageName = parts[0]
    if (!packageName) return null
    const topic = parts.length > 1 ? parts.slice(1).join('/') : undefined
    return { package: packageName, topic }
  }
}

function buildPackagePath(manpath: string, pkgPath: PackagePath): string {
  if (pkgPath.scope) return path.join(manpath, `@${pkgPath.scope}`, pkgPath.package)
  return path.join(manpath, pkgPath.package)
}

async function findDocument(
  fs: Shell['context']['fs'],
  packageDir: string,
  topic?: string
): Promise<string | null> {
  const extensions = ['.md', '.txt', '.html']
  const baseName = topic || 'index'

  // First, check for a file with the topic name directly
  for (const ext of extensions) {
    const filePath = path.join(packageDir, `${baseName}${ext}`)
    if (await fs.promises.exists(filePath)) return filePath
  }

  // If topic contains a path or is a directory, look for index files in that directory
  if (topic) {
    const topicDir = path.join(packageDir, topic)
    try {
      const stat = await fs.promises.stat(topicDir)
      if (stat.isDirectory()) {
        for (const ext of extensions) {
          const indexPath = path.join(topicDir, `index${ext}`)
          if (await fs.promises.exists(indexPath)) return indexPath
        }
      }
    } catch {
      // Directory doesn't exist, continue
    }
  }

  return null
}

async function listTopics(
  fs: Shell['context']['fs'],
  packageDir: string,
  prefix: string = ''
): Promise<string[]> {
  const topics: string[] = []
  
  try {
    if (!(await fs.promises.exists(packageDir))) return topics

    const entries = await fs.promises.readdir(packageDir)
    
    for (const entry of entries) {
      if (entry === 'metadata.json' || entry === 'index.md' || entry === 'index.txt' || entry === 'index.html') {
        continue
      }

      const fullPath = path.join(packageDir, entry)
      const stat = await fs.promises.stat(fullPath)
      
      if (stat.isFile()) {
        const ext = path.extname(entry)
        if (ext === '.md' || ext === '.txt' || ext === '.html') {
          const baseName = path.basename(entry, ext)
          if (baseName && baseName !== 'index') {
            topics.push(prefix ? `${prefix}/${baseName}` : baseName)
          }
        }
      } else if (stat.isDirectory()) {
        // Check if subdirectory has an index file (making it a valid topic)
        const subDir = fullPath
        const hasIndex = await fs.promises.exists(path.join(subDir, 'index.md')) ||
                         await fs.promises.exists(path.join(subDir, 'index.txt')) ||
                         await fs.promises.exists(path.join(subDir, 'index.html'))
        
        if (hasIndex) {
          const topicName = prefix ? `${prefix}/${entry}` : entry
          topics.push(topicName)
        }
        
        // Recursively list topics in subdirectory
        const subTopics = await listTopics(fs, subDir, prefix ? `${prefix}/${entry}` : entry)
        topics.push(...subTopics)
      }
    }
  } catch {
  }

  return topics.sort()
}

async function parseMetadata(
  fs: Shell['context']['fs'],
  packageDir: string
): Promise<Metadata | null> {
  const metadataPath = path.join(packageDir, 'metadata.json')
  
  try {
    if (await fs.promises.exists(metadataPath)) {
      const content = await fs.promises.readFile(metadataPath, 'utf-8')
      return JSON.parse(content) as Metadata
    }
  } catch {}

  return null
}

function convertMarkdownToText(
  content: string,
  _currentPackage?: PackagePath,
  _currentManpath?: string
): string {
  let result = content

  // Strip HTML comments: <!-- ... -->
  // - Safe: Processed first to remove comments before any other processing
  // - Safe: Uses non-greedy match to handle multiple comments
  // - Safe: Can span multiple lines
  result = result.replace(/<!--[\s\S]*?-->/g, '')

  // Process code blocks FIRST to avoid processing markdown inside them
  // Code blocks: /^```[\s\S]*?^```/gm
  // - Pattern matches fenced code blocks (```...```)
  // - Uses non-greedy match to handle multiple code blocks
  // - Replace with placeholders that won't match any markdown patterns
  const codeBlockPlaceholders: string[] = []
  result = result.replace(/^```[\s\S]*?^```/gm, (match) => {
    const code = match.replace(/^```[^\n]*\n/, '').replace(/\n```$/, '')
    const formatted = '\n' + code.split('\n').map(line => '  ' + line).join('\n') + '\n'
    const placeholder = `__CODE_BLOCK_${codeBlockPlaceholders.length}__`
    codeBlockPlaceholders.push(formatted)
    return placeholder
  })

  // Headings: /^(#{1,6})\s+(.+)$/gm
  // - Safe: Uses ^ and $ with m flag (line anchors)
  // - Safe: Requires whitespace after # characters
  // - Safe: Won't match inside code blocks (already replaced with placeholders)
  result = result.replace(/^(#{1,6})\s+(.+)$/gm, (_match, hashes, text) => {
    const level = hashes.length
    if (level === 1) return ansi.format(text, ['bold', 'underline']) + '\n'
    else if (level === 2) return ansi.format(text, ['bold']) + '\n'
    else return ansi.format(text, ['bold']) + '\n'
  })

  // Inline code: /`([^`]+)`/g
  // - Safe: Processed after code blocks, so won't match inside code blocks
  // - Safe: [^`]+ ensures it won't match empty content
  // - Safe: Won't match across lines (backticks must be on same line)
  // - Safe: Processed early to protect code snippets from other markdown
  result = result.replace(/`([^`]+)`/g, (_, code) => ansi.format(code, ['cyan']))

  // Restore code blocks
  for (let i = 0; i < codeBlockPlaceholders.length; i++) {
    const placeholder = codeBlockPlaceholders[i]
    if (placeholder) {
      result = result.replace(`__CODE_BLOCK_${i}__`, placeholder)
    }
  }

  // Bold text: /\*\*(.+?)\*\*/g
  // - Safe: Processed after code blocks, so won't match inside code blocks
  // - Safe: Non-greedy (.+?) ensures it matches the shortest valid bold text
  // - Safe: Requires at least one character between ** (won't match empty)
  // - Safe: Processed BEFORE italic to avoid conflicts
  // - Note: Can match inside headings (e.g., "## **Bold Heading**") which is valid markdown
  result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => ansi.format(text, ['bold']))

  // Italic text: /\*(?![*])(.+?)\*/g
  // - Safe: Processed after code blocks and bold, so won't match inside code blocks or **bold**
  // - Safe: Negative lookahead (?![*]) ensures it doesn't match if followed by *
  // - Safe: Non-greedy (.+?) ensures it matches the shortest valid italic text
  // - Safe: Requires at least one character between * (won't match empty)
  // - Safe: Can match inside bold text (e.g., "**bold *italic* bold**") which is valid markdown
  // - Note: Using 'gray' color since many terminals don't render italic styling visibly
  result = result.replace(/\*(?![*])(.+?)\*/g, (_, text) => ansi.format(text, ['gray']))


  // URLs: Color any URLs (http://, https://, mailto:) as blue
  // - Safe: Processed after code blocks, so won't match inside code blocks
  // - Safe: Matches common URL patterns, stops at whitespace or common punctuation
  // - Safe: Won't match URLs that are already inside formatted text (escape sequences)
  // - Note: Pattern excludes trailing punctuation like ), ], but allows . (periods are valid in URLs)
  const urlPattern = /(https?:\/\/[^\s<>"',;!)\]\)]+|mailto:[^\s<>"',;!)\]\)]+)/gi
  result = result.replace(urlPattern, (url) => {
    return ansi.format(url, ['blue'])
  })

  return result
}

function convertHtmlToText(
  content: string,
  _currentPackage?: PackagePath,
  _currentManpath?: string
): string {
  let result = content

  // Strip HTML comments: <!-- ... -->
  result = result.replace(/<!--[\s\S]*?-->/g, '')

  // Strip head, style, script, nav, footer tags and their content
  result = result.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  result = result.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  result = result.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
  result = result.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')

  // Add line breaks before/after block elements
  result = result.replace(/<br\s*\/?>/gi, '\n')
  result = result.replace(/<\/p>/gi, '\n\n')
  result = result.replace(/<\/div>/gi, '\n')
  result = result.replace(/<\/li>/gi, '\n')
  result = result.replace(/<\/tr>/gi, '\n')
  result = result.replace(/<hr[^>]*>/gi, '\n---\n')

  // List items - add bullet
  result = result.replace(/<li[^>]*>/gi, '  • ')

  result = result.replace(/<h1[^>]*>(.*?)<\/h1>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['bold', 'underline']) + '\n'
  })

  result = result.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['bold']) + '\n'
  })

  result = result.replace(/<h[3-6][^>]*>(.*?)<\/h[3-6]>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['bold']) + '\n'
  })

  result = result.replace(/<strong[^>]*>(.*?)<\/strong>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['bold'])
  })

  result = result.replace(/<b[^>]*>(.*?)<\/b>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['bold'])
  })

  result = result.replace(/<em[^>]*>(.*?)<\/em>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['gray'])
  })

  result = result.replace(/<i[^>]*>(.*?)<\/i>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['gray'])
  })

  result = result.replace(/<code[^>]*>(.*?)<\/code>/gi, (_, text) => {
    return ansi.format(text.replace(/<[^>]+>/g, ''), ['cyan'])
  })

  result = result.replace(/<pre[^>]*>(.*?)<\/pre>/gis, (_, text) => {
    const code = text.replace(/<[^>]+>/g, '')
    return '\n' + code.split('\n').map((line: string) => '  ' + line).join('\n') + '\n'
  })

  result = result.replace(/<[^>]+>/g, '')

  // Decode HTML entities
  result = result.replace(/&nbsp;/g, ' ')
  result = result.replace(/&lt;/g, '<')
  result = result.replace(/&gt;/g, '>')
  result = result.replace(/&amp;/g, '&')
  result = result.replace(/&quot;/g, '"')
  result = result.replace(/&#39;/g, "'")
  result = result.replace(/&#x27;/g, "'")
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))

  // Clean up whitespace
  result = result.replace(/[ \t]+/g, ' ')
  result = result.replace(/\n[ \t]+/g, '\n')
  result = result.replace(/[ \t]+\n/g, '\n')
  result = result.replace(/\n{3,}/g, '\n\n')
  result = result.trim()

  // URLs: Color any URLs (http://, https://, mailto:) as blue
  const urlPattern = /(https?:\/\/[^\s<>"',;:!?)\]\)]+|mailto:[^\s<>"',;:!?)\]\)]+)/gi
  result = result.replace(urlPattern, (url) => {
    return ansi.format(url, ['blue'])
  })

  return result
}

async function displayManPage(
  terminal: Terminal,
  content: string,
  documentName: string
): Promise<void> {
  const lines = content.split('\n')
  let currentLine = 0
  let horizontalOffset = 0
  let keyListener: IDisposable | null = null
  let linesRendered = 0

  terminal.unlisten()
  terminal.write('\n')
  terminal.write(ansi.cursor.hide)

  const rows = terminal.rows
  const displayRows = rows - 1

  const render = () => {
    const cols = terminal.cols
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    
    const getVisibleSlice = (line: string, offset: number): string => {
      const visibleLen = stripAnsi(line).length
      
      if (offset < 0) offset = 0
      if (offset > visibleLen) offset = visibleLen
      
      let visible = 0
      let result = ''
      let inEscape = false
      let charsSkipped = 0
      
      for (const char of line) {
        if (char === '\x1b') inEscape = true
        if (inEscape) {
          if (charsSkipped >= offset) {
            result += char
          }
          if (/[a-zA-Z]/.test(char)) inEscape = false
        } else {
          if (charsSkipped < offset) {
            charsSkipped++
          } else {
            if (visible >= cols) break
            result += char
            visible++
          }
        }
      }
      return result
    }

    const maxLine = Math.max(0, lines.length - displayRows)
    if (currentLine > maxLine) currentLine = maxLine
    if (currentLine < 0) currentLine = 0

    const maxLineLength = Math.max(...lines.map(l => stripAnsi(l).length), 0)
    const maxHorizontalOffset = Math.max(0, maxLineLength - cols)
    if (horizontalOffset > maxHorizontalOffset) horizontalOffset = maxHorizontalOffset
    if (horizontalOffset < 0) horizontalOffset = 0

    if (linesRendered > 0) {
      terminal.write(ansi.cursor.up(linesRendered))
      terminal.write('\r')
    }

    const endLine = Math.min(currentLine + displayRows, lines.length)
    linesRendered = 0
    
    for (let i = currentLine; i < endLine; i++) {
      terminal.write(ansi.erase.inLine(2))
      const line = getVisibleSlice(lines[i] || '', horizontalOffset)
      terminal.write(line)
      linesRendered++
      if (i < endLine - 1) terminal.write('\n')
    }

    for (let i = endLine - currentLine; i < displayRows; i++) {
      terminal.write('\n')
      terminal.write(ansi.erase.inLine(2))
      linesRendered++
    }

    const percentage = lines.length > 0 ? Math.round(((endLine / lines.length) * 100)) : 100
    const statusLine = `-- ${documentName} ${currentLine + 1}-${endLine} / ${lines.length} (${percentage}%)`
    terminal.write('\n')
    terminal.write(ansi.erase.inLine(2))
    terminal.write(getVisibleSlice(statusLine, 0))
    linesRendered++
  }

  render()

  await new Promise<void>((resolve) => {
    keyListener = terminal.onKey(async ({ domEvent }) => {
      const keyName = domEvent.key

      switch (keyName) {
        case 'q':
        case 'Q':
        case 'Escape':
          if (keyListener) {
            keyListener.dispose()
            keyListener = null
          }
          terminal.write(ansi.cursor.show)
          terminal.write('\n')
          terminal.listen()
          resolve()
          return
        case 'ArrowUp':
          if (currentLine > 0) {
            currentLine--
            render()
          }
          break
        case 'ArrowDown':
        case 'Enter':
          currentLine++
          render()
          break
        case 'ArrowLeft':
          horizontalOffset = Math.max(0, horizontalOffset - Math.floor(terminal.cols / 2))
          render()
          break
        case 'ArrowRight':
          horizontalOffset += Math.floor(terminal.cols / 2)
          render()
          break
        case 'PageDown':
        case ' ':
          currentLine = Math.min(currentLine + displayRows, Math.max(0, lines.length - displayRows))
          render()
          break
        case 'PageUp':
        case 'b':
        case 'B':
          currentLine = Math.max(0, currentLine - displayRows)
          render()
          break
        case 'Home':
        case 'g':
          currentLine = 0
          render()
          break
        case 'End':
        case 'G':
          currentLine = Math.max(0, lines.length - displayRows)
          render()
          break
      }
    })
  })
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'man',
    description: 'Display manual pages',
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

      let whereArg: string | undefined
      let topicPath: string | undefined
      let listTopicsFlag = false

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === undefined) continue

        if (arg === '--where') {
          if (i + 1 < argv.length) {
            i++
            whereArg = argv[i]
          } else {
            await writelnStderr(process, terminal, 'man: missing argument to --where')
            return 1
          }
        } else if (arg === '--list' || arg === '-l') {
          listTopicsFlag = true
        } else if (arg.startsWith('--list') && arg.length > 6) {
          // Handle case where --list is concatenated with package name
          listTopicsFlag = true
          topicPath = arg.slice(6) // Extract everything after "--list"
        } else if (arg.startsWith('-l') && arg.length > 2) {
          // Handle case where -l is concatenated with package name (e.g., "-l@zenfs/core")
          listTopicsFlag = true
          topicPath = arg.slice(2) // Extract everything after "-l"
        } else if (!arg.startsWith('-')) {
          topicPath = arg
        }
      }

      if (!topicPath) {
        topicPath = '@ecmaos/kernel'
      }

      const pkgPath = parsePackagePath(topicPath)
      if (!pkgPath) {
        await writelnStderr(process, terminal, `man: invalid package path: ${topicPath}`)
        return 1
      }

      const manpaths = resolveManPath(shell, whereArg)

      for (const manpath of manpaths) {
        const packageDir = buildPackagePath(manpath, pkgPath)

        if (!(await shell.context.fs.promises.exists(packageDir))) continue

        await parseMetadata(shell.context.fs, packageDir)

        if (listTopicsFlag) {
          const topics = await listTopics(shell.context.fs, packageDir)
          const packageName = pkgPath.scope ? `@${pkgPath.scope}/${pkgPath.package}` : pkgPath.package
          
          if (topics.length === 0) {
            terminal.writeln(`${packageName}: no topics available`)
          } else {
            terminal.writeln(`${packageName}:`)
            for (const topic of topics) {
              terminal.writeln(`  ${topic}`)
            }
          }
          return 0
        }

        if (!pkgPath.topic) {
          const indexFile = await findDocument(shell.context.fs, packageDir)

          if (indexFile) {
            const content = await shell.context.fs.promises.readFile(indexFile, 'utf-8')
            const ext = path.extname(indexFile)
            
            let processedContent = content
            if (ext === '.md') {
              processedContent = convertMarkdownToText(content, pkgPath, manpath)
            } else if (ext === '.html') {
              processedContent = convertHtmlToText(content, pkgPath, manpath)
            }

            const documentName = pkgPath.scope
              ? `@${pkgPath.scope}/${pkgPath.package}`
              : pkgPath.package

            await displayManPage(terminal, processedContent, documentName)
          } else {
            const topics = await listTopics(shell.context.fs, packageDir)
            const packageName = pkgPath.scope ? `@${pkgPath.scope}/${pkgPath.package}` : pkgPath.package
            
            if (topics.length === 0) {
              terminal.writeln(`${packageName}: no topics available`)
            } else {
              const exampleTopic = topics[0]
              terminal.writeln(`${kernel.i18n.t('coreutils.man.noIndexFound', 'No index found, try a topic:')} man ${packageName}/${exampleTopic}`)
              terminal.writeln(`${packageName} ${kernel.i18n.t('topics')}:`)
              for (const topic of topics) terminal.writeln(`  ${topic}`)
            }
          }

          return 0
        }

        const docFile = await findDocument(shell.context.fs, packageDir, pkgPath.topic)
        if (!docFile) continue

        try {
          const content = await shell.context.fs.promises.readFile(docFile, 'utf-8')
          const ext = path.extname(docFile)
          
          let processedContent = content
          if (ext === '.md') {
            processedContent = convertMarkdownToText(content, pkgPath, manpath)
          } else if (ext === '.html') {
            processedContent = convertHtmlToText(content, pkgPath, manpath)
          }

          const documentName = pkgPath.scope
            ? `@${pkgPath.scope}/${pkgPath.package}/${pkgPath.topic}`
            : `${pkgPath.package}/${pkgPath.topic}`

          await displayManPage(terminal, processedContent, documentName)
          return 0
        } catch (error) {
          await writelnStderr(process, terminal, `man: error reading document: ${error instanceof Error ? error.message : 'Unknown error'}`)
          return 1
        }
      }

      await writelnStderr(process, terminal, `man: no manual entry for ${topicPath}`)
      return 1
    }
  })
}
