import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: test EXPRESSION
       test [OPTION]
Check file types and compare values.

  -f FILE     FILE exists and is a regular file
  -d FILE     FILE exists and is a directory
  -e FILE     FILE exists
  -r FILE     FILE exists and is readable
  -w FILE     FILE exists and is writable
  -x FILE     FILE exists and is executable
  -n STRING   STRING is not empty
  -z STRING   STRING is empty (zero length)
  STRING1 = STRING2   strings are equal
  STRING1 != STRING2  strings are not equal
  --help      display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'test',
    description: 'Check file types and compare values',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const checkFile = async (filePath: string, check: string): Promise<boolean> => {
        const fullPath = path.resolve(shell.cwd, filePath)

        try {
          const stat = await shell.context.fs.promises.stat(fullPath)

          switch (check) {
            case 'f':
              return stat.isFile()
            case 'd':
              return stat.isDirectory()
            case 'e':
              return true
            case 'r':
            case 'w':
            case 'x':
              return true
            default:
              return false
          }
        } catch {
          return false
        }
      }

      if (argv.length === 0) {
        return 1
      }

      const operator = argv[0]

      if (operator === '-f' && argv[1]) {
        return (await checkFile(argv[1], 'f')) ? 0 : 1
      }

      if (operator === '-d' && argv[1]) {
        return (await checkFile(argv[1], 'd')) ? 0 : 1
      }

      if (operator === '-e' && argv[1]) {
        return (await checkFile(argv[1], 'e')) ? 0 : 1
      }

      if (operator === '-r' && argv[1]) {
        return (await checkFile(argv[1], 'r')) ? 0 : 1
      }

      if (operator === '-w' && argv[1]) {
        return (await checkFile(argv[1], 'w')) ? 0 : 1
      }

      if (operator === '-x' && argv[1]) {
        return (await checkFile(argv[1], 'x')) ? 0 : 1
      }

      if (operator === '-n' && argv[1]) {
        return argv[1].length > 0 ? 0 : 1
      }

      if (operator === '-z' && argv[1]) {
        return argv[1].length === 0 ? 0 : 1
      }

      if (argv.length === 3) {
        const [left, op, right] = argv
        if (op === '=') {
          return left === right ? 0 : 1
        }
        if (op === '!=') {
          return left !== right ? 0 : 1
        }
      }

      return 1
    }
  })
}
