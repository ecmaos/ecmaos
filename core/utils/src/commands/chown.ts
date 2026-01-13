import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal, User } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: chown [OPTION]... [OWNER][:[GROUP]] FILE...
   or:  chown [OPTION]... :GROUP FILE...
   or:  chown [OPTION]... --reference=RFILE FILE...
Change the owner and/or group of each FILE to OWNER and/or GROUP.

      -R, --recursive     operate on files and directories recursively
      -v, --verbose       output a diagnostic for every file processed
      -c, --changes       like verbose but report only when a change is made
      --help              display this help and exit

OWNER and GROUP can be specified as:
  - A numeric user ID (UID) or group ID (GID)
  - A username (resolved to UID)
  - A group name (resolved to GID, if supported)

The format OWNER:GROUP means set both owner and group.
The format OWNER: means set owner and set group to owner's primary group.
The format :GROUP means set group only (keep current owner).
The format OWNER.GROUP is also accepted (same as OWNER:GROUP).

Examples:
  chown root file                 Change owner of file to root
  chown root:root file            Change owner and group to root
  chown :users file               Change group to users (keep owner)
  chown root: file                Change owner to root, group to root's primary group
  chown -R root:root /dir         Recursively change owner and group
  chown -v user file              Verbose output while changing owner
  chown -c user file              Report only when changes are made`
  writelnStderr(process, terminal, usage)
}

interface OwnershipSpec {
  owner?: number
  group?: number
  ownerOnly: boolean
  groupOnly: boolean
  setGroupToOwnerPrimary: boolean
}

function parseOwnershipSpec(spec: string, kernel: Kernel): OwnershipSpec {
  const result: OwnershipSpec = {
    ownerOnly: false,
    groupOnly: false,
    setGroupToOwnerPrimary: false
  }

  if (spec.startsWith(':')) {
    result.groupOnly = true
    const groupSpec = spec.slice(1)
    if (!groupSpec) {
      throw new Error('Invalid ownership spec: missing group after colon')
    }
    result.group = resolveGroup(groupSpec, kernel)
    return result
  }

  if (spec.endsWith(':')) {
    result.ownerOnly = true
    result.setGroupToOwnerPrimary = true
    const ownerSpec = spec.slice(0, -1)
    if (!ownerSpec) {
      throw new Error('Invalid ownership spec: missing owner before colon')
    }
    result.owner = resolveOwner(ownerSpec, kernel)
    const ownerUser = kernel.users.get(result.owner)
    if (ownerUser) {
      result.group = ownerUser.gid
    }
    return result
  }

  const colonIndex = spec.indexOf(':')
  const dotIndex = spec.indexOf('.')

  if (colonIndex === -1 && dotIndex === -1) {
    result.owner = resolveOwner(spec, kernel)
    result.ownerOnly = true
    return result
  }

  const separatorIndex = colonIndex !== -1 ? colonIndex : dotIndex
  const ownerSpec = spec.slice(0, separatorIndex)
  const groupSpec = spec.slice(separatorIndex + 1)

  if (!ownerSpec && !groupSpec) {
    throw new Error('Invalid ownership spec: both owner and group are empty')
  }

  if (ownerSpec) {
    result.owner = resolveOwner(ownerSpec, kernel)
  }

  if (groupSpec) {
    result.group = resolveGroup(groupSpec, kernel)
  }

  return result
}

function resolveOwner(ownerSpec: string, kernel: Kernel): number {
  const numericUid = parseInt(ownerSpec, 10)
  if (!isNaN(numericUid) && numericUid.toString() === ownerSpec) {
    return numericUid
  }

  const user = Array.from(kernel.users.all.values()).find(
    (u): u is User => (u as User).username === ownerSpec
  )

  if (!user) {
    throw new Error(`Invalid user: ${ownerSpec}`)
  }

  return user.uid
}

function resolveGroup(groupSpec: string, kernel: Kernel): number {
  const numericGid = parseInt(groupSpec, 10)
  if (!isNaN(numericGid) && numericGid.toString() === groupSpec) {
    return numericGid
  }

  const user = Array.from(kernel.users.all.values()).find(
    (u): u is User => (u as User).username === groupSpec
  )

  if (user) {
    return user.gid
  }

  throw new Error(`Invalid group: ${groupSpec}`)
}

async function getCurrentOwnership(
  fs: typeof import('@zenfs/core').fs.promises,
  filePath: string
): Promise<{ uid: number; gid: number }> {
  try {
    const stats = await fs.stat(filePath)
    return { uid: stats.uid, gid: stats.gid }
  } catch (error) {
    throw new Error(`Cannot access ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function changeOwnership(
  fs: typeof import('@zenfs/core').fs.promises,
  filePath: string,
  spec: OwnershipSpec,
  kernel: Kernel
): Promise<{ uid: number; gid: number }> {
  const current = await getCurrentOwnership(fs, filePath)
  let newUid = current.uid
  let newGid = current.gid

  if (spec.ownerOnly) {
    newUid = spec.owner ?? current.uid
    if (spec.setGroupToOwnerPrimary && spec.owner !== undefined) {
      const ownerUser = kernel.users.get(spec.owner)
      if (ownerUser) {
        newGid = ownerUser.gid
      }
    } else if (spec.group !== undefined) {
      newGid = spec.group
    }
  } else if (spec.groupOnly) {
    newGid = spec.group ?? current.gid
  } else {
    if (spec.owner !== undefined) {
      newUid = spec.owner
    }
    if (spec.group !== undefined) {
      newGid = spec.group
    }
  }

  await fs.chown(filePath, newUid, newGid)
  return { uid: newUid, gid: newGid }
}

