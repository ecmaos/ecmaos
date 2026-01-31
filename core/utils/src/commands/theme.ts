import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'
import { ThemePresets } from '@ecmaos/types'
import { parse, stringify } from 'smol-toml'
import path from 'path'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: theme [OPTION]... [THEME_NAME]
List or switch themes.

  -s, --save    save the theme to ~/.config/shell.toml
  -h, --help    display this help and exit`
  writelnStderr(process, terminal, usage)
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'theme',
    description: 'List or switch themes',
    kernel,
    shell,
    terminal,
    run: async (pid: number, argv: string[]) => {
      const process = kernel.processes.get(pid) as Process | undefined

      let save = false
      let themeName: string | undefined

      for (const arg of argv) {
        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg === '--save' || arg === '-s') {
          save = true
        } else if (!arg.startsWith('-')) {
          themeName = arg
        }
      }

      // List themes if no theme name provided
      if (!themeName) {
        const themes = Object.keys(ThemePresets).sort().join('\n')
        await writelnStdout(process, terminal, themes)
        return 0
      }

      // Check if theme exists
      // The shell's setTheme also handles custom theme objects, but for this CLI we only support presets
      if (!ThemePresets[themeName]) {
        // Try strict case matching first, then case-insensitive
        const match = Object.keys(ThemePresets).find(t => t.toLowerCase() === themeName!.toLowerCase())
        if (match) {
          themeName = match
        } else {
          await writelnStderr(process, terminal, `Theme '${themeName}' not found`)
          return 1
        }
      }

      // Apply theme
      try {
        shell.config.setTheme(themeName)
        await writelnStdout(process, terminal, `Switched to theme: ${themeName}`)
      } catch (error) {
        await writelnStderr(process, terminal, `Failed to switch theme: ${error}`)
        return 1
      }

      // Save if requested
      if (save) {
        try {
          const home = shell.env.get('HOME')
          if (!home) {
             await writelnStderr(process, terminal, 'HOME environment variable not set, cannot save config')
             return 1
          }

          const configDir = path.join(home, '.config')
          if (!await shell.context.fs.promises.exists(configDir)) {
            await shell.context.fs.promises.mkdir(configDir, { recursive: true })
          }

          const configPath = path.join(configDir, 'shell.toml')
          let config: any = {}

          if (await shell.context.fs.promises.exists(configPath)) {
            const content = await shell.context.fs.promises.readFile(configPath, 'utf-8')
            try {
              config = parse(content)
            } catch (e) {
              await writelnStderr(process, terminal, `Warning: Failed to parse existing config, creating new one`)
            }
          }

          // Update theme section
          config.theme = config.theme || {}
          config.theme.name = themeName

          // Write back
          // Note: smol-toml stringify might be limited, but for this simple case it should work. 
          // If the existing toml is complex, we might lose comments/formatting. 
          // shell.ts uses smol-toml for parsing.
          const newContent = stringify(config)
          await shell.context.fs.promises.writeFile(configPath, newContent)
          
          await writelnStdout(process, terminal, `Theme saved to ${configPath}`)

        } catch (error) {
           await writelnStderr(process, terminal, `Failed to save config: ${error}`)
           return 1
        }
      }

      return 0
    }
  })
}
