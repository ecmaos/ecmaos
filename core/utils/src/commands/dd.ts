import path from 'path'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStderr } from '../shared/helpers.js'

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: dd [OPERAND]...
Copy a file, converting and formatting according to the operands.

Operands:

  if=FILE     read from FILE instead of stdin
  of=FILE     write to FILE instead of stdout
  bs=BYTES    read and write up to BYTES bytes at a time
  ibs=BYTES   read up to BYTES bytes at a time (default: 512)
  obs=BYTES   write BYTES bytes at a time (default: 512)
  count=N     copy only N input blocks
  skip=N      skip N input blocks before copying
  seek=N      skip N output blocks before copying
  conv=CONVS  convert the file as per the comma separated symbol list:
                ucase    convert to uppercase
                lcase    convert to lowercase
                swab     swap every pair of input bytes
                noerror  continue after read errors
                notrunc  do not truncate the output file
                sync     pad every input block to ibs

  status=LEVEL
              The LEVEL of information to print to stderr:
                'none'     suppress all output
                'noxfer'   suppress final transfer statistics
                'progress' show periodic transfer statistics

  --help      display this help and exit`
  writelnStderr(process, terminal, usage)
}

function parseBytes(value: string): number {
  const match = value.match(/^([0-9]+)([kmgKMG]?)$/)
  if (!match?.[1]) return NaN

  const num = parseInt(match[1], 10)
  if (isNaN(num)) return NaN

  const suffix = (match[2] || '').toLowerCase()
  switch (suffix) {
    case 'k':
      return num * 1024
    case 'm':
      return num * 1024 * 1024
    case 'g':
      return num * 1024 * 1024 * 1024
    default:
      return num
  }
}

function parseBlocks(value: string): number {
  const num = parseInt(value, 10)
  return isNaN(num) ? NaN : num
}

function applyConversions(data: Uint8Array, conversions: string[]): Uint8Array {
  let result = new Uint8Array(data)

  for (const conv of conversions) {
    switch (conv) {
      case 'ucase': {
        const text = new TextDecoder().decode(result)
        result = new TextEncoder().encode(text.toUpperCase())
        break
      }
      case 'lcase': {
        const text = new TextDecoder().decode(result)
        result = new TextEncoder().encode(text.toLowerCase())
        break
      }
      case 'swab': {
        const swapped = new Uint8Array(result.length)
        for (let i = 0; i < result.length - 1; i += 2) {
          const a = result[i]
          const b = result[i + 1]
          if (a !== undefined && b !== undefined) {
            swapped[i] = b
            swapped[i + 1] = a
          }
        }
        if (result.length % 2 === 1) {
          const last = result[result.length - 1]
          if (last !== undefined) {
            swapped[result.length - 1] = last
          }
        }
        result = swapped
        break
      }
    }
  }

  return result
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'dd',
    description: 'Copy and convert files with block-level operations',
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

      let inputFile: string | undefined
      let outputFile: string | undefined
      let blockSize: number | undefined
      let inputBlockSize = 512
      let outputBlockSize = 512
      let count: number | undefined
      let skip = 0
      let seek = 0
      const conversions: string[] = []
      let status: 'none' | 'noxfer' | 'progress' = 'noxfer'
      let noError = false
      let noTrunc = false
      let sync = false

      for (const arg of argv) {
        if (!arg) continue

        if (arg === '--help' || arg === '-h') {
          printUsage(process, terminal)
          return 0
        } else if (arg.startsWith('if=')) {
          inputFile = arg.slice(3)
        } else if (arg.startsWith('of=')) {
          outputFile = arg.slice(3)
        } else if (arg.startsWith('bs=')) {
          const bytes = parseBytes(arg.slice(3))
          if (isNaN(bytes)) {
            await writelnStderr(process, terminal, `dd: invalid block size: ${arg.slice(3)}`)
            return 1
          }
          blockSize = bytes
          inputBlockSize = bytes
          outputBlockSize = bytes
        } else if (arg.startsWith('ibs=')) {
          const bytes = parseBytes(arg.slice(4))
          if (isNaN(bytes)) {
            await writelnStderr(process, terminal, `dd: invalid input block size: ${arg.slice(4)}`)
            return 1
          }
          inputBlockSize = bytes
        } else if (arg.startsWith('obs=')) {
          const bytes = parseBytes(arg.slice(4))
          if (isNaN(bytes)) {
            await writelnStderr(process, terminal, `dd: invalid output block size: ${arg.slice(4)}`)
            return 1
          }
          outputBlockSize = bytes
        } else if (arg.startsWith('count=')) {
          const blocks = parseBlocks(arg.slice(6))
          if (isNaN(blocks)) {
            await writelnStderr(process, terminal, `dd: invalid count: ${arg.slice(6)}`)
            return 1
          }
          count = blocks
        } else if (arg.startsWith('skip=')) {
          const blocks = parseBlocks(arg.slice(5))
          if (isNaN(blocks)) {
            await writelnStderr(process, terminal, `dd: invalid skip: ${arg.slice(5)}`)
            return 1
          }
          skip = blocks
        } else if (arg.startsWith('seek=')) {
          const blocks = parseBlocks(arg.slice(5))
          if (isNaN(blocks)) {
            await writelnStderr(process, terminal, `dd: invalid seek: ${arg.slice(5)}`)
            return 1
          }
          seek = blocks
        } else if (arg.startsWith('conv=')) {
          const convs = arg.slice(5).split(',').map(c => c.trim())
          for (const conv of convs) {
            if (['ucase', 'lcase', 'swab', 'noerror', 'notrunc', 'sync'].includes(conv)) {
              if (conv === 'noerror') noError = true
              else if (conv === 'notrunc') noTrunc = true
              else if (conv === 'sync') sync = true
              else conversions.push(conv)
            } else {
              await writelnStderr(process, terminal, `dd: invalid conversion: ${conv}`)
              return 1
            }
          }
        } else if (arg.startsWith('status=')) {
          const level = arg.slice(7)
          if (['none', 'noxfer', 'progress'].includes(level)) {
            status = level as 'none' | 'noxfer' | 'progress'
          } else {
            await writelnStderr(process, terminal, `dd: invalid status level: ${level}`)
            return 1
          }
        } else {
          await writelnStderr(process, terminal, `dd: invalid operand: ${arg}`)
          await writelnStderr(process, terminal, "Try 'dd --help' for more information.")
          return 1
        }
      }

      if (blockSize !== undefined) {
        inputBlockSize = blockSize
        outputBlockSize = blockSize
      }

      let inputFileHandle: Awaited<ReturnType<typeof shell.context.fs.promises.open>> | undefined
      let inputReader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let outputFileHandle: Awaited<ReturnType<typeof shell.context.fs.promises.open>> | undefined
      let outputWriter: WritableStreamDefaultWriter<Uint8Array> | { write: (chunk: Uint8Array) => Promise<void>, releaseLock: () => Promise<void> } | undefined

      try {
        if (inputFile) {
          const inputPath = path.resolve(shell.cwd, inputFile)
          const isDevice = inputPath.startsWith('/dev')
          inputFileHandle = await shell.context.fs.promises.open(inputPath, isDevice ? undefined : 'r')
        } else {
          if (!process.stdin) {
            await writelnStderr(process, terminal, 'dd: stdin not available')
            return 1
          }
          inputReader = process.stdin.getReader()
        }

        if (outputFile) {
          const outputPath = path.resolve(shell.cwd, outputFile)
          const flags = noTrunc ? 'r+' : 'w'
          outputFileHandle = await shell.context.fs.promises.open(outputPath, flags).catch(async () => {
            if (noTrunc) {
              return await shell.context.fs.promises.open(outputPath, 'w')
            }
            throw new Error(`Cannot open ${outputFile}`)
          })

          let outputPosition = 0
          if (seek > 0) {
            outputPosition = seek * outputBlockSize
            const zeros = new Uint8Array(outputPosition)
            await outputFileHandle.write(zeros)
          }

          outputWriter = {
            write: async (chunk: Uint8Array) => {
              await outputFileHandle!.write(chunk)
            },
            releaseLock: async () => {
              await outputFileHandle!.close()
            }
          }
        } else {
          if (!process.stdout) {
            await writelnStderr(process, terminal, 'dd: stdout not available')
            return 1
          }
          outputWriter = process.stdout.getWriter()
          
          if (seek > 0 && outputWriter) {
            const seekBytes = seek * outputBlockSize
            const zeros = new Uint8Array(seekBytes)
            await outputWriter.write(zeros)
          }
        }

        if (!outputWriter) {
          await writelnStderr(process, terminal, 'dd: no output writer available')
          return 1
        }

        let totalBytesRead = 0
        let totalBytesWritten = 0
        let blocksRead = 0
        let blocksWritten = 0

        if (inputFileHandle && inputFile) {
          const inputPath = path.resolve(shell.cwd, inputFile)
          const isDevice = inputPath.startsWith('/dev')

          if (isDevice) {
            const buffer = new Uint8Array(inputBlockSize)
            let skipBytes = skip * inputBlockSize
            let skipped = 0

            while (true) {
              if (count !== undefined && blocksRead >= count) {
                break
              }

              const result = await inputFileHandle.read(buffer)
              const bytesRead = result.bytesRead

              if (bytesRead === 0) {
                if (sync && blocksRead > 0) {
                  const padded = new Uint8Array(inputBlockSize)
                  let data: Uint8Array = padded
                  if (conversions.length > 0) {
                    data = applyConversions(data, conversions)
                  }
                  await outputWriter.write(data)
                  totalBytesWritten += data.length
                  blocksWritten++
                }
                break
              }

              let data = buffer.slice(0, bytesRead)

              if (skipBytes > 0) {
                const toSkip = Math.min(data.length, skipBytes - skipped)
                skipped += toSkip
                if (toSkip < data.length) {
                  data = data.slice(toSkip)
                } else {
                  continue
                }
              }

              totalBytesRead += data.length
              blocksRead++

              if (data.length < inputBlockSize && sync) {
                const padded = new Uint8Array(inputBlockSize)
                padded.set(data)
                data = padded
              }

              if (conversions.length > 0) {
                const converted = applyConversions(data, conversions)
                data = new Uint8Array(converted)
              }

              if (data.length > outputBlockSize) {
                let offset = 0
                while (offset < data.length) {
                  const chunk = data.slice(offset, offset + outputBlockSize)
                  await outputWriter.write(chunk)
                  totalBytesWritten += chunk.length
                  blocksWritten++
                  offset += outputBlockSize
                }
              } else {
                await outputWriter.write(data)
                totalBytesWritten += data.length
                blocksWritten++
              }

              if (status === 'progress' && blocksRead % 100 === 0) {
                await writelnStderr(process, terminal, `dd: ${blocksRead} blocks read, ${blocksWritten} blocks written`)
              }
            }
          } else {
            const stat = await shell.context.fs.promises.stat(inputPath)
            const fileSize = stat.size
            let inputPosition = 0

            if (skip > 0) {
              inputPosition = skip * inputBlockSize
              if (inputPosition > fileSize) {
                inputPosition = fileSize
              }
            }

            const buffer = new Uint8Array(inputBlockSize)
            
            while (true) {
              if (count !== undefined && blocksRead >= count) {
                break
              }

              if (inputPosition >= fileSize) {
                if (sync && blocksRead > 0) {
                  const padded = new Uint8Array(inputBlockSize)
                  let data: Uint8Array = padded
                  if (conversions.length > 0) {
                    data = applyConversions(data, conversions)
                  }
                  await outputWriter.write(data)
                  totalBytesWritten += data.length
                  blocksWritten++
                }
                break
              }

              const bytesToRead = Math.min(inputBlockSize, fileSize - inputPosition)
              await inputFileHandle.read(buffer, 0, bytesToRead, inputPosition)
              let data = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesToRead)

              totalBytesRead += data.length
              blocksRead++
              inputPosition += bytesToRead

              if (data.length < inputBlockSize && sync) {
                const padded = new Uint8Array(inputBlockSize)
                padded.set(data)
                data = padded
              }

              if (conversions.length > 0) {
                const converted = applyConversions(data, conversions)
                data = new Uint8Array(converted)
              }

              if (data.length > outputBlockSize) {
                let offset = 0
                while (offset < data.length) {
                  const chunk = data.slice(offset, offset + outputBlockSize)
                  await outputWriter.write(chunk)
                  totalBytesWritten += chunk.length
                  blocksWritten++
                  offset += outputBlockSize
                }
              } else {
                await outputWriter.write(data)
                totalBytesWritten += data.length
                blocksWritten++
              }

              if (status === 'progress' && blocksRead % 100 === 0) {
                await writelnStderr(process, terminal, `dd: ${blocksRead} blocks read, ${blocksWritten} blocks written`)
              }
            }
          }
        } else if (inputReader) {
          if (skip > 0) {
            const skipBytes = skip * inputBlockSize
            let skipped = 0
            while (skipped < skipBytes) {
              const { done, value } = await inputReader.read()
              if (done) break
              if (value) {
                skipped += value.length
              }
            }
          }

          let partialBlock: Uint8Array | undefined

          while (true) {
            if (count !== undefined && blocksRead >= count) {
              break
            }

            let data: Uint8Array | undefined

            if (partialBlock) {
              data = partialBlock
              partialBlock = undefined
            } else {
              const result = await inputReader.read()
              if (result.done) {
                if (sync && blocksRead > 0) {
                  const padded = new Uint8Array(inputBlockSize)
                  data = padded
                } else {
                  break
                }
              } else {
                data = result.value
              }
            }

            if (!data || data.length === 0) {
              if (sync && blocksRead > 0) {
                data = new Uint8Array(inputBlockSize)
              } else {
                break
              }
            }

            totalBytesRead += data.length
            blocksRead++

            if (data.length < inputBlockSize && sync) {
              const padded = new Uint8Array(inputBlockSize)
              padded.set(data)
              data = padded
            }

            if (conversions.length > 0) {
              data = applyConversions(data, conversions)
            }

            if (!data) {
              break
            }

            if (data.length > outputBlockSize) {
              let offset = 0
              while (offset < data.length) {
                const chunk = data.slice(offset, offset + outputBlockSize)
                await outputWriter.write(chunk)
                totalBytesWritten += chunk.length
                blocksWritten++
                offset += outputBlockSize
              }
            } else {
              await outputWriter.write(data)
              totalBytesWritten += data.length
              blocksWritten++
            }

            if (status === 'progress' && blocksRead % 100 === 0) {
              await writelnStderr(process, terminal, `dd: ${blocksRead} blocks read, ${blocksWritten} blocks written`)
            }
          }
        }

        if (status !== 'none') {
          await writelnStderr(process, terminal, `${blocksRead}+${Math.floor((totalBytesRead % inputBlockSize) / (inputBlockSize || 1))} records in`)
          await writelnStderr(process, terminal, `${blocksWritten}+${Math.floor((totalBytesWritten % outputBlockSize) / (outputBlockSize || 1))} records out`)
          await writelnStderr(process, terminal, `${totalBytesWritten} bytes copied`)
        }

        return 0
      } catch (error) {
        if (!noError) {
          await writelnStderr(process, terminal, `dd: ${error instanceof Error ? error.message : 'Unknown error'}`)
          return 1
        }
        return 0
      } finally {
        if (inputFileHandle) {
          await inputFileHandle.close()
        }
        if (inputReader) {
          inputReader.releaseLock()
        }
        if (outputWriter && 'releaseLock' in outputWriter) {
          await outputWriter.releaseLock()
        }
      }
    }
  })
}
