import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

type FileType = 'pdf' | 'image' | 'audio' | 'video'

function detectFileType(filePath: string): FileType {
  const ext = path.extname(filePath).toLowerCase()
  
  // PDF
  if (ext === '.pdf') {
    return 'pdf'
  }
  
  // Images
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif']
  if (imageExts.includes(ext)) {
    return 'image'
  }
  
  // Audio
  const audioExts = ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.webm', '.wma', '.aiff', '.aif', '.3gp', '.amr']
  if (audioExts.includes(ext)) {
    return 'audio'
  }
  
  // Video
  const videoExts = ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.avi', '.mkv', '.m4v', '.flv', '.wmv', '.3gp']
  if (videoExts.includes(ext)) {
    return 'video'
  }
  
  // Default to image for unknown types (might be an image without extension)
  return 'image'
}

function getMimeType(filePath: string, fileType: FileType): string {
  const ext = path.extname(filePath).toLowerCase()
  
  if (fileType === 'pdf') {
    return 'application/pdf'
  }
  
  if (fileType === 'image') {
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.tiff': 'image/tiff',
      '.tif': 'image/tiff'
    }
    return mimeTypes[ext] || 'image/png'
  }
  
  if (fileType === 'audio') {
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
  
  if (fileType === 'video') {
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'video/ogg',
      '.ogv': 'video/ogg',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.m4v': 'video/mp4',
      '.flv': 'video/x-flv',
      '.wmv': 'video/x-ms-wmv',
      '.3gp': 'video/3gpp'
    }
    return mimeTypes[ext] || 'video/mp4'
  }
  
  return 'application/octet-stream'
}

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: view [OPTIONS] [FILE...]
View files in a new window. Supports PDF, images, audio, and video files.

  --help                   display this help and exit
  
Audio/Video Options (for audio and video files):
  --no-autoplay            don't start playing automatically
  --loop                   loop the media
  --muted                  start muted
  --volume <0-100>         set volume (0-100, default: 100, audio only)
  --no-controls            hide video controls (video only)
  --fullscreen             open in fullscreen mode (video only)
  --width <width>          set window width (video only)
  --height <height>        set window height (video only)
  --quiet                  play without opening a window (audio only, background playback)

