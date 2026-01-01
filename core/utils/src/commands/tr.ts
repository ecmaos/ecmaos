import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: tr [OPTION]... SET1 [SET2]
Translate or delete characters.

  -d, --delete    delete characters in SET1
  -s, --squeeze   replace each sequence of a repeated character
  --help          display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tr',
    description: 'Translate or delete characters',
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

      const args: string[] = []
      let deleteMode = false
      let squeeze = false

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-d' || arg === '--delete') {
          deleteMode = true
        } else if (arg === '-s' || arg === '--squeeze') {
          squeeze = true
        } else if (arg.startsWith('-')) {
          const flags = arg.slice(1).split('')
          if (flags.includes('d')) deleteMode = true
          if (flags.includes('s')) squeeze = true
          const invalidFlags = flags.filter(f => !['d', 's'].includes(f))
          if (invalidFlags.length > 0) {
            await writelnStderr(process, terminal, `tr: invalid option -- '${invalidFlags[0]}'`)
            return 1
          }
        } else {
          args.push(arg)
        }
      }

      if (args.length === 0) {
        await writelnStderr(process, terminal, 'tr: missing operand')
        return 1
      }

      const set1 = args[0] || ''
      const set2 = args[1] || ''

      if (!deleteMode && !squeeze && !set2) {
        await writelnStderr(process, terminal, 'tr: missing operand after SET1')
        return 1
      }

      const writer = process.stdout.getWriter()

      const expandSet = (set: string): string => {
        let result = ''
        let i = 0
        while (i < set.length) {
          if (i < set.length - 2 && set[i + 1] === '-') {
            const startChar = set[i]
            const endChar = set[i + 2]
            if (startChar !== undefined && endChar !== undefined) {
              const start = startChar.charCodeAt(0)
              const end = endChar.charCodeAt(0)
              for (let j = start; j <= end; j++) {
                result += String.fromCharCode(j)
              }
            }
            i += 3
          } else {
            const char = set[i]
            if (char !== undefined) {
              result += char
            }
            i++
          }
        }
        return result
      }

      try {
        if (!process.stdin) {
          return 0
        }

        const reader = process.stdin.getReader()
        const decoder = new TextDecoder()
        let content = ''

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              content += decoder.decode(value, { stream: true })
            }
          }
        } finally {
          reader.releaseLock()
        }

        const expandedSet1 = expandSet(set1)
        const expandedSet2 = deleteMode ? '' : expandSet(set2)

        let result = ''

        if (deleteMode) {
          const set1Chars = new Set(expandedSet1)
          for (const char of content) {
            if (!set1Chars.has(char)) {
              result += char
            }
          }
        } else {
          const map = new Map<string, string>()
          const maxLen = Math.max(expandedSet1.length, expandedSet2.length)
          
          for (let i = 0; i < maxLen; i++) {
            const from = expandedSet1[i] || (expandedSet1.length > 0 ? expandedSet1[expandedSet1.length - 1] : '')
            const to = expandedSet2[i] || (expandedSet2.length > 0 ? expandedSet2[expandedSet2.length - 1] : '')
            if (from !== undefined) {
              map.set(from, to || '')
            }
          }

          for (const char of content) {
            result += map.get(char) || char
          }
        }

        if (squeeze) {
          let squeezed = ''
          let lastChar = ''
          for (const char of result) {
            if (char !== lastChar || !expandedSet1.includes(char)) {
              squeezed += char
              lastChar = char
            } else {
              lastChar = char
            }
          }
          result = squeezed
        }

        await writer.write(new TextEncoder().encode(result))
        return 0
      } finally {
        writer.releaseLock()
      }
    }
  })
}
