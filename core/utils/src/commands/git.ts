import path from 'path'
import chalk from 'chalk'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

const CORS_PROXY = 'https://cors.isomorphic-git.org'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: git [COMMAND] [OPTIONS] [ARGS...]

Common Git commands:
  init              Initialize a new repository
  clone <url>       Clone a repository
  add <file>...     Add files to staging
  commit -m <msg>   Commit staged changes
  status            Show working tree status
  log               Show commit logs
  branch            List or create branches
  checkout <branch> Switch branches
  push              Push to remote
  pull              Pull from remote
  fetch             Fetch from remote
  diff              Show changes
  rm <file>...      Remove files from git
  config            Get/set configuration
  remote            Manage remotes

  --help            display this help and exit`
  writelnStderr(process, terminal, usage)
}

async function findGitDir(fs: typeof import('@zenfs/core').fs.promises, startDir: string): Promise<string | null> {
  let currentDir = startDir
  const root = '/'
  
  while (currentDir !== root && currentDir !== '') {
    const gitDir = path.join(currentDir, '.git')
    try {
      await fs.stat(gitDir)
      return gitDir
    } catch {
      const parent = path.dirname(currentDir)
      if (parent === currentDir) break
      currentDir = parent
    }
  }
  
  return null
}

async function getGitDir(fs: typeof import('@zenfs/core').fs.promises, cwd: string): Promise<string> {
  const gitDir = await findGitDir(fs, cwd)
  if (!gitDir) {
    throw new Error('not a git repository (or any of the parent directories)')
  }
  return path.dirname(gitDir)
}

async function handleInit(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const dir = args.length > 0 && args[0] ? path.resolve(shell.cwd, args[0]) : shell.cwd
  
  try {
    await git.init({ fs, dir })
    await writelnStdout(process, terminal, `Initialized empty Git repository in ${dir}/.git/`)
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

function convertSshToHttps(url: string): string {
  const sshPattern = /^git@([^:]+):(.+)$/
  const match = url.match(sshPattern)
  
  if (match) {
    const host = match[1]
    const path = match[2]
    return `https://${host}/${path}`
  }
  
  return url
}

