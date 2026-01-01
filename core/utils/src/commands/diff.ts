import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'diff',
    description: 'Compare files line by line',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'unified', type: Number, alias: 'u', description: 'Output NUM (default 3) lines of unified context' },
      { name: 'context', type: Number, alias: 'c', description: 'Output NUM (default 3) lines of copied context' },
      { name: 'files', type: String, defaultOption: true, multiple: true, description: 'FILE1 FILE2' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      if (!process) return 1

      const files = (argv.files as string[]) || []

      if (files.length !== 2) {
        await writelnStderr(process, terminal, 'diff: exactly two files must be specified')
        return 1
      }

      const file1 = files[0]
      const file2 = files[1]
      const fullPath1 = path.resolve(shell.cwd, file1)
      const fullPath2 = path.resolve(shell.cwd, file2)

      const unified = (argv.unified as number) ?? 3
      const context = (argv.context as number) ?? 3

      const writer = process.stdout.getWriter()

      const readFile = async (filePath: string): Promise<string> => {
        if (filePath.startsWith('/dev')) {
          throw new Error('cannot diff device files')
        }

        let interrupted = false
        const interruptHandler = () => { interrupted = true }
        kernel.terminal.events.on(TerminalEvents.INTERRUPT, interruptHandler)

        try {
          const handle = await shell.context.fs.promises.open(filePath, 'r')
          const stat = await shell.context.fs.promises.stat(filePath)

          const decoder = new TextDecoder()
          let content = ''
          let bytesRead = 0
          const chunkSize = 1024

          while (bytesRead < stat.size) {
            if (interrupted) break
            const data = new Uint8Array(chunkSize)
            const readSize = Math.min(chunkSize, stat.size - bytesRead)
            await handle.read(data, 0, readSize, bytesRead)
            const chunk = data.subarray(0, readSize)
            content += decoder.decode(chunk, { stream: true })
            bytesRead += readSize
          }

          return content
        } finally {
          kernel.terminal.events.off(TerminalEvents.INTERRUPT, interruptHandler)
        }
      }

      try {
        const content1 = await readFile(fullPath1)
        const content2 = await readFile(fullPath2)

        const lines1 = content1.split('\n')
        const lines2 = content2.split('\n')

        if (lines1[lines1.length - 1] === '') lines1.pop()
        if (lines2[lines2.length - 1] === '') lines2.pop()

        const lcs = (a: string[], b: string[]): number[][] => {
          const m = a.length
          const n = b.length
          const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

          for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
              if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1
              } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
              }
            }
          }

          return dp
        }

        const diff = (a: string[], b: string[]): string[] => {
          const dp = lcs(a, b)
          const result: string[] = []
          let i = a.length
          let j = b.length

          while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
              result.unshift(`  ${a[i - 1]}`)
              i--
              j--
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
              result.unshift(`+ ${b[j - 1]}`)
              j--
            } else if (i > 0) {
              result.unshift(`- ${a[i - 1]}`)
              i--
            }
          }

          return result
        }

        const diffLines = diff(lines1, lines2)

        if (diffLines.length === 0 || diffLines.every(line => line.startsWith('  '))) {
          return 0
        }

        await writer.write(new TextEncoder().encode(`--- ${file1}\n+++ ${file2}\n`))
        
        for (const line of diffLines) {
          await writer.write(new TextEncoder().encode(line + '\n'))
        }

        return 1
      } catch (error) {
        await writelnStderr(process, terminal, `diff: ${error instanceof Error ? error.message : 'Unknown error'}`)
        return 1
      } finally {
        writer.releaseLock()
      }
    }
  })
}