Examples:
  view document.pdf                    view a PDF file
  view image.png                       view an image
  view song.mp3                        view/play an audio file
  view movie.mp4                       view/play a video file
  view --loop music.mp3               play audio in a loop
  view --no-autoplay video.mp4        load video without auto-playing
  view --volume 50 track.mp3         play at 50% volume
  view --fullscreen movie.mp4         play video in fullscreen mode`
  writelnStderr(process, terminal, usage)
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

async function loadVideoMetadata(videoElement: HTMLVideoElement): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout loading video metadata'))
    }, 10000)

    videoElement.onloadedmetadata = () => {
      clearTimeout(timeout)
      resolve({
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
        duration: videoElement.duration
      })
    }

    videoElement.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Failed to load video metadata'))
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
    command: 'view',
    description: 'View files in a new window (PDF, images, audio, video)',
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
        controls: boolean
        fullscreen: boolean
        quiet: boolean
        width?: number
        height?: number
      } = {
        autoplay: true,
        loop: false,
        muted: false,
        volume: 100,
        controls: true,
        fullscreen: false,
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
        } else if (arg === '--no-controls') {
          options.controls = false
        } else if (arg === '--fullscreen') {
          options.fullscreen = true
        } else if (arg === '--volume' && i + 1 < argv.length) {
          const volumeArg = argv[i + 1]
          if (!volumeArg) {
            await writelnStderr(process, terminal, chalk.red(`view: missing volume value`))
            return 1
          }
          const volume = parseFloat(volumeArg)
          if (isNaN(volume) || volume < 0 || volume > 100) {
            await writelnStderr(process, terminal, chalk.red(`view: invalid volume: ${volumeArg} (must be 0-100)`))
            return 1
          }
          options.volume = volume
          i++ // Skip next argument
        } else if (arg === '--width' && i + 1 < argv.length) {
          const widthArg = argv[i + 1]
          if (!widthArg) {
            await writelnStderr(process, terminal, chalk.red(`view: missing width value`))
            return 1
          }
          const width = parseInt(widthArg, 10)
          if (isNaN(width) || width <= 0) {
            await writelnStderr(process, terminal, chalk.red(`view: invalid width: ${widthArg}`))
            return 1
          }
          options.width = width
          i++ // Skip next argument
        } else if (arg === '--height' && i + 1 < argv.length) {
          const heightArg = argv[i + 1]
          if (!heightArg) {
            await writelnStderr(process, terminal, chalk.red(`view: missing height value`))
            return 1
          }
          const height = parseInt(heightArg, 10)
          if (isNaN(height) || height <= 0) {
            await writelnStderr(process, terminal, chalk.red(`view: invalid height: ${heightArg}`))
            return 1
          }
          options.height = height
          i++ // Skip next argument
        } else if (arg && !arg.startsWith('--')) {
          files.push(arg)
        }
      }

      if (files.length === 0) {
        await writelnStderr(process, terminal, `view: missing file argument`)
        await writelnStderr(process, terminal, `Try 'view --help' for more information.`)
        return 1
      }

      // Process each file
      for (const file of files) {
        const fullPath = path.resolve(shell.cwd, file)

        try {
          // Check if file exists
          if (!(await shell.context.fs.promises.exists(fullPath))) {
            await writelnStderr(process, terminal, chalk.red(`view: file not found: ${fullPath}`))
            continue
          }

          // Read file
          await writelnStdout(process, terminal, chalk.blue(`Loading: ${file}...`))
          const fileData = await shell.context.fs.promises.readFile(fullPath)
          const fileType = detectFileType(fullPath)
          const mimeType = getMimeType(fullPath, fileType)

          const windowTitle = files.length > 1
            ? `${path.basename(file)} (${files.indexOf(file) + 1}/${files.length})`
            : path.basename(file)

          if (fileType === 'pdf') {
            // Convert PDF to base64 and display in object tag
            // Use chunked encoding to avoid argument limit issues with large files
            const uint8Array = new Uint8Array(fileData)
            let binaryString = ''
            const chunkSize = 8192
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.subarray(i, i + chunkSize)
              binaryString += String.fromCharCode(...chunk)
            }
            const base64Data = btoa(binaryString)
            const dataUrl = `data:application/pdf;base64,${base64Data}`
            
            const pdfHtml = `
              <div style="width:100%;height:100%;display:flex;flex-direction:column;background:#1e1e1e;overflow:hidden;">
                <object data="${dataUrl}" type="application/pdf" style="width:100%;height:100%;flex:1;">
                  <p style="color:#fff;padding:20px;text-align:center;">
                    Your browser does not support PDFs. 
                    <a href="${dataUrl}" style="color:#4a9eff;" download="${path.basename(file)}">Download PDF</a>
                  </p>
                </object>
              </div>
            `

            kernel.windows.create({
              title: windowTitle,
              html: pdfHtml,
              width: 800,
              height: 600,
              max: false
            })

            await writelnStdout(process, terminal, chalk.green(`Viewing: ${file}`))
          } else if (fileType === 'image') {
            // Display image directly
            const blob = new Blob([new Uint8Array(fileData)], { type: mimeType })
            const url = URL.createObjectURL(blob)

            const imageHtml = `
              <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1e1e1e;overflow:auto;padding:20px;box-sizing:border-box;">
                <img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;" alt="${path.basename(file)}" />
              </div>
            `

            kernel.windows.create({
              title: windowTitle,
              html: imageHtml,
              width: 800,
              height: 600,
              max: false
            })

            await writelnStdout(process, terminal, chalk.green(`Viewing: ${file}`))
          } else if (fileType === 'audio') {
            // Handle audio similar to play command
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
              await writelnStderr(process, terminal, chalk.yellow(`view: warning: could not load metadata for ${file}`))
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
          } else if (fileType === 'video') {
            // Handle video similar to video command
            const blob = new Blob([new Uint8Array(fileData)], { type: mimeType })
            const url = URL.createObjectURL(blob)

            // Load video metadata
            const videoElement = document.createElement('video')
            videoElement.src = url
            videoElement.preload = 'metadata'

            let videoWidth: number
            let videoHeight: number
            let duration: number

            try {
              const metadata = await loadVideoMetadata(videoElement)
              videoWidth = metadata.width
              videoHeight = metadata.height
              duration = metadata.duration
            } catch (error) {
              await writelnStderr(process, terminal, chalk.yellow(`view: warning: could not load metadata for ${file}, using default size`))
              videoWidth = 640
              videoHeight = 360
              duration = 0
            }

            // Calculate window dimensions
            const { innerWidth, innerHeight } = window
            let windowWidth: number
            let windowHeight: number

            if (options.fullscreen) {
              windowWidth = innerWidth
              windowHeight = innerHeight
            } else if (options.width && options.height) {
              windowWidth = options.width
              windowHeight = options.height
            } else if (options.width) {
              windowWidth = options.width
              windowHeight = Math.round((videoHeight / videoWidth) * windowWidth)
            } else if (options.height) {
              windowHeight = options.height
              windowWidth = Math.round((videoWidth / videoHeight) * windowHeight)
            } else {
              // Auto-size: fit to screen if video is larger, otherwise use video dimensions
              const scale = Math.min(innerWidth / videoWidth, innerHeight / videoHeight, 1)
              windowWidth = Math.round(videoWidth * scale)
              windowHeight = Math.round(videoHeight * scale)
            }

            // Ensure minimum size
            windowWidth = Math.max(windowWidth, 320)
            windowHeight = Math.max(windowHeight, 180)

            // Build video attributes
            const videoAttrs: string[] = []
            if (options.autoplay) videoAttrs.push('autoplay')
            if (options.controls) videoAttrs.push('controls')
            if (options.loop) videoAttrs.push('loop')
            if (options.muted) videoAttrs.push('muted')
            videoAttrs.push('style="width:100%;height:100%;object-fit:contain"')

            const videoHtml = `<video src="${url}" ${videoAttrs.join(' ')}></video>`

            // Create window
            kernel.windows.create({
              title: windowTitle,
              html: videoHtml,
              width: windowWidth,
              height: windowHeight,
              max: options.fullscreen
            })

            if (duration > 0) {
              const minutes = Math.floor(duration / 60)
              const seconds = Math.floor(duration % 60)
              await writelnStdout(process, terminal, chalk.green(`Playing: ${file} (${minutes}:${seconds.toString().padStart(2, '0')})`))
            } else {
              await writelnStdout(process, terminal, chalk.green(`Playing: ${file}`))
            }
          }
        } catch (error) {
          await writelnStderr(process, terminal, chalk.red(`view: error viewing ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`))
          return 1
        }
      }

      return 0
    }
  })
}
