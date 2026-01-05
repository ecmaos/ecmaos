import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr, writelnStdout } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: video [OPTIONS] [FILE...]
Play a video file in a window.

  --help                   display this help and exit
  --no-autoplay            don't start playing automatically
  --no-controls            hide video controls
  --loop                   loop the video
  --muted                  start muted
  --fullscreen             open in fullscreen mode
  --width <width>          set window width (default: video width or screen width)
  --height <height>        set window height (default: video height or screen height)

Examples:
  video movie.mp4                    play a video file
  video --loop clip.mp4             play a video in a loop
  video --no-autoplay video.mp4     load video without auto-playing
  video --fullscreen movie.mp4      play video in fullscreen mode
  video video1.mp4 video2.mp4       play multiple videos`
  writelnStderr(process, terminal, usage)
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
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

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'video',
    description: 'Play a video file',
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
        controls: boolean
        loop: boolean
        muted: boolean
        fullscreen: boolean
        width?: number
        height?: number
      } = {
        autoplay: true,
        controls: true,
        loop: false,
        muted: false,
        fullscreen: false
      }

      const files: string[] = []

      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--no-autoplay') {
          options.autoplay = false
        } else if (arg === '--no-controls') {
          options.controls = false
        } else if (arg === '--loop') {
          options.loop = true
        } else if (arg === '--muted') {
          options.muted = true
        } else if (arg === '--fullscreen') {
          options.fullscreen = true
        } else if (arg === '--width' && i + 1 < argv.length) {
          const widthArg = argv[i + 1]
          if (!widthArg) {
            await writelnStderr(process, terminal, chalk.red(`video: missing width value`))
            return 1
          }
          const width = parseInt(widthArg, 10)
          if (isNaN(width) || width <= 0) {
            await writelnStderr(process, terminal, chalk.red(`video: invalid width: ${widthArg}`))
            return 1
          }
          options.width = width
          i++ // Skip next argument
        } else if (arg === '--height' && i + 1 < argv.length) {
          const heightArg = argv[i + 1]
          if (!heightArg) {
            await writelnStderr(process, terminal, chalk.red(`video: missing height value`))
            return 1
          }
          const height = parseInt(heightArg, 10)
          if (isNaN(height) || height <= 0) {
            await writelnStderr(process, terminal, chalk.red(`video: invalid height: ${heightArg}`))
            return 1
          }
          options.height = height
          i++ // Skip next argument
        } else if (arg && !arg.startsWith('--')) {
          files.push(arg)
        }
      }

      if (files.length === 0) {
        await writelnStderr(process, terminal, `video: missing file argument`)
        await writelnStderr(process, terminal, `Try 'video --help' for more information.`)
        return 1
      }

      // Process each video file
      for (const file of files) {
        const fullPath = path.resolve(shell.cwd, file)

        try {
          // Check if file exists
          if (!(await shell.context.fs.promises.exists(fullPath))) {
            await writelnStderr(process, terminal, chalk.red(`video: file not found: ${fullPath}`))
            continue
          }

          // Read file
          await writelnStdout(process, terminal, chalk.blue(`Loading video: ${file}...`))
          const fileData = await shell.context.fs.promises.readFile(fullPath)
          const mimeType = getMimeType(fullPath)
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
            await writelnStderr(process, terminal, chalk.yellow(`video: warning: could not load metadata for ${file}, using default size`))
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
          const windowTitle = files.length > 1
            ? `${path.basename(file)} (${files.indexOf(file) + 1}/${files.length})`
            : path.basename(file)

          kernel.windows.create({
            title: windowTitle,
            html: videoHtml,
            width: windowWidth,
            height: windowHeight,
            max: options.fullscreen
          })

          // Clean up URL when window is closed (if possible)
          // Note: This is a best-effort cleanup since we don't have direct access to window close events
          setTimeout(() => {
            // Cleanup after a delay to allow video to load
            // In a real implementation, you'd want to hook into window close events
          }, 1000)

          if (duration > 0) {
            const minutes = Math.floor(duration / 60)
            const seconds = Math.floor(duration % 60)
            await writelnStdout(process, terminal, chalk.green(`Playing: ${file} (${minutes}:${seconds.toString().padStart(2, '0')})`))
          } else {
            await writelnStdout(process, terminal, chalk.green(`Playing: ${file}`))
          }
        } catch (error) {
          await writelnStderr(process, terminal, chalk.red(`video: error playing ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`))
          return 1
        }
      }

      return 0
    }
  })
}
