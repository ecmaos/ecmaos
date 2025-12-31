import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

interface SedCommand {
  type: 'substitute' | 'delete' | 'print'
  pattern?: string
  replacement?: string
  flags?: string
  address?: {
    type: 'line' | 'range' | 'pattern' | 'pattern-range'
    start?: number | string
    end?: number | string
  }
}

function parseSedExpression(expr: string): SedCommand | null {
  expr = expr.trim()
  
  const substituteMatch = expr.match(/^(\d+)?(,(\d+|\$))?s\/(.+?)\/(.*?)\/([gip]*\d*)$/)
  if (substituteMatch) {
    const [, startLine, , endLine, pattern, replacement, flags] = substituteMatch
    const address = startLine ? {
      type: (endLine ? 'range' : 'line') as 'range' | 'line',
      start: parseInt(startLine, 10),
      ...(endLine && { end: endLine === '$' ? Infinity : parseInt(endLine, 10) })
    } : undefined
    
    return {
      type: 'substitute',
      pattern,
      replacement: replacement || '',
      flags: flags || '',
      address
    }
  }
  
  const simpleSubstituteMatch = expr.match(/^s\/(.+?)\/(.*?)\/([gip]*\d*)$/)
  if (simpleSubstituteMatch) {
    const [, pattern, replacement, flags] = simpleSubstituteMatch
    return {
      type: 'substitute',
      pattern,
      replacement: replacement || '',
      flags: flags || ''
    }
  }
  
  const deleteMatch = expr.match(/^(\d+)?(,(\d+|\$))?d$/)
  if (deleteMatch) {
    const [, startLine, , endLine] = deleteMatch
    const address = startLine ? {
      type: (endLine ? 'range' : 'line') as 'range' | 'line',
      start: parseInt(startLine, 10),
      ...(endLine && { end: endLine === '$' ? Infinity : parseInt(endLine, 10) })
    } : undefined
    
    return {
      type: 'delete',
      address
    }
  }
  
  const patternDeleteMatch = expr.match(/^\/(.+?)\/d$/)
  if (patternDeleteMatch) {
    return {
      type: 'delete',
      address: {
        type: 'pattern',
        start: patternDeleteMatch[1]
      }
    }
  }
  
  const printMatch = expr.match(/^\/(.+?)\/p$/)
  if (printMatch) {
    return {
      type: 'print',
      address: {
        type: 'pattern',
        start: printMatch[1]
      }
    }
  }
  
  return null
}

