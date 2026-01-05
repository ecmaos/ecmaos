import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: play [OPTIONS] [FILE...]
Play an audio file.

  --help                   display this help and exit
  --no-autoplay            don't start playing automatically
  --loop                   loop the audio
  --muted                  start muted
  --volume <0-100>         set volume (0-100, default: 100)
  --quiet                  play without opening a window (background playback)

Examples:
  play song.mp3                    play an audio file
  play --loop music.mp3           play audio in a loop
  play --no-autoplay audio.mp3    load audio without auto-playing
  play --volume 50 track.mp3      play at 50% volume
  play --quiet background.mp3      play audio in background
  play song1.mp3 song2.mp3        play multiple audio files`
  writelnStderr(process, terminal, usage)
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/opus',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
    '.wma': 'audio/x-ms-wma',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.3gp': 'audio/3gpp',
    '.amr': 'audio/amr'
  }
  return mimeTypes[ext] || 'audio/mpeg'
}

async function loadAudioMetadata(audioElement: HTMLAudioElement): Promise<{ duration: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout loading audio metadata'))
    }, 10000)

    audioElement.onloadedmetadata = () => {
      clearTimeout(timeout)
      resolve({
        duration: audioElement.duration
      })
    }

    audioElement.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to load audio metadata'))
    }
  })
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '?:??'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'play',
    description: 'Play an audio file',
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

      // Parse options
      const options: {
        autoplay: boolean
        loop: boolean
        muted: boolean
        volume: number
        quiet: boolean
      } = {
        autoplay: true,
        loop: false,
        muted: false,
        volume: 100,
        quiet: false
      }

      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--no-autoplay') {
          options.autoplay = false
        } else if (arg === '--loop') {
          options.loop = true
        } else if (arg === '--muted') {
          options.muted = true
        } else if (arg === '--quiet') {
          options.quiet = true
        } else if (arg === '--volume' && i + 1 < argv.length) {
          const volumeArg = argv[i + 1]
          if (!volumeArg) {
            await writelnStderr(process, terminal, chalk.red(`play: missing volume value`))
            return 1
          }
          const volume = parseFloat(volumeArg)
          if (isNaN(volume) || volume < 0 || volume > 100) {
            await writelnStderr(process, terminal, chalk.red(`play: invalid volume: ${volumeArg} (must be 0-100)`))
            return 1
          }
          options.volume = volume
          i++ // Skip next argument
        } else if (arg && !arg.startsWith('--')) {
          files.push(arg)
        }
      }

      if (files.length === 0) {
        await writelnStderr(process, terminal, `play: missing file argument`)
        await writelnStderr(process, terminal, `Try 'play --help' for more information.`)
        return 1
      }

      // Process each audio file
      for (const file of files) {
        const fullPath = path.resolve(shell.cwd, file)

        try {
          // Check if file exists
          if (!(await shell.context.fs.promises.exists(fullPath))) {
            await writelnStderr(process, terminal, chalk.red(`play: file not found: ${fullPath}`))
            continue
          }

          // Read file
          await writelnStdout(process, terminal, chalk.blue(`Loading audio: ${file}...`))
          const fileData = await shell.context.fs.promises.readFile(fullPath)
          const mimeType = getMimeType(fullPath)
          const blob = new Blob([new Uint8Array(fileData)], { type: mimeType })
          const url = URL.createObjectURL(blob)

          // Load audio metadata
          const audioElement = document.createElement('audio')
          audioElement.src = url
          audioElement.preload = 'metadata'

          let duration = 0

          try {
            const metadata = await loadAudioMetadata(audioElement)
            duration = metadata.duration
          } catch (error) {
            await writelnStderr(process, terminal, chalk.yellow(`play: warning: could not load metadata for ${file}`))
          }

          // Set audio properties
          audioElement.volume = options.volume / 100
          if (options.autoplay) audioElement.autoplay = true
          if (options.loop) audioElement.loop = true
          if (options.muted) audioElement.muted = true

          if (options.quiet) {
            // Background playback - no window
            audioElement.play().catch((error) => {
              // Autoplay may be blocked by browser, but that's okay for quiet mode
              console.warn('Autoplay blocked:', error)
            })
            
            if (duration > 0) {
              const durationStr = formatDuration(duration)
              await writelnStdout(process, terminal, chalk.green(`Playing in background: ${file} (${durationStr})`))
            } else {
              await writelnStdout(process, terminal, chalk.green(`Playing in background: ${file}`))
            }
          } else {
            // Create a simple audio player window
            const windowTitle = files.length > 1
              ? `${path.basename(file)} (${files.indexOf(file) + 1}/${files.length})`
              : path.basename(file)

            // Create audio player HTML with controls
            const audioId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
            const audioHtml = `
              <div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1e1e1e;color:#fff;font-family:monospace;padding:20px;box-sizing:border-box;">
                <div style="font-size:18px;margin-bottom:20px;text-align:center;word-break:break-word;">${path.basename(file)}</div>
                <audio id="${audioId}" src="${url}" ${options.autoplay ? 'autoplay' : ''} ${options.loop ? 'loop' : ''} ${options.muted ? 'muted' : ''} controls style="width:100%;max-width:600px;"></audio>
              </div>
              <script>
                (function() {
                  const audio = document.getElementById('${audioId}');
                  if (audio) {
                    audio.volume = ${options.volume / 100};
                    audio.addEventListener('play', () => console.log('Playing: ${file}'));
                    audio.addEventListener('ended', () => console.log('Finished: ${file}'));
                  }
                })();
              </script>
            `

            kernel.windows.create({
              title: windowTitle,
              html: audioHtml,
              width: 500,
              height: 200,
              max: false
            })

            if (duration > 0) {
              const durationStr = formatDuration(duration)
              await writelnStdout(process, terminal, chalk.green(`Playing: ${file} (${durationStr})`))
            } else {
              await writelnStdout(process, terminal, chalk.green(`Playing: ${file}`))
            }
          }
        } catch (error) {
          await writelnStderr(process, terminal, chalk.red(`play: error playing ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`))
          return 1
        }
      }

      return 0
    }
  })
}
