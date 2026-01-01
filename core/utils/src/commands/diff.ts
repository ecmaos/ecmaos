import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalEvents } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: diff [OPTION]... FILE1 FILE2
Compare files line by line.

  -u, --unified=NUM   output NUM (default 3) lines of unified context
  -c, --context=NUM   output NUM (default 3) lines of copied context
  --help              display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'diff',
    description: 'Compare files line by line',
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

      const files: string[] = []
      let unified = 3
      let context = 3

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-u' || arg === '--unified') {
          if (i + 1 < argv.length) {
            const num = parseInt(argv[++i], 10)
            if (!isNaN(num)) unified = num
          }
        } else if (arg.startsWith('--unified=')) {
          const num = parseInt(arg.slice(10), 10)
          if (!isNaN(num)) unified = num
        } else if (arg === '-c' || arg === '--context') {
          if (i + 1 < argv.length) {
            const num = parseInt(argv[++i], 10)
            if (!isNaN(num)) context = num
          }
        } else if (arg.startsWith('--context=')) {
          const num = parseInt(arg.slice(10), 10)
          if (!isNaN(num)) context = num
        } else if (!arg.startsWith('-')) {
          files.push(arg)
        }
      }

      if (files.length !== 2) {
        await writelnStderr(process, terminal, 'diff: exactly two files must be specified')
        return 1
      }

      const file1 = files[0]
      const file2 = files[1]
      const fullPath1 = path.resolve(shell.cwd, file1)
      const fullPath2 = path.resolve(shell.cwd, file2)

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