function applySedCommand(line: string, lineNum: number, totalLines: number, command: SedCommand): { result: string | null; shouldPrint: boolean } {
  if (command.type === 'substitute') {
    if (!command.pattern || command.replacement === undefined) {
      return { result: line, shouldPrint: false }
    }
    
    let shouldApply = true
    
    if (command.address) {
      switch (command.address.type) {
        case 'line':
          shouldApply = lineNum === command.address.start
          break
        case 'range':
          const end = command.address.end === Infinity ? totalLines : (command.address.end as number)
          shouldApply = lineNum >= (command.address.start as number) && lineNum <= end
          break
        case 'pattern':
          try {
            const regex = new RegExp(command.address.start as string)
            shouldApply = regex.test(line)
          } catch {
            return { result: line, shouldPrint: false }
          }
          break
      }
    }
    
    if (!shouldApply) {
      return { result: line, shouldPrint: false }
    }
    
    const flags = command.flags || ''
    const global = flags.includes('g')
    const caseInsensitive = flags.includes('i')
    const nthMatch = flags.match(/^\d+$/) ? parseInt(flags, 10) : null
    
    try {
      let regexFlags = global ? 'g' : ''
      if (caseInsensitive) regexFlags += 'i'
      
      if (nthMatch) {
        let count = 0
        const regex = new RegExp(command.pattern, caseInsensitive ? 'gi' : 'g')
        const result = line.replace(regex, (match) => {
          count++
          if (count === nthMatch) {
            return command.replacement || match
          }
          return match
        })
        return { result, shouldPrint: false }
      }
      
      const regex = new RegExp(command.pattern, regexFlags || undefined)
      const result = line.replace(regex, command.replacement)
      return { result, shouldPrint: false }
    } catch {
      return { result: line, shouldPrint: false }
    }
  }
  
  if (command.type === 'delete') {
    if (command.address) {
      switch (command.address.type) {
        case 'line':
          if (lineNum === command.address.start) {
            return { result: null, shouldPrint: false }
          }
          break
        case 'range':
          const end = command.address.end === Infinity ? totalLines : (command.address.end as number)
          if (lineNum >= (command.address.start as number) && lineNum <= end) {
            return { result: null, shouldPrint: false }
          }
          break
        case 'pattern':
          try {
            const regex = new RegExp(command.address.start as string)
            if (regex.test(line)) {
              return { result: null, shouldPrint: false }
            }
          } catch {
            return { result: line, shouldPrint: false }
          }
          break
      }
    }
    return { result: line, shouldPrint: false }
  }
  
  if (command.type === 'print') {
    if (command.address && command.address.type === 'pattern') {
      try {
        const regex = new RegExp(command.address.start as string)
        if (regex.test(line)) {
          return { result: line, shouldPrint: true }
        }
      } catch {
        return { result: line, shouldPrint: false }
      }
    }
    return { result: line, shouldPrint: false }
  }
  
  return { result: line, shouldPrint: false }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'sed',
    description: 'Stream editor for filtering and transforming text',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'expression', type: String, alias: 'e', multiple: true, description: 'Add the script to the commands to be executed' },
      { name: 'file', type: String, alias: 'f', description: 'Add the contents of script-file to the commands to be executed' },
      { name: 'inplace', type: String, alias: 'i', description: 'Edit files in place (makes backup if extension supplied)' },
      { name: 'quiet', type: Boolean, alias: 'q', description: 'Suppress normal output' },
      { name: 'path', type: String, typeLabel: '{underline path}', defaultOption: true, multiple: true, description: 'Expression or input file(s)' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      let expressions = (argv.expression as string[]) || []
      let files = (argv.path as string[]) || []
      const inplace = argv.inplace as string | undefined
      const quiet = argv.quiet as boolean || false

      const isSedExpression = (arg: string): boolean => {
        if (!arg) return false
        const trimmed = arg.trim()
        return (
          trimmed.startsWith('s/') ||
          trimmed.startsWith('/') ||
          /^\d+[sd]/.test(trimmed) ||
          /^\d+,\d*[sd]/.test(trimmed) ||
          /^\d+s\//.test(trimmed) ||
          /^\d+,\d*s\//.test(trimmed)
        )
      }

      const potentialExpressions: string[] = []
      const potentialFiles: string[] = []

      for (const arg of files) {
        if (isSedExpression(arg)) {
          potentialExpressions.push(arg)
        } else {
          potentialFiles.push(arg)
        }
      }

      if (potentialExpressions.length > 0) {
        expressions = [...expressions, ...potentialExpressions]
        files = potentialFiles
      }

      if (expressions.length === 0 && !argv.file) {
        await writelnStderr(process, terminal, 'sed: No expression provided')
        return 1
      }

      const commands: SedCommand[] = []

      if (argv.file) {
        const scriptPath = path.resolve(shell.cwd, argv.file as string)
        const exists = await shell.context.fs.promises.exists(scriptPath)
        if (!exists) {
          await writelnStderr(process, terminal, `sed: ${argv.file}: No such file or directory`)
          return 1
        }

        const scriptContent = await shell.context.fs.promises.readFile(scriptPath, 'utf-8')
        const scriptLines = scriptContent.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'))
        
        for (const line of scriptLines) {
          const cmd = parseSedExpression(line.trim())
          if (cmd) commands.push(cmd)
        }
      }

      for (const expr of expressions) {
        const cmd = parseSedExpression(expr)
        if (cmd) {
          commands.push(cmd)
        } else {
          await writelnStderr(process, terminal, `sed: Invalid expression: ${expr}`)
          return 1
        }
      }

      if (commands.length === 0) {
        await writelnStderr(process, terminal, 'sed: No valid commands found')
        return 1
      }

      const writer = process.stdout.getWriter()

      try {
        const processFile = async (filePath: string): Promise<string[]> => {
          const exists = await shell.context.fs.promises.exists(filePath)
          if (!exists) {
            await writelnStderr(process, terminal, `sed: ${filePath}: No such file or directory`)
            return []
          }

          const stats = await shell.context.fs.promises.stat(filePath)
          if (stats.isDirectory()) {
            await writelnStderr(process, terminal, `sed: ${filePath}: Is a directory`)
            return []
          }

          const content = await shell.context.fs.promises.readFile(filePath, 'utf-8')
          return content.split('\n')
        }

        let inputLines: string[] = []

        if (files.length > 0) {
          for (const file of files) {
            const expandedPath = shell.expandTilde(file)
            const fullPath = path.resolve(shell.cwd, expandedPath)
            const lines = await processFile(fullPath)
            inputLines.push(...lines)
            if (lines.length > 0 && inputLines.length > lines.length) {
              inputLines.push('')
            }
          }
        } else {
          if (!process.stdin) {
            await writelnStderr(process, terminal, 'sed: No input provided')
            return 1
          }

          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          const chunks: string[] = []

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              chunks.push(decoder.decode(value, { stream: true }))
            }
            chunks.push(decoder.decode(new Uint8Array(), { stream: false }))
          } finally {
            reader.releaseLock()
          }

          const content = chunks.join('')
          inputLines = content.split('\n')
        }

        const outputLines: string[] = []
        const totalLines = inputLines.length

        for (let i = 0; i < inputLines.length; i++) {
          let line = inputLines[i] || ''
          let lineNum = i + 1
          let shouldPrint = false

          for (const command of commands) {
            const { result, shouldPrint: print } = applySedCommand(line, lineNum, totalLines, command)
            if (result === null) {
              line = null as unknown as string
              break
            }
            line = result
            if (print) {
              shouldPrint = true
            }
          }

          if (line !== null) {
            outputLines.push(line)
            if (shouldPrint && !quiet) {
              outputLines.push(line)
            }
          }
        }

        const output = outputLines.join('\n')

        if (inplace !== undefined && files.length > 0) {
          for (const file of files) {
            const expandedPath = shell.expandTilde(file)
            const fullPath = path.resolve(shell.cwd, expandedPath)
            
            const fileLines = await processFile(fullPath)
            if (fileLines.length === 0) continue
            
            const fileOutputLines: string[] = []
            const fileTotalLines = fileLines.length

            for (let i = 0; i < fileLines.length; i++) {
              let line = fileLines[i] || ''
              let lineNum = i + 1
              let shouldPrint = false

              for (const command of commands) {
                const { result, shouldPrint: print } = applySedCommand(line, lineNum, fileTotalLines, command)
                if (result === null) {
                  line = null as unknown as string
                  break
                }
                line = result
                if (print) {
                  shouldPrint = true
                }
              }

              if (line !== null) {
                fileOutputLines.push(line)
                if (shouldPrint && !quiet) {
                  fileOutputLines.push(line)
                }
              }
            }

            const fileOutput = fileOutputLines.join('\n')
            
            if (inplace) {
              const backupPath = `${fullPath}${inplace}`
              const originalContent = await shell.context.fs.promises.readFile(fullPath, 'utf-8')
              await shell.context.fs.promises.writeFile(backupPath, originalContent)
            }
            
            await shell.context.fs.promises.writeFile(fullPath, fileOutput)
          }
        } else {
          await writer.write(new TextEncoder().encode(output))
        }

        return 0
      } catch (error) {
        await writelnStderr(process, terminal, `sed: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
