import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: chmod [OPTION]... MODE[,MODE]... FILE...
   or:  chmod [OPTION]... OCTAL-MODE FILE...
Change the mode of each FILE to MODE.

      --help         display this help and exit

Each MODE is of the form '[ugoa]*([-+=]([rwxXst]*|[ugo]))+|[-+=][0-7]+'.

MODE can be specified in two ways:

Numeric mode (octal):
  MODE is an octal number representing the permissions:
  4 = read (r)
  2 = write (w)
  1 = execute (x)
  
  The three digits represent user, group, and other permissions.
  Each digit is the sum of the desired permissions:
  - 7 = 4+2+1 = read + write + execute (rwx)
  - 6 = 4+2   = read + write (rw-)
  - 5 = 4+1   = read + execute (r-x)
  - 4 = 4     = read only (r--)
  
  Examples:
    755 = rwxr-xr-x (user: rwx, group: r-x, other: r-x)
    644 = rw-r--r-- (user: rw-, group: r--, other: r--)
    600 = rw------- (user: rw-, group: ---, other: ---)

Symbolic mode:
  [ugoa]*[-+=][rwxXst]*
  
  The format is: [who][operator][permissions]
  
  'who' (optional, defaults to 'a' if omitted):
    u   user (owner)
    g   group
    o   other
    a   all (user, group, and other)
  
  'operator':
    +   add the specified permissions
    -   remove the specified permissions
    =   set the exact permissions (clears others)
  
  'permissions' (one or more):
    r   read
    w   write
    x   execute
    X   execute only if file is a directory or already has execute
    s   setuid/setgid
    t   sticky bit

Examples:
  chmod 755 file              Set file to rwxr-xr-x
  chmod +x file               Add execute permission for all
  chmod u+x file              Add execute permission for user
  chmod g-w file              Remove write permission for group
  chmod o=r file              Set other permissions to read-only
  chmod u=rwx,g=rx,o=r file   Set specific permissions for each class
  chmod a-w file              Remove write permission for all
  chmod u+x,g+x file          Add execute for user and group

Multiple modes can be specified separated by commas:
  chmod u+x,g-w file          Add execute for user, remove write for group`
  writelnStderr(process, terminal, usage)
}

function parseNumericMode(mode: string): number | null {
  if (/^0?[0-7]{1,4}$/.test(mode)) {
    return parseInt(mode, 8)
  }
  if (/^0o[0-7]{1,4}$/i.test(mode)) {
    return parseInt(mode.slice(2), 8)
  }
  return null
}

function parseSymbolicMode(mode: string, currentMode: number): number {
  const parts = mode.split(',')
  let newMode = currentMode

  for (const part of parts) {
    const match = part.match(/^([ugoa]*)([+\-=])([rwxXst]*)$/)
    if (!match) {
      throw new Error(`Invalid mode: ${part}`)
    }

    const [, who, op, perms = ''] = match
    const whoSet = who || 'a'

    if ((op === '+' || op === '-') && !perms) {
      throw new Error(`Invalid mode: ${part} (missing permissions)`)
    }

    const userBits = 0o400 | 0o200 | 0o100
    const groupBits = 0o040 | 0o020 | 0o010
    const otherBits = 0o004 | 0o002 | 0o001

    let permBits = 0
    if (perms.includes('r')) permBits |= 0o444
    if (perms.includes('w')) permBits |= 0o222
    if (perms.includes('x')) permBits |= 0o111
    if (perms.includes('X')) {
      if (currentMode & 0o111) permBits |= 0o111
    }
    if (perms.includes('s')) permBits |= 0o6000
    if (perms.includes('t')) permBits |= 0o1000

    let targetBits = 0
    if (whoSet.includes('u') || whoSet.includes('a')) targetBits |= userBits
    if (whoSet.includes('g') || whoSet.includes('a')) targetBits |= groupBits
    if (whoSet.includes('o') || whoSet.includes('a')) targetBits |= otherBits

    switch (op) {
      case '+':
        newMode |= (permBits & targetBits)
        break
      case '-':
        newMode &= ~(permBits & targetBits)
        break
      case '=':
        newMode &= ~targetBits
        newMode |= (permBits & targetBits)
        break
    }
  }

  return newMode
}

async function parseMode(mode: string, fs: typeof import('@zenfs/core').fs.promises, filePath: string): Promise<number> {
  const numericMode = parseNumericMode(mode)
  if (numericMode !== null) {
    return numericMode
  }

  try {
    const stats = await fs.stat(filePath)
    const currentMode = stats.mode & 0o7777
    return parseSymbolicMode(mode, currentMode)
  } catch (error) {
    throw new Error(`Cannot access ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'chmod',
    description: 'Change file mode bits',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      const args: string[] = []
      for (const arg of argv) {
        if (arg && !arg.startsWith('-')) {
          args.push(arg)
        }
      }

      if (args.length === 0) {
        await writelnStderr(process, terminal, chalk.red('chmod: missing operand'))
        await writelnStderr(process, terminal, 'Try \'chmod --help\' for more information.')
        return 1
      }

      const mode = args[0]
      const targets = args.slice(1)

      if (!mode || targets.length === 0) {
        await writelnStderr(process, terminal, chalk.red('chmod: missing operand'))
        await writelnStderr(process, terminal, 'Try \'chmod --help\' for more information.')
        return 1
      }

      let hasError = false

      for (const target of targets) {
        const fullPath = path.resolve(shell.cwd, target)
        
        try {
          const numericMode = await parseMode(mode, shell.context.fs.promises, fullPath)
          await shell.context.fs.promises.chmod(fullPath, numericMode)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          await writelnStderr(process, terminal, `chmod: ${target}: ${errorMessage}`)
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
