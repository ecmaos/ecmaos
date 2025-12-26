import chalk from 'chalk'
import path from 'path'

import { CommandArgs } from './'

const uninstall = async ({ kernel, terminal, args }: CommandArgs) => {
  const [packageArg] = args as [string]
  if (!packageArg) {
    terminal.writeln(chalk.red('Usage: uninstall <package-name>[@version]'))
    return 1
  }

  const spec = packageArg.match(/(@[^/]+\/[^@]+|[^@]+)(?:@([^/]+))?/)
  if (!spec) {
    terminal.writeln(chalk.red('Invalid package name format'))
    return 1
  }

  const packageName = spec[1]?.replace('vnpm:', '')
  const version = spec[2]

  if (!packageName) {
    terminal.writeln(chalk.red('Invalid package name format'))
    return 1
  }

  const packageDir = path.join('/usr/lib', packageName)
  
  // Check if package is installed
  if (!await kernel.filesystem.fs.exists(packageDir)) {
    terminal.writeln(chalk.red(`Package ${packageName} is not installed`))
    return 1
  }

  try {
    // Get installed versions
    const versions = await kernel.filesystem.fs.readdir(packageDir)
    
    if (versions.length === 0) {
      terminal.writeln(chalk.red(`No versions found for ${packageName}`))
      return 1
    }

    // If version is specified, uninstall only that version
    // Otherwise, uninstall all versions
    const versionsToUninstall = version 
      ? versions.filter(v => v === version)
      : versions

    if (version && versionsToUninstall.length === 0) {
      terminal.writeln(chalk.red(`Version ${version} of ${packageName} is not installed`))
      terminal.writeln(chalk.yellow(`Installed versions: ${versions.join(', ')}`))
      return 1
    }

    // Uninstall each version
    for (const versionToUninstall of versionsToUninstall) {
      const versionPath = path.join(packageDir, versionToUninstall)
      const packagePath = path.join(versionPath, 'package.json')

      if (!await kernel.filesystem.fs.exists(packagePath)) {
        terminal.writeln(chalk.yellow(`Warning: package.json not found for ${packageName}@${versionToUninstall}, skipping binary unlinking`))
      } else {
        try {
          // Read package.json to find binaries to unlink
          const packageData = await kernel.filesystem.fs.readFile(packagePath, 'utf-8')
          const packageJson = JSON.parse(packageData)

          // Unlink binaries
          if (packageJson.bin) {
            if (typeof packageJson.bin === 'string') {
              const binPath = path.join('/usr/bin', packageJson.name)
              try {
                await kernel.filesystem.fs.unlink(binPath)
                terminal.writeln(chalk.blue(`Unlinked ${packageJson.name} from ${binPath}`))
              } catch (error) {
                // Binary might not exist or might not be a symlink, continue anyway
                terminal.writeln(chalk.yellow(`Warning: Could not unlink ${binPath}: ${error instanceof Error ? error.message : 'Unknown error'}`))
              }
            } else if (typeof packageJson.bin === 'object') {
              for (const bin in packageJson.bin) {
                const binPath = path.join('/usr/bin', bin)
                try {
                  await kernel.filesystem.fs.unlink(binPath)
                  terminal.writeln(chalk.blue(`Unlinked ${bin} from ${binPath}`))
                } catch (error) {
                  // Binary might not exist or might not be a symlink, continue anyway
                  terminal.writeln(chalk.yellow(`Warning: Could not unlink ${binPath}: ${error instanceof Error ? error.message : 'Unknown error'}`))
                }
              }
            }
          }
        } catch (error) {
          terminal.writeln(chalk.yellow(`Warning: Failed to read package.json for ${packageName}@${versionToUninstall}: ${error instanceof Error ? error.message : 'Unknown error'}`))
        }
      }

      // Remove the package version directory
      try {
        await kernel.filesystem.fs.rm(versionPath, { recursive: true, force: true })
        terminal.writeln(chalk.green(`Uninstalled ${packageName}@${versionToUninstall}`))
      } catch (error) {
        terminal.writeln(chalk.red(`Failed to remove ${versionPath}: ${error instanceof Error ? error.message : 'Unknown error'}`))
        return 1
      }
    }

    // If all versions were uninstalled, remove the package directory
    const remainingVersions = await kernel.filesystem.fs.readdir(packageDir).catch(() => [])
    if (remainingVersions.length === 0) {
      try {
        await kernel.filesystem.fs.rmdir(packageDir)
      } catch {
        // Directory might not be empty or might have already been removed, that's okay
        terminal.writeln(chalk.yellow(`Warning: Could not remove package directory ${packageDir}`))
      }
    }

    return 0
  } catch (error) {
    terminal.writeln(chalk.red(`Failed to uninstall ${packageName}: ${error instanceof Error ? error.message : 'Unknown error'}`))
    return 1
  }
}

export default uninstall

