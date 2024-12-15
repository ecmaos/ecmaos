import type { DeviceDriver, DeviceFile } from '@zenfs/core'
import type { Kernel, KernelDeviceCLIOptions, KernelDeviceData } from '@ecmaos/types'

interface AudioDeviceData extends KernelDeviceData {
  context?: AudioContext
  sourceNode?: AudioBufferSourceNode
  stream?: MediaStream
  recorder?: MediaRecorder
  latestAudioData?: Uint8Array
}

export const pkg = {
  name: 'audio',
  version: '0.1.0',
  description: 'Web Audio API device driver'
}

export async function cli(options: KernelDeviceCLIOptions) {
  options.kernel.log.debug(`${pkg.name} CLI`, options.args)

  const usage = `
Usage: audio <command>

Commands:
  test    Play a test sequence of beeps
  --help  Show this help message
`

  if (!options.args.length || options.args[0] === '--help') {
    options.terminal.writeln(usage)
    return 0
  }

  switch (options.args[0]) {
    case 'test':
      await test(options.kernel)
      break
    default:
      options.terminal.writeln(`Unknown command: ${options.args[0]}`)
      options.terminal.writeln(usage)
      return 1
  }

  return 0
}

async function test(kernel: Kernel) {
  const sampleRate = 44100
  const noteLength = 0.25  // 250ms for regular notes
  const shortNoteLength = 0.125  // 125ms for shorter notes
  const gap = 0.05  // 50ms gap between notes
  const finalGap = 0.3  // Longer gap before last two notes

  // Musical note frequencies (in Hz) for "Shave and a Haircut"
  const notes = [
    783.99,  // G5
    523.25,  // C5
    523.25,  // C5
    659.25,  // E5
    587.33,  // D5
    0,       // Rest
    698.46,  // F5
    783.99   // G5
  ]
  
  const durations = [
    noteLength,
    shortNoteLength,
    shortNoteLength,
    noteLength,
    noteLength,
    finalGap,
    noteLength,
    noteLength
  ]

  // Calculate total samples needed
  const totalSamples = Math.floor(sampleRate * 
    (durations.reduce((a, b) => a + b, 0) + (gap * (notes.length - 1))))

  // Create WAV header (44 bytes)
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  
  // "RIFF" chunk descriptor
  view.setUint32(0, 0x52494646, false) // "RIFF"
  view.setUint32(4, 36 + totalSamples * 2, true) // File size - 8
  view.setUint32(8, 0x57415645, false) // "WAVE"
  
  // "fmt " sub-chunk
  view.setUint32(12, 0x666D7420, false) // "fmt "
  view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true) // NumChannels (1 for mono)
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, sampleRate * 2, true) // ByteRate
  view.setUint16(32, 2, true) // BlockAlign
  view.setUint16(34, 16, true) // BitsPerSample
  
  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false) // "data"
  view.setUint32(40, totalSamples * 2, true) // Subchunk2Size

  // Create audio data
  const audioData = new ArrayBuffer(totalSamples * 2)
  const audioView = new DataView(audioData)

  // Generate audio data
  let offset = 0
  for (let i = 0; i < notes.length; i++) {
    const freq = notes[i]
    const samples = Math.floor(sampleRate * (durations[i] || 0))
    
    // Generate note or rest
    for (let j = 0; j < samples; j++) {
      const t = j / sampleRate
      const sample = freq === 0 ? 0 : Math.sin(2 * Math.PI * (freq || 0) * t) * 0x7FFF
      audioView.setInt16(offset * 2, sample, true)
      offset++
    }
    
    // Add gap after each note except the last
    if (i < notes.length - 1) {
      const gapSamples = Math.floor(sampleRate * gap)
      for (let j = 0; j < gapSamples; j++) {
        audioView.setInt16(offset * 2, 0, true)
        offset++
      }
    }
  }

  // Combine header and audio data
  const finalBuffer = new Uint8Array(header.byteLength + audioData.byteLength)
  finalBuffer.set(new Uint8Array(header), 0)
  finalBuffer.set(new Uint8Array(audioData), header.byteLength)

  try {
    kernel.terminal.writeln('Playing test beeps...')
    const fd = await kernel.filesystem.fs.open('/dev/audio', 'w', 0o666)
    await fd.write(finalBuffer)
    await fd.close()
  } catch (error) {
    kernel.terminal.writeln(`Error playing audio: ${error}`)
    return 1
  }

  return 0
}

export async function getDrivers(kernel: Kernel): Promise<DeviceDriver<AudioDeviceData>[]> {
  const drivers: DeviceDriver<AudioDeviceData>[] = []

  drivers.push({
    name: 'audio',
    init: () => ({
      major: 14,
      minor: 4,
      data: { 
        version: pkg.version,
        kernel: kernel.id,
        context: new AudioContext()
      } 
    }),
    read: (file: DeviceFile, buffer: ArrayBufferView, offset: number, length: number) => {
      const deviceData = file.device.data as AudioDeviceData
      if (!deviceData.context) return 0

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          return 0
        }

        if (!deviceData.stream || !deviceData.recorder) {
          navigator.mediaDevices.getUserMedia({ 
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            }
          }).then(stream => {
            deviceData.stream = stream
            deviceData.recorder = new MediaRecorder(stream)
            
            deviceData.recorder.ondataavailable = (event) => {
              event.data.arrayBuffer().then(buffer => {
                deviceData.latestAudioData = new Uint8Array(buffer)
              })
            }
            
            deviceData.recorder.start(100)
          }).catch(err => {
            console.error('Failed to initialize audio input:', err)
          })
          return 0
        }

        if (!deviceData.latestAudioData) return 0

        const view = new Uint8Array(buffer.buffer)
        const bytesToCopy = Math.min(length, deviceData.latestAudioData.length)
        view.set(deviceData.latestAudioData.subarray(0, bytesToCopy), offset)

        return bytesToCopy
      } catch (error) {
        console.error('Audio input error:', error)
        return 0
      }
    },
    write: (file: DeviceFile, buffer: ArrayBufferView, offset: number, length: number) => {
      const deviceData = file.device.data as AudioDeviceData
      if (!deviceData.context) return 0

      try {
        const view = new Uint8Array(buffer.buffer)
        const tempBuffer = view.slice(offset, offset + length)
        const audioData = new ArrayBuffer(tempBuffer.length)
        new Uint8Array(audioData).set(tempBuffer)
        
        deviceData.context.decodeAudioData(audioData, 
          (audioBuffer) => {
            if (!deviceData.context) return 0
            const sourceNode = deviceData.context.createBufferSource()
            sourceNode.buffer = audioBuffer
            sourceNode.connect(deviceData.context.destination)
            
            deviceData.sourceNode = sourceNode
            sourceNode.start()
          },
          (error) => {
            console.error('Audio decoding error:', error)
          }
        )
        
        return length
      } catch (error) {
        console.error('Audio playback error:', error)
        return 0
      }
    }
  })

  return drivers
}