async function handleClone(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  if (args.length === 0) {
    await writelnStderr(process, terminal, 'fatal: You must specify a repository to clone.')
    return 1
  }
  
  const url = args[0]
  if (!url) {
    await writelnStderr(process, terminal, 'fatal: You must specify a repository to clone.')
    return 1
  }
  
  const httpsUrl = convertSshToHttps(url)
  const dir = args.length > 1 && args[1] 
    ? path.resolve(shell.cwd, args[1]) 
    : path.resolve(shell.cwd, path.basename(httpsUrl.replace(/\.git$/, '')))
  
  try {
    await writelnStdout(process, terminal, `Cloning into '${path.basename(dir)}'...`)
    const token = shell.env.get('GITHUB_TOKEN')
    await git.clone({
      fs,
      http,
      dir,
      url: httpsUrl,
      corsProxy: shell.env.get('GIT_CORS_PROXY') || CORS_PROXY,
      onAuth: token ? () => ({ username: token }) : undefined
    })
    await writelnStdout(process, terminal, 'done.')
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function collectFilesRecursively(
  fs: typeof import('@zenfs/core').fs.promises,
  searchDir: string,
  gitDir: string
): Promise<string[]> {
  const files: string[] = []
  
  try {
    const entries = await fs.readdir(searchDir)
    for (const entry of entries) {
      if (entry === '.git') continue
      
      const entryPath = path.join(searchDir, entry)
      let entryStats
      try {
        entryStats = await fs.stat(entryPath)
      } catch {
        continue
      }
      
      if (entryStats.isDirectory()) {
        const subFiles = await collectFilesRecursively(fs, entryPath, gitDir)
        files.push(...subFiles)
      } else if (entryStats.isFile()) {
        const gitRelativePath = path.relative(gitDir, entryPath).replace(/\\/g, '/')
        if (gitRelativePath && !gitRelativePath.startsWith('..') && gitRelativePath !== '.git' && !gitRelativePath.startsWith('.git/')) {
          files.push(gitRelativePath)
        }
      }
    }
  } catch {
    // Skip directories that can't be accessed
  }
  
  return files
}

async function handleAdd(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  if (args.length === 0) {
    await writelnStderr(process, terminal, 'Nothing specified, nothing added.')
    return 0
  }
  
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const filesToAdd = new Set<string>()
    
    for (const file of args) {
      if (!file) continue
      
      const targetPath = path.resolve(shell.cwd, file)
      try {
        const stats = await fs.stat(targetPath)
        
        if (stats.isDirectory()) {
          const collectedFiles = await collectFilesRecursively(fs, targetPath, dir)
          for (const filePath of collectedFiles) {
            if (filePath && filePath !== '.git' && !filePath.startsWith('.git/')) {
              filesToAdd.add(filePath)
            }
          }
        } else if (stats.isFile()) {
          const gitRelativePath = path.relative(dir, targetPath).replace(/\\/g, '/')
          if (gitRelativePath && !gitRelativePath.startsWith('..') && gitRelativePath !== '.git' && !gitRelativePath.startsWith('.git/')) {
            filesToAdd.add(gitRelativePath)
          }
        }
      } catch {
        continue
      }
    }
    
    let hasError = false
    for (const filePath of filesToAdd) {
      try {
        await git.add({ fs, dir, filepath: filePath })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `error: ${errorMessage}`)
        hasError = true
      }
    }
    
    return hasError ? 1 : 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleCommit(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  let message: string | undefined
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-m' && i + 1 < args.length) {
      message = args[i + 1]
      i++
    } else if (args[i] === '--message' && i + 1 < args.length) {
      message = args[i + 1]
      i++
    } else if (args[i]?.startsWith('-m')) {
      message = args[i]?.slice(2) || undefined
    }
  }
  
  if (!message) {
    await writelnStderr(process, terminal, 'Aborting commit due to empty commit message.')
    return 1
  }
  
  try {
    const dir = await getGitDir(fs, shell.cwd)
    
    const username = shell.env.get('USER') || 'root'
    const email = shell.env.get('EMAIL') || `${username}@${shell.env.get('HOSTNAME') || 'localhost'}`
    
    const sha = await git.commit({
      fs,
      dir,
      message,
      author: {
        name: username,
        email
      }
    })
    
    await writelnStdout(process, terminal, `[${sha.slice(0, 7)}] ${message}`)
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleStatus(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  _args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const statusMatrix = await git.statusMatrix({ fs, dir })
    
    const modified: string[] = []
    const added: string[] = []
    const deleted: string[] = []
    const untracked: string[] = []
    
    for (const [filepath, headStatus, workdirStatus, stageStatus] of statusMatrix) {
      if (headStatus === 0 && stageStatus === 2) {
        added.push(filepath)
      } else if (headStatus === 1 && workdirStatus === 0) {
        deleted.push(filepath)
      } else if (headStatus === 1 && workdirStatus === 2) {
        modified.push(filepath)
      } else if (headStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
        untracked.push(filepath)
      }
    }
    
    if (modified.length === 0 && added.length === 0 && deleted.length === 0 && untracked.length === 0) {
      await writelnStdout(process, terminal, 'nothing to commit, working tree clean')
      return 0
    }
    
    if (modified.length > 0) {
      await writelnStdout(process, terminal, chalk.red('modified:   ') + modified.join(' '))
    }
    if (added.length > 0) {
      await writelnStdout(process, terminal, chalk.green('new file:   ') + added.join(' '))
    }
    if (deleted.length > 0) {
      await writelnStdout(process, terminal, chalk.red('deleted:    ') + deleted.join(' '))
    }
    if (untracked.length > 0) {
      await writelnStdout(process, terminal, chalk.yellow('untracked:  ') + untracked.join(' '))
    }
    
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleLog(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  let depth = 10
  let oneline = false
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--oneline') {
      oneline = true
    } else if (args[i] === '-n' && i + 1 < args.length) {
      depth = parseInt(args[i + 1] || '10', 10) || depth
      i++
    } else if (args[i]?.startsWith('-n')) {
      depth = parseInt(args[i]?.slice(2) || '10', 10) || depth
    }
  }
  
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const commits = await git.log({ fs, dir, depth })
    
    for (const commit of commits) {
      const commitObj = await git.readCommit({ fs, dir, oid: commit.oid })
      if (oneline) {
        await writelnStdout(process, terminal, `${chalk.yellow(commit.oid.slice(0, 7))} ${commitObj.commit.message.split('\n')[0]}`)
      } else {
        await writelnStdout(process, terminal, `commit ${chalk.yellow(commit.oid)}`)
        await writelnStdout(process, terminal, `Author: ${commitObj.commit.author.name} <${commitObj.commit.author.email}>`)
        await writelnStdout(process, terminal, `Date:   ${new Date(commitObj.commit.author.timestamp * 1000).toLocaleString()}`)
        await writelnStdout(process, terminal, '')
        for (const line of commitObj.commit.message.split('\n')) {
          await writelnStdout(process, terminal, `    ${line}`)
        }
        await writelnStdout(process, terminal, '')
      }
    }
    
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleBranch(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    
    if (args.length === 0) {
      const branches = await git.listBranches({ fs, dir })
      const currentBranch = await git.currentBranch({ fs, dir })
      
      for (const branch of branches) {
        if (branch === currentBranch) {
          await writelnStdout(process, terminal, chalk.green(`* ${branch}`))
        } else {
          await writelnStdout(process, terminal, `  ${branch}`)
        }
      }
      return 0
    }
    
    const branchName = args[0]
    if (!branchName) {
      await writelnStderr(process, terminal, 'fatal: branch name required')
      return 1
    }
    await git.branch({ fs, dir, ref: branchName, checkout: false })
    await writelnStdout(process, terminal, `Created branch '${branchName}'`)
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleCheckout(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  if (args.length === 0) {
    await writelnStderr(process, terminal, 'fatal: You must specify a branch to checkout.')
    return 1
  }
  
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const branch = args[0]
    
    await git.checkout({ fs, dir, ref: branch })
    await writelnStdout(process, terminal, `Switched to branch '${branch}'`)
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handlePush(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const remote = args[0] || 'origin'
    const currentBranch = await git.currentBranch({ fs, dir })
    const ref = args[1] || currentBranch || 'main'
    
    if (!ref) {
      await writelnStderr(process, terminal, 'fatal: No branch specified and unable to determine current branch.')
      return 1
    }
    
    await writelnStdout(process, terminal, `Pushing to ${remote}...`)
    const token = shell.env.get('GITHUB_TOKEN')
    await git.push({
      fs,
      http,
      dir,
      remote,
      ref,
      corsProxy: CORS_PROXY,
      onAuth: token ? () => ({ username: token }) : undefined
    })
    await writelnStdout(process, terminal, 'done.')
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handlePull(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const remote = args[0] || 'origin'
    const currentBranch = await git.currentBranch({ fs, dir })
    const ref = args[1] || currentBranch || 'main'
    
    if (!ref) {
      await writelnStderr(process, terminal, 'fatal: No branch specified and unable to determine current branch.')
      return 1
    }
    
    await writelnStdout(process, terminal, `Pulling from ${remote}...`)
    const token = shell.env.get('GITHUB_TOKEN')
    await git.pull({
      fs,
      http,
      dir,
      remote,
      ref,
      corsProxy: CORS_PROXY,
      onAuth: token ? () => ({ username: token }) : undefined
    })
    await writelnStdout(process, terminal, 'done.')
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleFetch(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    const remote = args[0] || 'origin'
    
    await writelnStdout(process, terminal, `Fetching from ${remote}...`)
    const token = shell.env.get('GITHUB_TOKEN')
    await git.fetch({
      fs,
      http,
      dir,
      remote,
      corsProxy: CORS_PROXY,
      onAuth: token ? () => ({ username: token }) : undefined
    })
    await writelnStdout(process, terminal, 'done.')
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleDiff(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    
    if (args.length > 0 && args[0]) {
      const filepath = path.relative(dir, path.resolve(shell.cwd, args[0]))
      const status = await git.status({ fs, dir, filepath })
      if (status === '*modified' || status === '*added' || status === '*deleted') {
        await writelnStdout(process, terminal, `diff --git a/${filepath} b/${filepath}`)
        await writelnStdout(process, terminal, `--- a/${filepath}`)
        await writelnStdout(process, terminal, `+++ b/${filepath}`)
        await writelnStdout(process, terminal, `Status: ${status}`)
      } else {
        await writelnStdout(process, terminal, `No changes to ${filepath}`)
      }
    } else {
      const statusMatrix = await git.statusMatrix({ fs, dir })
      for (const [filepath] of statusMatrix) {
        await writelnStdout(process, terminal, `diff --git a/${filepath} b/${filepath}`)
      }
    }
    
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleRm(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  if (args.length === 0) {
    await writelnStderr(process, terminal, 'Nothing specified, nothing removed.')
    return 0
  }
  
  try {
    const dir = await getGitDir(fs, shell.cwd)
    
    for (const file of args) {
      if (!file) continue
      const filePath = path.relative(dir, path.resolve(shell.cwd, file))
      try {
        await git.remove({ fs, dir, filepath: filePath })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `error: ${errorMessage}`)
      }
    }
    return 0
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleRemote(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    
    if (args.length === 0) {
      const remotes = await git.listRemotes({ fs, dir })
      for (const remote of remotes) {
        await writelnStdout(process, terminal, remote.remote)
      }
      return 0
    }
    
    if (args[0] === '-v' || args[0] === '--verbose') {
      const remotes = await git.listRemotes({ fs, dir })
      for (const remote of remotes) {
        await writelnStdout(process, terminal, `${remote.remote}\t${remote.url} (fetch)`)
        await writelnStdout(process, terminal, `${remote.remote}\t${remote.url} (push)`)
      }
      return 0
    }
    
    if (args[0] === 'add' && args.length === 3 && args[1] && args[2]) {
      const httpsUrl = convertSshToHttps(args[2])
      await git.setConfig({ fs, dir, path: `remote.${args[1]}.url`, value: httpsUrl })
      return 0
    }
    
    if ((args[0] === 'remove' || args[0] === 'rm') && args.length === 2 && args[1]) {
      try {
        const configFile = path.join(dir, '.git', 'config')
        const configContent = await fs.readFile(configFile, 'utf-8')
        const lines = configContent.split('\n')
        const newLines: string[] = []
        let skipSection = false
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (!line) continue
          if (line.trim() === `[remote "${args[1]}"]`) {
            skipSection = true
            continue
          }
          if (skipSection && line.trim().startsWith('[')) {
            skipSection = false
          }
          if (!skipSection) {
            newLines.push(line)
          }
        }
        
        await fs.writeFile(configFile, newLines.join('\n'), 'utf-8')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
        return 1
      }
      return 0
    }
    
    if (args[0] === 'set-url' && args.length === 3 && args[1] && args[2]) {
      const httpsUrl = convertSshToHttps(args[2])
      await git.setConfig({ fs, dir, path: `remote.${args[1]}.url`, value: httpsUrl })
      return 0
    }
    
    if (args[0] === 'show' && args.length === 2 && args[1]) {
      try {
        const url = await git.getConfig({ fs, dir, path: `remote.${args[1]}.url` })
        if (url) {
          await writelnStdout(process, terminal, `* remote ${args[1]}`)
          await writelnStdout(process, terminal, `  Fetch URL: ${url}`)
          await writelnStdout(process, terminal, `  Push  URL: ${url}`)
        } else {
          await writelnStderr(process, terminal, `fatal: No such remote '${args[1]}'`)
          return 1
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
        return 1
      }
      return 0
    }
    
    await writelnStderr(process, terminal, 'usage: git remote [-v | --verbose]')
    await writelnStderr(process, terminal, '   or: git remote add <name> <url>')
    await writelnStderr(process, terminal, '   or: git remote remove <name>')
    await writelnStderr(process, terminal, '   or: git remote set-url <name> <url>')
    await writelnStderr(process, terminal, '   or: git remote show <name>')
    return 1
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

async function handleConfig(
  fs: typeof import('@zenfs/core').fs.promises,
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  try {
    const dir = await getGitDir(fs, shell.cwd)
    
    if (args.length === 0) {
      try {
        const configFile = path.join(dir, '.git', 'config')
        const configContent = await fs.readFile(configFile, 'utf-8')
        const lines = configContent.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith('#') && trimmed.includes('=')) {
            await writelnStdout(process, terminal, trimmed)
          }
        }
      } catch {
        await writelnStdout(process, terminal, 'No configuration found')
      }
      return 0
    }
    
    if (args.length === 1 && args[0]) {
      const value = await git.getConfig({ fs, dir, path: args[0] })
      if (value) {
        await writelnStdout(process, terminal, value)
      }
      return 0
    }
    
    if (args.length === 2 && args[0] && args[1]) {
      await git.setConfig({ fs, dir, path: args[0], value: args[1] })
      return 0
    }
    
    await writelnStderr(process, terminal, 'usage: git config <key> [value]')
    return 1
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'git',
    description: 'Git version control system',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined
      
      if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))) {
        printUsage(process, terminal)
        return 0
      }
      
      const subcommand = argv[0]
      const args = argv.slice(1)
      const fs = shell.context.fs.promises
      
      try {
        switch (subcommand) {
          case 'init':
            return await handleInit(fs, shell, terminal, process, args)
          case 'clone':
            return await handleClone(fs, shell, terminal, process, args)
          case 'add':
            return await handleAdd(fs, shell, terminal, process, args)
          case 'commit':
            return await handleCommit(fs, shell, terminal, process, args)
          case 'status':
            return await handleStatus(fs, shell, terminal, process, args)
          case 'log':
            return await handleLog(fs, shell, terminal, process, args)
          case 'branch':
            return await handleBranch(fs, shell, terminal, process, args)
          case 'checkout':
            return await handleCheckout(fs, shell, terminal, process, args)
          case 'push':
            return await handlePush(fs, shell, terminal, process, args)
          case 'pull':
            return await handlePull(fs, shell, terminal, process, args)
          case 'fetch':
            return await handleFetch(fs, shell, terminal, process, args)
          case 'diff':
            return await handleDiff(fs, shell, terminal, process, args)
          case 'rm':
            return await handleRm(fs, shell, terminal, process, args)
          case 'config':
            return await handleConfig(fs, shell, terminal, process, args)
          case 'remote':
            return await handleRemote(fs, shell, terminal, process, args)
          default:
            await writelnStderr(process, terminal, `git: '${subcommand}' is not a git command. See 'git --help'.`)
            return 1
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        await writelnStderr(process, terminal, `fatal: ${errorMessage}`)
        return 1
      }
    }
  })
}
