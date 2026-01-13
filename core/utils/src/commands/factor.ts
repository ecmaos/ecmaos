import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: factor [NUMBER]...
Print prime factors of each NUMBER.

  --help  display this help and exit`
  writelnStderr(process, terminal, usage)
}

function factorize(n: number): number[] {
  if (n < 2) {
    return [n]
  }

  const factors: number[] = []
  let num = n

  while (num % 2 === 0) {
    factors.push(2)
    num /= 2
  }

  for (let i = 3; i * i <= num; i += 2) {
    while (num % i === 0) {
      factors.push(i)
      num /= i
    }
  }

  if (num > 2) {
    factors.push(num)
  }

  return factors
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'factor',
    description: 'Print prime factors of numbers',
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

      const numbers: string[] = []

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (!arg.startsWith('-')) {
          numbers.push(arg)
        } else {
          await writelnStderr(process, terminal, `factor: invalid option -- '${arg.slice(1)}'`)
          await writelnStderr(process, terminal, "Try 'factor --help' for more information.")
          return 1
        }
      }

      if (numbers.length === 0) {
        if (!process.stdin) {
          await writelnStderr(process, terminal, 'factor: missing operand')
          await writelnStderr(process, terminal, "Try 'factor --help' for more information.")
          return 1
        }

        if (process.stdinIsTTY) {
          try {
            while (true) {
              const line = await terminal.readline('', false, true)
              if (!line) break
              const trimmed = line.trim()
              if (trimmed) {
                numbers.push(...trimmed.split(/\s+/))
              } else {
                break
              }
            }
          } catch {
          } finally {
            terminal.listen()
          }
        } else {
          const reader = process.stdin.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) {
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''
                for (const line of lines) {
                  const trimmed = line.trim()
                  if (trimmed) {
                    numbers.push(...trimmed.split(/\s+/))
                  }
                }
              }
            }
            if (buffer.trim()) {
              numbers.push(...buffer.trim().split(/\s+/))
            }
          } finally {
            reader.releaseLock()
          }
        }
      }

      if (numbers.length === 0) {
        await writelnStderr(process, terminal, 'factor: missing operand')
        await writelnStderr(process, terminal, "Try 'factor --help' for more information.")
        return 1
      }

      let hasError = false

      for (const numStr of numbers) {
        const num = parseInt(numStr, 10)
        if (isNaN(num) || num < 0) {
          await writelnStderr(process, terminal, `factor: '${numStr}' is not a valid positive integer`)
          hasError = true
          continue
        }

        const factors = factorize(num)
        const output = `${num}: ${factors.join(' ')}`
        await writelnStdout(process, terminal, output)
      }

      return hasError ? 1 : 0
    }
  })
}
