import path from 'path'
import type { CommandLineOptions } from 'command-line-args'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'test',
    description: 'Check file types and compare values',
    kernel,
    shell,
    terminal,
    options: [
      { name: 'help', type: Boolean, description: kernel.i18n.t('Display help') },
      { name: 'file', type: String, alias: 'f', description: 'File exists and is a regular file' },
      { name: 'directory', type: String, alias: 'd', description: 'File exists and is a directory' },
      { name: 'exists', type: String, alias: 'e', description: 'File exists' },
      { name: 'readable', type: String, alias: 'r', description: 'File exists and is readable' },
      { name: 'writable', type: String, alias: 'w', description: 'File exists and is writable' },
      { name: 'executable', type: String, alias: 'x', description: 'File exists and is executable' },
      { name: 'string', type: String, alias: 'n', description: 'String is not empty' },
      { name: 'zero', type: String, alias: 'z', description: 'String is empty (zero length)' },
      { name: 'equal', type: String, description: 'Compare two strings for equality' },
      { name: 'not-equal', type: String, description: 'Compare two strings for inequality' },
      { name: 'args', type: String, defaultOption: true, multiple: true, description: 'Test arguments' }
    ],
    run: async (argv: CommandLineOptions, process?: Process) => {
      const args = (argv.args as string[]) || []

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

      if (argv.file) {
        return (await checkFile(argv.file as string, 'f')) ? 0 : 1
      }

      if (argv.directory) {
        return (await checkFile(argv.directory as string, 'd')) ? 0 : 1
      }

      if (argv.exists) {
        return (await checkFile(argv.exists as string, 'e')) ? 0 : 1
      }

      if (argv.readable) {
        return (await checkFile(argv.readable as string, 'r')) ? 0 : 1
      }

      if (argv.writable) {
        return (await checkFile(argv.writable as string, 'w')) ? 0 : 1
      }

      if (argv.executable) {
        return (await checkFile(argv.executable as string, 'x')) ? 0 : 1
      }

      if (argv.string) {
        const str = argv.string as string
        return str.length > 0 ? 0 : 1
      }

      if (argv.zero) {
        const str = argv.zero as string
        return str.length === 0 ? 0 : 1
      }

      if (argv.equal) {
        const parts = (argv.equal as string).split('=')
        if (parts.length !== 2) {
          await writelnStderr(process, terminal, 'test: invalid syntax for equality comparison')
          return 1
        }
        return parts[0] === parts[1] ? 0 : 1
      }

      if (argv['not-equal']) {
        const parts = (argv['not-equal'] as string).split('!=')
        if (parts.length !== 2) {
          await writelnStderr(process, terminal, 'test: invalid syntax for inequality comparison')
          return 1
        }
        return parts[0] !== parts[1] ? 0 : 1
      }

      if (args.length > 0) {
        const operator = args[0]

        if (operator === '-f' && args[1]) {
          return (await checkFile(args[1], 'f')) ? 0 : 1
        }

        if (operator === '-d' && args[1]) {
          return (await checkFile(args[1], 'd')) ? 0 : 1
        }

        if (operator === '-e' && args[1]) {
          return (await checkFile(args[1], 'e')) ? 0 : 1
        }

        if (operator === '-n' && args[1]) {
          return args[1].length > 0 ? 0 : 1
        }

        if (operator === '-z' && args[1]) {
          return args[1].length === 0 ? 0 : 1
        }

        if (args.length === 3) {
          const [left, op, right] = args
          if (op === '=') {
            return left === right ? 0 : 1
          }
          if (op === '!=') {
            return left !== right ? 0 : 1
          }
        }
      }

      return 1
    }
  })
}
