import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

/**
 * Generate random alphanumeric characters for template replacement
 */
function generateRandomChars(count: number): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  let result = ''
  const cryptoApi = globalThis.crypto
  if (!cryptoApi) {
    throw new Error('Crypto API not available')
  }
  const randomValues = cryptoApi.getRandomValues(new Uint8Array(count))
  for (let i = 0; i < count; i++) {
    const randomValue = randomValues[i]
    if (randomValue !== undefined) {
      result += chars[randomValue % chars.length]
    }
  }
  return result
}

/**
 * Replace X's in template with random characters
 */
function replaceTemplate(template: string): string {
  const xCount = (template.match(/X/g) || []).length
  if (xCount === 0) {
    // If no X's, append random suffix
    return template + '.' + generateRandomChars(6)
  }
  
  let result = template
  const randomChars = generateRandomChars(xCount)
  let charIndex = 0
  
  for (let i = 0; i < template.length; i++) {
    if (template[i] === 'X') {
      result = result.substring(0, i) + randomChars[charIndex] + result.substring(i + 1)
      charIndex++
    }
  }
  
  return result
}

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: mktemp [OPTION]... [TEMPLATE]
Create a temporary file or directory, safely, and print its name.

  -d, --directory     create a directory, not a file
  -q, --quiet        suppress error messages
  -u, --dry-run      do not create anything; merely print a name (unsafe)
  -p DIR, --tmpdir=DIR  interpret TEMPLATE relative to DIR; if DIR is not
                        specified, use \$TMPDIR if set, else /tmp.  With
                        this option, TEMPLATE must not be an absolute name;
                        unlike with -t, TEMPLATE may contain slashes, but
                        mktemp creates only the final component
  -t                 interpret TEMPLATE relative to the directory specified by
                        -p, or \$TMPDIR if -p is not given; if neither is
                        specified, use /tmp [deprecated]
  --help             display this help and exit

The TEMPLATE must contain at least 3 consecutive 'X's in last component.
If TEMPLATE is not specified, use tmp.XXXXXX, and --tmpdir implies -t.

Examples:
  mktemp                    create a temp file in /tmp
  mktemp -d                 create a temp directory in /tmp
  mktemp /tmp/file.XXXXXX   create a temp file with template
  mktemp -d /tmp/dir.XXXXXX create a temp directory with template`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'mktemp',
    description: 'Create a temporary file or directory',
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

      let createDirectory = false
      let quiet = false
      let dryRun = false
      let tmpdir: string | undefined
      let useTmpdir = false
      let template: string | undefined

      // Parse arguments
      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '-d' || arg === '--directory') {
          createDirectory = true
        } else if (arg === '-q' || arg === '--quiet') {
          quiet = true
        } else if (arg === '-u' || arg === '--dry-run') {
          dryRun = true
        } else if (arg === '-t') {
          useTmpdir = true
        } else if (arg === '-p' || arg === '--tmpdir') {
          useTmpdir = true
          const dirArg = argv[i + 1]
          if (dirArg && !dirArg.startsWith('-')) {
            tmpdir = dirArg
            i++ // Skip the next argument as it's the directory value
          }
        } else if (arg.startsWith('--tmpdir=')) {
          useTmpdir = true
          const dirValue = arg.split('=')[1]
          if (dirValue) {
            tmpdir = dirValue
          }
        } else if (!arg.startsWith('-')) {
          // Positional argument - should be the template
          if (!template) {
            template = arg
          } else {
            if (!quiet) {
              await writelnStderr(process, terminal, `mktemp: too many arguments`)
            }
            return 1
          }
        } else {
          if (!quiet) {
            await writelnStderr(process, terminal, `mktemp: invalid option -- '${arg.replace(/^-+/, '')}'`)
            await writelnStderr(process, terminal, `Try 'mktemp --help' for more information.`)
          }
          return 1
        }
      }

      // Determine the temp directory
      let baseDir = '/tmp'
      if (useTmpdir) {
        if (tmpdir) {
          baseDir = tmpdir
        } else {
          // Check TMPDIR environment variable
          const envTmpdir = shell.env.get('TMPDIR')
          if (envTmpdir) {
            baseDir = envTmpdir
          }
        }
      }

      // Resolve base directory
      const resolvedBaseDir = path.isAbsolute(baseDir) ? baseDir : path.resolve(shell.cwd, baseDir)

      // Determine template
      if (!template) {
        template = 'tmp.XXXXXX'
      }

      // If template is absolute and useTmpdir is set, that's an error
      if (useTmpdir && path.isAbsolute(template)) {
        if (!quiet) {
          await writelnStderr(process, terminal, `mktemp: with -p/--tmpdir, TEMPLATE must not be an absolute name`)
        }
        return 1
      }

      // Build the full path
      let fullPath: string
      if (path.isAbsolute(template)) {
        fullPath = template
      } else {
        fullPath = path.join(resolvedBaseDir, template)
      }

      // Check that template has at least 3 X's in the last component
      const basename = path.basename(fullPath)
      const xCount = (basename.match(/X/g) || []).length
      if (xCount < 3) {
        if (!quiet) {
          await writelnStderr(process, terminal, `mktemp: too few X's in template ${template}`)
        }
        return 1
      }

      // Replace template with random characters
      const finalPath = replaceTemplate(fullPath)

      // If dry-run, just print the name
      if (dryRun) {
        await writelnStdout(process, terminal, finalPath)
        return 0
      }

      // Create the file or directory
      try {
        if (createDirectory) {
          await shell.context.fs.promises.mkdir(finalPath, { recursive: true })
        } else {
          // Create parent directory if needed
          const parentDir = path.dirname(finalPath)
          try {
            await shell.context.fs.promises.mkdir(parentDir, { recursive: true })
          } catch {
            // Parent might already exist, ignore
          }
          // Create empty file
          await shell.context.fs.promises.writeFile(finalPath, '')
        }
        
        // Print the created path
        await writelnStdout(process, terminal, finalPath)
        return 0
      } catch (error) {
        if (!quiet) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          await writelnStderr(process, terminal, `mktemp: ${errorMessage}`)
        }
        return 1
      }
    }
  })
}