async function processFile(
  fs: typeof import('@zenfs/core').fs.promises,
  filePath: string,
  spec: OwnershipSpec,
  kernel: Kernel,
  options: { recursive: boolean; verbose: boolean; changes: boolean },
  process: Process | undefined,
  terminal: Terminal,
  relativePath: string
): Promise<boolean> {
  try {
    const current = await getCurrentOwnership(fs, filePath)
    const newOwnership = await changeOwnership(fs, filePath, spec, kernel)
    const changed = current.uid !== newOwnership.uid || current.gid !== newOwnership.gid

    if (options.verbose || (options.changes && changed)) {
      const changeInfo = changed
        ? `changed ownership of '${relativePath}' from ${current.uid}:${current.gid} to ${newOwnership.uid}:${newOwnership.gid}`
        : `ownership of '${relativePath}' retained as ${newOwnership.uid}:${newOwnership.gid}`
      await writelnStdout(process, terminal, changeInfo)
    }

    if (options.recursive) {
      try {
        const stats = await fs.stat(filePath)
        if (stats.isDirectory()) {
          const entries = await fs.readdir(filePath)
          for (const entry of entries) {
            const entryPath = path.join(filePath, entry)
            const entryRelativePath = path.join(relativePath, entry)
            await processFile(fs, entryPath, spec, kernel, options, process, terminal, entryRelativePath)
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `chown: ${relativePath}: ${errorMessage}`)
      }
    }

    return false
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `chown: ${relativePath}: ${errorMessage}`)
    return true
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'chown',
    description: 'Change file owner and group',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      let recursive = false
      let verbose = false
      let changes = false
      const args: string[] = []

      for (const arg of argv) {
        if (arg === '-R' || arg === '--recursive') {
          recursive = true
        } else if (arg === '-v' || arg === '--verbose') {
          verbose = true
        } else if (arg === '-c' || arg === '--changes') {
          changes = true
        } else if (arg === '--reference') {
          await writelnStderr(process, terminal, chalk.red('chown: --reference option not yet implemented'))
          return 1
        } else if (arg && !arg.startsWith('-')) {
          args.push(arg)
        } else if (arg.startsWith('-')) {
          await writelnStderr(process, terminal, chalk.red(`chown: invalid option '${arg}'`))
          await writelnStderr(process, terminal, 'Try \'chown --help\' for more information.')
          return 1
        }
      }

      if (args.length === 0) {
        await writelnStderr(process, terminal, chalk.red('chown: missing operand'))
        await writelnStderr(process, terminal, 'Try \'chown --help\' for more information.')
        return 1
      }

      const ownershipSpec = args[0]
      const targets = args.slice(1)

      if (!ownershipSpec || targets.length === 0) {
        await writelnStderr(process, terminal, chalk.red('chown: missing operand'))
        await writelnStderr(process, terminal, 'Try \'chown --help\' for more information.')
        return 1
      }

      let spec: OwnershipSpec
      try {
        spec = parseOwnershipSpec(ownershipSpec, kernel)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, chalk.red(`chown: invalid ownership spec '${ownershipSpec}': ${errorMessage}`))
        return 1
      }

      let hasError = false
      const options = { recursive, verbose, changes }

      for (const target of targets) {
        const fullPath = path.resolve(shell.cwd, target)
        const error = await processFile(
          shell.context.fs.promises,
          fullPath,
          spec,
          kernel,
          options,
          process,
          terminal,
          target
        )
        if (error) {
          hasError = true
        }
      }

      return hasError ? 1 : 0
    }
  })
}
