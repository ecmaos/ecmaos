import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: format [OPTION]...
Delete all IndexedDB and localStorage data.

  -i, --indexeddb        Delete only IndexedDB databases
  -l, --localstorage     Delete only localStorage
  -k, --keep <name>      Preserve specific IndexedDB database(s) (can be used multiple times)
  --help                 Display this help and exit

By default, deletes all IndexedDB databases and localStorage.
Requires root privileges and interactive confirmation.`
  writelnStdout(process, terminal, usage)
}

async function emptyIndexedDBDatabases(
  keepDatabases: string[],
  kernel: Kernel,
  process: Process | undefined,
  terminal: Terminal
): Promise<boolean> {
  try {
    if (!globalThis.indexedDB) {
      await writelnStderr(process, terminal, chalk.yellow('format: IndexedDB is not available'))
      return false
    }

    await writelnStdout(process, terminal, chalk.yellow('format: Emptying filesystem...'))

    let databases: Array<{ name: string; version: number }> = []

    if (typeof indexedDB.databases === 'function') {
      const dbList = await indexedDB.databases()
      databases = dbList
        .filter((db): db is { name: string; version: number } => typeof db.name === 'string')
        .map(db => ({ name: db.name, version: db.version }))
    } else {
      await writelnStdout(process, terminal, chalk.yellow('format: indexedDB.databases() not supported, assuming filesystem will be emptied on reboot'))
      return true
    }

    const databasesToEmpty = databases.filter(db => !keepDatabases.includes(db.name))

    if (databasesToEmpty.length === 0) {
      await writelnStdout(process, terminal, chalk.green('format: All databases are preserved, nothing to empty'))
      return true
    }

    if (keepDatabases.length > 0) {
      const preserved = databases.filter(db => keepDatabases.includes(db.name))
      if (preserved.length > 0) {
        await writelnStdout(process, terminal, chalk.cyan(`format: Preserving databases: ${preserved.map(db => db.name).join(', ')}`))
      }
    }

    await writelnStdout(process, terminal, chalk.green(`format: Will empty ${databasesToEmpty.length} IndexedDB database(s) on reboot`))
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, chalk.red(`format: Error preparing IndexedDB databases: ${errorMessage}`))
    return false
  }
}

async function deleteLocalStorage(
  process: Process | undefined,
  terminal: Terminal,
  storage: Storage
): Promise<boolean> {
  try {
    const keysCount = storage.length
    if (keysCount === 0) {
      await writelnStdout(process, terminal, chalk.green('format: localStorage is already empty'))
      return true
    }

    storage.clear()
    await writelnStdout(process, terminal, chalk.green(`format: Successfully cleared localStorage (${keysCount} item(s))`))
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, chalk.red(`format: Error clearing localStorage: ${errorMessage}`))
    return false
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'format',
    description: 'Delete all IndexedDB and localStorage data',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      if (argv.length > 0 && (argv[0] === '--help' || argv[0] === '-h')) {
        printUsage(process, terminal)
        return 0
      }

      if (shell.credentials.suid !== 0) {
        await writelnStderr(process, terminal, chalk.red('format: permission denied (requires root)'))
        return 1
      }

      let onlyIndexedDB = false
      let onlyLocalStorage = false
      const keepDatabases: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg || typeof arg !== 'string') continue

        if (arg === '-i' || arg === '--indexeddb') {
          onlyIndexedDB = true
        } else if (arg === '-l' || arg === '--localstorage') {
          onlyLocalStorage = true
        } else if (arg === '-k' || arg === '--keep') {
          if (i + 1 < argv.length) {
            const dbName = argv[++i]
            if (dbName && !dbName.startsWith('-')) {
              keepDatabases.push(dbName)
            } else {
              await writelnStderr(process, terminal, chalk.red('format: --keep requires a database name'))
              return 1
            }
          } else {
            await writelnStderr(process, terminal, chalk.red('format: --keep requires a database name'))
            return 1
          }
        } else if (arg.startsWith('-')) {
          await writelnStderr(process, terminal, chalk.red(`format: invalid option -- '${arg.replace(/^-+/, '')}'`))
          await writelnStdout(process, terminal, "Try 'format --help' for more information.")
          return 1
        }
      }

      if (onlyIndexedDB && onlyLocalStorage) {
        await writelnStderr(process, terminal, chalk.red('format: cannot specify both --indexeddb and --localstorage'))
        return 1
      }

      const deleteIndexedDB = !onlyLocalStorage
      const deleteLocal = !onlyIndexedDB

      let actionDescription = 'This will delete '
      if (deleteIndexedDB && deleteLocal) {
        actionDescription += 'ALL IndexedDB databases and localStorage data'
      } else if (deleteIndexedDB) {
        actionDescription += 'ALL IndexedDB databases'
      } else {
        actionDescription += 'ALL localStorage data'
      }

      if (keepDatabases.length > 0) {
        actionDescription += ` (preserving: ${keepDatabases.join(', ')})`
      }

      actionDescription += '. This action cannot be undone!'

      await writelnStderr(process, terminal, chalk.red.bold(`⚠️  WARNING: ${actionDescription}`))
      await writelnStdout(process, terminal, chalk.yellow('Type "yes" to continue, or anything else to cancel: '))

      const confirmation = await terminal.readline()
      if (confirmation.trim().toLowerCase() !== 'yes') {
        await writelnStdout(process, terminal, chalk.yellow('format: Operation cancelled'))
        return 0
      }

      if (kernel.storage.db) {
        kernel.storage.db.close()
      }

      let success = true

      if (deleteIndexedDB) {
        const indexedDBSuccess = await emptyIndexedDBDatabases(keepDatabases, kernel, process, terminal)
        success = success && indexedDBSuccess
      }

      if (deleteLocal) {
        const localStorageSuccess = await deleteLocalStorage(process, terminal, kernel.storage.local)
        success = success && localStorageSuccess
      }

      if (success) {
        await writelnStdout(process, terminal, chalk.green.bold('format: Format operation completed successfully'))
        await writelnStdout(process, terminal, chalk.yellow('format: Rebooting system to complete format...'))
        setTimeout(() => {
          kernel.reboot()
        }, 500)
        return 0
      } else {
        await writelnStderr(process, terminal, chalk.red.bold('format: Format operation completed with errors'))
        return 1
      }
    }
  })
}
