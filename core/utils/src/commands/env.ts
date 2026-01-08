import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr, writeStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: env [OPTION]... [NAME=VALUE]... [COMMAND [ARG]...]
Set each NAME to VALUE in the environment and run COMMAND.

  -i, --ignore-environment  start with an empty environment
  -u, --unset=NAME          remove variable from the environment
  -0, --null                 end each output line with NUL, not newline
      --help                 display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'env',
    description: 'Run a program in a modified environment',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let ignoreEnvironment = false
      const unsetVars: string[] = []
      let nullTerminated = false
      const envVars: Record<string, string> = {}
      let commandStartIndex = -1

      let i = 0
      while (i < argv.length) {
        const arg = argv[i]
        if (!arg) {
          i++
          continue
        }

        if (arg === '-i' || arg === '--ignore-environment') {
          ignoreEnvironment = true
        } else if (arg === '-0' || arg === '--null') {
          nullTerminated = true
        } else if (arg === '-u' || arg.startsWith('--unset=')) {
          let varName: string
          if (arg.startsWith('--unset=')) {
            varName = arg.slice(8)
          } else {
            i++
            varName = argv[i]
            if (!varName) {
              await writelnStderr(process, terminal, chalk.red('env: option requires an argument -- \'u\''))
              return 1
            }
          }
          if (varName) {
            unsetVars.push(varName)
          }
        } else if (arg.includes('=')) {
          const [name, ...valueParts] = arg.split('=')
          if (name && valueParts.length > 0) {
            envVars[name] = valueParts.join('=')
          }
        } else {
          commandStartIndex = i
          break
        }
        i++
      }

      const baseEnv = ignoreEnvironment ? {} : Object.fromEntries(shell.env.entries())

      for (const varName of unsetVars) {
        delete baseEnv[varName]
      }

      const modifiedEnv = { ...baseEnv, ...envVars }

      if (commandStartIndex === -1) {
        const entries = Object.entries(modifiedEnv).sort(([a], [b]) => a.localeCompare(b))
        const separator = nullTerminated ? '\0' : '\n'
        
        for (const [key, value] of entries) {
          const output = `${key}=${value}${separator}`
          await writeStdout(process, terminal, output)
        }
        
        if (!nullTerminated && entries.length > 0) {
          await writeStdout(process, terminal, '\n')
        }
        
        return 0
      }

      const commandArgs = argv.slice(commandStartIndex)
      const command = commandArgs[0]
      if (!command) {
        await writelnStderr(process, terminal, chalk.red('env: missing command'))
        return 1
      }

      const originalEnv = new Map(shell.env)
      const originalProcessEnv = { ...globalThis.process.env }
      
      for (const [key, value] of Object.entries(modifiedEnv)) {
        shell.env.set(key, value)
        globalThis.process.env[key] = value
      }

      for (const varName of unsetVars) {
        shell.env.delete(varName)
        delete globalThis.process.env[varName]
      }

      try {
        const commandLine = commandArgs.join(' ')
        const exitCode = await shell.execute(commandLine)
        return exitCode ?? 1
      } finally {
        shell.env.clear()
        for (const [key, value] of originalEnv.entries()) {
          shell.env.set(key, value)
        }
        
        for (const key in globalThis.process.env) {
          if (!(key in originalProcessEnv)) {
            delete globalThis.process.env[key]
          }
        }
        
        for (const [key, value] of Object.entries(originalProcessEnv)) {
          globalThis.process.env[key] = value
        }
      }
    }
  })
}
