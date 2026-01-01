import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'tr',
    description: 'Translate or delete characters',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'delete', type: Boolean, alias: 'd', description: 'Delete characters in SET1' },
      { name: 'squeeze', type: Boolean, alias: 's', description: 'Replace each sequence of a repeated character' },
      { name: 'args', type: String, defaultOption: true, multiple: true, description: 'SET1 [SET2]' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const args = (argv.args as string[]) || []
      const deleteMode = (argv.delete as boolean) || false
      const squeeze = (argv.squeeze as boolean) || false

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
            const start = set[i].charCodeAt(0)
            const end = set[i + 2].charCodeAt(0)
            for (let j = start; j <= end; j++) {
              result += String.fromCharCode(j)
            }
            i += 3
          } else {
            result += set[i]
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
            const from = expandedSet1[i] || expandedSet1[expandedSet1.length - 1]
            const to = expandedSet2[i] || expandedSet2[expandedSet2.length - 1]
            map.set(from, to)
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
