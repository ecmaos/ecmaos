import path from 'path'
import chalk from 'chalk'
import type { Kernel, Process, Shell, Terminal } from '@ecmaos/types'
import { TerminalCommand } from '../shared/terminal-command.js'
import { writelnStdout, writelnStderr } from '../shared/helpers.js'

type KeyFormat = 'jwk' | 'raw' | 'pkcs8' | 'spki'
type SymmetricAlgorithm = 'AES-GCM' | 'AES-CBC' | 'AES-CTR' | 'AES-KW'
type AsymmetricAlgorithm = 'RSA-OAEP' | 'RSA-PSS' | 'RSASSA-PKCS1-v1_5' | 'ECDSA' | 'ECDH'
type SignAlgorithm = 'ECDSA' | 'RSA-PSS' | 'RSASSA-PKCS1-v1_5' | 'HMAC'
type DeriveAlgorithm = 'PBKDF2' | 'HKDF' | 'ECDH'
type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
type NamedCurve = 'P-256' | 'P-384' | 'P-521'

const SUPPORTED_SYMMETRIC_ALGORITHMS: Record<string, SymmetricAlgorithm> = {
  'aes-gcm': 'AES-GCM',
  'aes-cbc': 'AES-CBC',
  'aes-ctr': 'AES-CTR',
  'aes-kw': 'AES-KW'
}

const SUPPORTED_ASYMMETRIC_ALGORITHMS: Record<string, AsymmetricAlgorithm> = {
  'rsa-oaep': 'RSA-OAEP',
  'rsa-pss': 'RSA-PSS',
  'rsassa-pkcs1-v1_5': 'RSASSA-PKCS1-v1_5',
  'rsassa-pkcs1-v1-5': 'RSASSA-PKCS1-v1_5',
  'ecdsa': 'ECDSA',
  'ecdh': 'ECDH'
}

const SUPPORTED_SIGN_ALGORITHMS: Record<string, SignAlgorithm> = {
  'ecdsa': 'ECDSA',
  'rsa-pss': 'RSA-PSS',
  'rsassa-pkcs1-v1_5': 'RSASSA-PKCS1-v1_5',
  'rsassa-pkcs1-v1-5': 'RSASSA-PKCS1-v1_5',
  'hmac': 'HMAC'
}

const SUPPORTED_DERIVE_ALGORITHMS: Record<string, DeriveAlgorithm> = {
  'pbkdf2': 'PBKDF2',
  'hkdf': 'HKDF',
  'ecdh': 'ECDH'
}

const SUPPORTED_HASH_ALGORITHMS: Record<string, HashAlgorithm> = {
  'sha1': 'SHA-1',
  'sha-1': 'SHA-1',
  'sha256': 'SHA-256',
  'sha-256': 'SHA-256',
  'sha384': 'SHA-384',
  'sha-384': 'SHA-384',
  'sha512': 'SHA-512',
  'sha-512': 'SHA-512'
}

const SUPPORTED_NAMED_CURVES: Record<string, NamedCurve> = {
  'p-256': 'P-256',
  'p256': 'P-256',
  'p-384': 'P-384',
  'p384': 'P-384',
  'p-521': 'P-521',
  'p521': 'P-521'
}

const SUPPORTED_KEY_FORMATS: Record<string, KeyFormat> = {
  'jwk': 'jwk',
  'raw': 'raw',
  'pkcs8': 'pkcs8',
  'spki': 'spki'
}

function printUsage(process: Process | undefined, terminal: Terminal): void {
  const usage = `Usage: crypto <subcommand> [options]

Subcommands:
  generate                    Generate cryptographic keys
  encrypt                     Encrypt data
  decrypt                     Decrypt data
  sign                        Sign data
  verify                      Verify signatures
  import                      Import keys from various formats
  export                      Export keys to various formats
  derive                      Derive keys from passwords or other keys
  random                      Generate random bytes

  --help                      display this help and exit

Run 'crypto <subcommand> --help' for subcommand-specific help.

Examples:

  # Symmetric encryption
  crypto generate --algorithm aes-gcm --length 256 --output key.json
  crypto encrypt --algorithm aes-gcm --key-file key.json --input plaintext.txt --output encrypted.bin
  crypto decrypt --algorithm aes-gcm --key-file key.json --input encrypted.bin --output decrypted.txt

  # ECDSA signing and verification
  crypto generate --algorithm ecdsa --named-curve P-256 --output ecdsa-key.json
  crypto sign --algorithm ecdsa --key-file ecdsa-key.json --input message.txt --output signature.sig
  crypto verify --algorithm ecdsa --key-file ecdsa-key.json --input message.txt --signature signature.sig

  # Key format conversion
  crypto import --format jwk --input key.json --output key.pem
  crypto export --format pkcs8 --input key.pem --output key.json`
  void writelnStderr(process, terminal, usage)
}

function toArrayBuffer(buffer: ArrayBufferLike): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) {
    return buffer
  }
  if (buffer instanceof SharedArrayBuffer) {
    const view = new Uint8Array(buffer)
    const newBuffer = new ArrayBuffer(view.length)
    new Uint8Array(newBuffer).set(view)
    return newBuffer
  }
  const view = new Uint8Array(buffer)
  const newBuffer = new ArrayBuffer(view.length)
  new Uint8Array(newBuffer).set(view)
  return newBuffer
}

async function readStreamToUint8Array(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
      }
    }
  } finally {
    reader.releaseLock()
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

async function readFileToUint8Array(fs: typeof import('@zenfs/core').fs.promises, filePath: string): Promise<Uint8Array> {
  const handle = await fs.open(filePath, 'r')
  const stat = await fs.stat(filePath)
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  const chunkSize = 64 * 1024

  while (bytesRead < stat.size) {
    const data = new Uint8Array(chunkSize)
    const readSize = Math.min(chunkSize, stat.size - bytesRead)
    await handle.read(data, 0, readSize, bytesRead)
    chunks.push(data.subarray(0, readSize))
    bytesRead += readSize
  }

  await handle.close()

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const fileData = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    fileData.set(chunk, offset)
    offset += chunk.length
  }

  return fileData
}

async function writeUint8ArrayToFile(fs: typeof import('@zenfs/core').fs.promises, filePath: string, data: Uint8Array): Promise<void> {
  const handle = await fs.open(filePath, 'w')
  await handle.write(data)
  await handle.close()
}

function parseArgs(args: string[]): Record<string, string | string[] | boolean> {
  const parsed: Record<string, string | string[] | boolean> = {}
  let i = 0

  while (i < args.length) {
    const arg = args[i]
    if (!arg) {
      i++
      continue
    }

    if (arg === '--help' || arg === '-h') {
      parsed.help = true
      i++
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2)
      if (arg.includes('=')) {
        const parts = arg.split('=', 2)
        if (parts.length === 2 && parts[0] && parts[1]) {
          parsed[parts[0].slice(2)] = parts[1]
        }
        i++
      } else if (i + 1 < args.length && !args[i + 1]?.startsWith('--')) {
        const nextArg = args[i + 1]
        if (nextArg) {
          parsed[key] = nextArg
        }
        i += 2
      } else {
        parsed[key] = true
        i++
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1)
      if (i + 1 < args.length && !args[i + 1]?.startsWith('-')) {
        const nextArg = args[i + 1]
        if (nextArg) {
          parsed[key] = nextArg
        }
        i += 2
      } else {
        parsed[key] = true
        i++
      }
    } else {
      if (!parsed._) parsed._ = []
      if (typeof parsed._ === 'string') parsed._ = [parsed._]
      if (Array.isArray(parsed._)) {
        parsed._.push(arg)
      }
      i++
    }
  }

  return parsed
}

async function handleGenerate(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto generate [OPTIONS]

Generate cryptographic keys.

Options:
  --algorithm, -a ALGORITHM    Algorithm (AES-GCM, AES-CBC, AES-CTR, AES-KW, RSA-OAEP, RSA-PSS, RSASSA-PKCS1-v1_5, ECDSA, ECDH, HMAC)
  --length, -l LENGTH          Key length in bits (for AES: 128, 192, 256; for RSA: 1024, 2048, 4096)
  --named-curve, -c CURVE      Named curve for ECDSA/ECDH (P-256, P-384, P-521)
  --hash, -h ALGORITHM         Hash algorithm for HMAC/RSA (SHA-1, SHA-256, SHA-384, SHA-512)
  --output, -o FILE             Output file (default: stdout, JWK format)
  --format, -f FORMAT           Output format (jwk, raw, pkcs8, spki) (default: jwk)
  --help                        Display this help

Examples:
  crypto generate --algorithm aes-gcm --length 256 --output key.json
  crypto generate --algorithm ecdsa --named-curve P-256 --output ecdsa-key.json
  crypto generate --algorithm rsa-oaep --length 2048 --output rsa-key.json
  crypto generate --algorithm hmac --hash SHA-256 --length 256 --output hmac-key.json`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const algorithm = parsed.algorithm || parsed.a
  const length = parsed.length || parsed.l
  const namedCurve = parsed['named-curve'] || parsed.c
  const hash = parsed.hash || parsed.h
  const output = parsed.output || parsed.o
  const formatValue = parsed.format || parsed.f || 'jwk'
  const format = (typeof formatValue === 'string' ? formatValue : 'jwk').toLowerCase()

  if (!algorithm || typeof algorithm !== 'string') {
    await writelnStderr(process, terminal, 'crypto generate: --algorithm is required')
    await writelnStderr(process, terminal, 'Try "crypto generate --help" for more information.')
    return 1
  }

  const algoLower = algorithm.toLowerCase()
  const keyFormat = SUPPORTED_KEY_FORMATS[format]
  if (!keyFormat) {
    await writelnStderr(process, terminal, `crypto generate: unsupported format '${format}'`)
    return 1
  }

  try {
    let key: CryptoKey | CryptoKeyPair
    let exportFormat: KeyFormat = keyFormat

    if (SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]) {
      const symAlgo = SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]
      const keyLength = length ? parseInt(length as string, 10) : 256

      if (![128, 192, 256].includes(keyLength)) {
        await writelnStderr(process, terminal, 'crypto generate: AES key length must be 128, 192, or 256')
        return 1
      }

      key = await crypto.subtle.generateKey(
        { name: symAlgo, length: keyLength },
        true,
        ['encrypt', 'decrypt']
      )

      if (keyFormat === 'pkcs8' || keyFormat === 'spki') {
        await writelnStderr(process, terminal, 'crypto generate: symmetric keys cannot be exported in PKCS8 or SPKI format')
        return 1
      }
      exportFormat = keyFormat === 'raw' ? 'raw' : 'jwk'
    } else if (SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'ECDSA' || SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'ECDH') {
      const curve = namedCurve ? (SUPPORTED_NAMED_CURVES[(namedCurve as string).toLowerCase()] || 'P-256') : 'P-256'

      const keyUsages: KeyUsage[] = SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'ECDSA'
        ? ['sign', 'verify']
        : ['deriveKey', 'deriveBits']

      key = await crypto.subtle.generateKey(
        {
          name: SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower],
          namedCurve: curve
        },
        true,
        keyUsages
      )

      if (keyFormat === 'raw') {
        await writelnStderr(process, terminal, 'crypto generate: ECDSA/ECDH keys cannot be exported in raw format')
        return 1
      }
    } else if (SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower]?.startsWith('RSA')) {
      const rsaAlgo = SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower]
      const keyLength = length ? parseInt(length as string, 10) : 2048
      const hashAlgo = hash ? (SUPPORTED_HASH_ALGORITHMS[(hash as string).toLowerCase()] || 'SHA-256') : 'SHA-256'

      if (![1024, 2048, 4096].includes(keyLength)) {
        await writelnStderr(process, terminal, 'crypto generate: RSA key length must be 1024, 2048, or 4096')
        return 1
      }

      const keyUsages: KeyUsage[] = rsaAlgo === 'RSA-OAEP'
        ? ['encrypt', 'decrypt']
        : ['sign', 'verify']

      key = await crypto.subtle.generateKey(
        {
          name: rsaAlgo,
          modulusLength: keyLength,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: hashAlgo
        },
        true,
        keyUsages
      )

      if (keyFormat === 'raw') {
        await writelnStderr(process, terminal, 'crypto generate: RSA keys cannot be exported in raw format')
        return 1
      }
    } else if (algoLower === 'hmac') {
      const keyLength = length ? parseInt(length as string, 10) : 256
      const hashAlgo = hash ? (SUPPORTED_HASH_ALGORITHMS[(hash as string).toLowerCase()] || 'SHA-256') : 'SHA-256'

      key = await crypto.subtle.generateKey(
        {
          name: 'HMAC',
          hash: hashAlgo,
          length: keyLength
        },
        true,
        ['sign', 'verify']
      )

      if (keyFormat === 'pkcs8' || keyFormat === 'spki') {
        await writelnStderr(process, terminal, 'crypto generate: HMAC keys cannot be exported in PKCS8 or SPKI format')
        return 1
      }
      exportFormat = keyFormat === 'raw' ? 'raw' : 'jwk'
    } else {
      await writelnStderr(process, terminal, `crypto generate: unsupported algorithm '${algorithm}'`)
      return 1
    }

    let exported: ArrayBuffer | JsonWebKey
    if ('publicKey' in key && 'privateKey' in key) {
      const keyPair = key as CryptoKeyPair
      if (keyFormat === 'spki') {
        exported = await crypto.subtle.exportKey('spki', keyPair.publicKey)
      } else if (keyFormat === 'pkcs8') {
        exported = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      } else {
        exported = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
      }
    } else {
      exported = await crypto.subtle.exportKey(exportFormat, key as CryptoKey)
    }

    let outputData: Uint8Array
    if (exportFormat === 'jwk') {
      const json = JSON.stringify(exported as JsonWebKey, null, 2)
      outputData = new TextEncoder().encode(json)
    } else {
      outputData = new Uint8Array(exported as ArrayBuffer)
    }

    if (output) {
      const outputPath = path.resolve(shell.cwd, output as string)
      await writeUint8ArrayToFile(shell.context.fs.promises, outputPath, outputData)
      await writelnStdout(process, terminal, chalk.green(`Key generated and saved to ${output}`))
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
          if (exportFormat === 'jwk') {
            await writer.write(new TextEncoder().encode('\n'))
          }
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto generate: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}


async function handleEncrypt(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto encrypt [OPTIONS]

Encrypt data using various algorithms.

Options:
  --algorithm, -a ALGORITHM    Algorithm (AES-GCM, AES-CBC, AES-CTR, RSA-OAEP)
  --key-file, -k FILE           Key file (JWK format)
  --input, -i FILE              Input file (default: stdin)
  --output, -o FILE             Output file (default: stdout)
  --iv-file FILE                IV/nonce file (for AES, auto-generated if not provided)
  --help                        Display this help`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const algorithm = parsed.algorithm || parsed.a
  const keyFile = parsed['key-file'] || parsed.k
  const input = parsed.input || parsed.i
  const output = parsed.output || parsed.o
  const ivFile = parsed['iv-file']

  if (!algorithm || typeof algorithm !== 'string') {
    await writelnStderr(process, terminal, 'crypto encrypt: --algorithm is required')
    return 1
  }

  if (!keyFile || typeof keyFile !== 'string') {
    await writelnStderr(process, terminal, 'crypto encrypt: --key-file is required')
    return 1
  }

  try {
    const algoLower = algorithm.toLowerCase()
    if (!SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower] && algoLower !== 'rsa-oaep') {
      await writelnStderr(process, terminal, `crypto encrypt: unsupported algorithm '${algorithm}'`)
      return 1
    }

    const keyPath = path.resolve(shell.cwd, keyFile)
    const keyData = await readFileToUint8Array(shell.context.fs.promises, keyPath)
    const keyJson = JSON.parse(new TextDecoder().decode(keyData)) as JsonWebKey

    let key: CryptoKey
    let encryptParams: AesGcmParams | AesCbcParams | AesCtrParams | RsaOaepParams

    if (SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]) {
      const symAlgo = SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]
      key = await crypto.subtle.importKey('jwk', keyJson, { name: symAlgo }, false, ['encrypt'])

      let iv: Uint8Array
      if (ivFile && typeof ivFile === 'string') {
        iv = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, ivFile))
      } else {
        if (symAlgo === 'AES-GCM') {
          iv = crypto.getRandomValues(new Uint8Array(12))
        } else {
          iv = crypto.getRandomValues(new Uint8Array(16))
        }
      }

      const ivBuffer = toArrayBuffer(iv.buffer)
      if (symAlgo === 'AES-GCM') {
        encryptParams = { name: 'AES-GCM', iv: new Uint8Array(ivBuffer, iv.byteOffset, iv.length) }
      } else if (symAlgo === 'AES-CBC') {
        encryptParams = { name: 'AES-CBC', iv: new Uint8Array(ivBuffer, iv.byteOffset, iv.length) }
      } else {
        encryptParams = { name: 'AES-CTR', counter: new Uint8Array(ivBuffer, iv.byteOffset, iv.length), length: 128 }
      }
    } else {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
      encryptParams = { name: 'RSA-OAEP' }
    }

    let inputData: Uint8Array
    if (input) {
      inputData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, input as string))
    } else {
      if (!process?.stdin) {
        await writelnStderr(process, terminal, 'crypto encrypt: no input specified')
        return 1
      }
      const reader = process.stdin.getReader()
      inputData = await readStreamToUint8Array(reader)
    }

    const inputBuffer = toArrayBuffer(inputData.buffer)
    const encrypted = await crypto.subtle.encrypt(encryptParams, key, new Uint8Array(inputBuffer, inputData.byteOffset, inputData.length))

    let outputData: Uint8Array
    const encryptedArray = new Uint8Array(encrypted)
    if (SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower] && !ivFile) {
      const ivParam = (encryptParams as AesGcmParams | AesCbcParams).iv
      const ivArray = ivParam instanceof Uint8Array 
        ? ivParam 
        : ivParam instanceof ArrayBuffer 
          ? new Uint8Array(ivParam)
          : new Uint8Array(ivParam.buffer, ivParam.byteOffset, ivParam.byteLength)
      const ivLength = ivArray.length
      outputData = new Uint8Array(ivLength + encrypted.byteLength)
      outputData.set(ivArray, 0)
      outputData.set(encryptedArray, ivLength)
    } else {
      outputData = encryptedArray
    }

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), outputData)
      if (!ivFile && SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]) {
        const ivParam = (encryptParams as AesGcmParams | AesCbcParams).iv
        const ivArray = ivParam instanceof Uint8Array 
          ? ivParam 
          : ivParam instanceof ArrayBuffer 
            ? new Uint8Array(ivParam)
            : new Uint8Array(ivParam.buffer, ivParam.byteOffset, ivParam.byteLength)
        const ivPath = path.resolve(shell.cwd, (output as string) + '.iv')
        await writeUint8ArrayToFile(shell.context.fs.promises, ivPath, ivArray)
        await writelnStdout(process, terminal, chalk.yellow(`IV saved to ${output}.iv`))
      }
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto encrypt: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleDecrypt(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto decrypt [OPTIONS]

Decrypt data using various algorithms.

Options:
  --algorithm, -a ALGORITHM    Algorithm (AES-GCM, AES-CBC, AES-CTR, RSA-OAEP)
  --key-file, -k FILE           Key file (JWK format)
  --input, -i FILE              Input file (default: stdin)
  --output, -o FILE             Output file (default: stdout)
  --iv-file FILE                IV/nonce file (for AES, required if not embedded)
  --help                        Display this help`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const algorithm = parsed.algorithm || parsed.a
  const keyFile = parsed['key-file'] || parsed.k
  const input = parsed.input || parsed.i
  const output = parsed.output || parsed.o
  const ivFile = parsed['iv-file']

  if (!algorithm || typeof algorithm !== 'string') {
    await writelnStderr(process, terminal, 'crypto decrypt: --algorithm is required')
    return 1
  }

  if (!keyFile || typeof keyFile !== 'string') {
    await writelnStderr(process, terminal, 'crypto decrypt: --key-file is required')
    return 1
  }

  try {
    const algoLower = algorithm.toLowerCase()
    if (!SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower] && algoLower !== 'rsa-oaep') {
      await writelnStderr(process, terminal, `crypto decrypt: unsupported algorithm '${algorithm}'`)
      return 1
    }

    const keyPath = path.resolve(shell.cwd, keyFile)
    const keyData = await readFileToUint8Array(shell.context.fs.promises, keyPath)
    const keyJson = JSON.parse(new TextDecoder().decode(keyData)) as JsonWebKey

    let inputData: Uint8Array
    if (input) {
      inputData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, input as string))
    } else {
      if (!process?.stdin) {
        await writelnStderr(process, terminal, 'crypto decrypt: no input specified')
        return 1
      }
      const reader = process.stdin.getReader()
      inputData = await readStreamToUint8Array(reader)
    }

    let key: CryptoKey
    let decryptParams: AesGcmParams | AesCbcParams | AesCtrParams | RsaOaepParams
    let encryptedData: Uint8Array

    if (SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]) {
      const symAlgo = SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]
      key = await crypto.subtle.importKey('jwk', keyJson, { name: symAlgo }, false, ['decrypt'])

      let iv: Uint8Array
      if (ivFile && typeof ivFile === 'string') {
        iv = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, ivFile))
        encryptedData = inputData
      } else {
        if (symAlgo === 'AES-GCM') {
          iv = inputData.slice(0, 12)
          encryptedData = inputData.slice(12)
        } else {
          iv = inputData.slice(0, 16)
          encryptedData = inputData.slice(16)
        }
      }

      const ivBuffer = toArrayBuffer(iv.buffer)
      if (symAlgo === 'AES-GCM') {
        decryptParams = { name: 'AES-GCM', iv: new Uint8Array(ivBuffer, iv.byteOffset, iv.length) }
      } else if (symAlgo === 'AES-CBC') {
        decryptParams = { name: 'AES-CBC', iv: new Uint8Array(ivBuffer, iv.byteOffset, iv.length) }
      } else {
        decryptParams = { name: 'AES-CTR', counter: new Uint8Array(ivBuffer, iv.byteOffset, iv.length), length: 128 }
      }
    } else {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
      decryptParams = { name: 'RSA-OAEP' }
      encryptedData = inputData
    }

    const encryptedBuffer = toArrayBuffer(encryptedData.buffer)
    const decrypted = await crypto.subtle.decrypt(decryptParams, key, new Uint8Array(encryptedBuffer, encryptedData.byteOffset, encryptedData.length))
    const outputData = new Uint8Array(decrypted)

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), outputData)
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto decrypt: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleSign(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto sign [OPTIONS]

Sign data using various algorithms.

Options:
  --algorithm, -a ALGORITHM    Algorithm (ECDSA, RSA-PSS, RSASSA-PKCS1-v1_5, HMAC)
  --key-file, -k FILE           Private key file (JWK format)
  --input, -i FILE              Input file (default: stdin)
  --output, -o FILE             Output file (default: stdout)
  --help                        Display this help

Examples:
  crypto sign --algorithm ecdsa --key-file ecdsa-key.json --input message.txt --output signature.sig
  crypto sign --algorithm hmac --key-file hmac-key.json --input data.bin --output signature.sig`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const algorithm = parsed.algorithm || parsed.a
  const keyFile = parsed['key-file'] || parsed.k
  const input = parsed.input || parsed.i
  const output = parsed.output || parsed.o

  if (!algorithm || typeof algorithm !== 'string') {
    await writelnStderr(process, terminal, 'crypto sign: --algorithm is required')
    return 1
  }

  if (!keyFile || typeof keyFile !== 'string') {
    await writelnStderr(process, terminal, 'crypto sign: --key-file is required')
    return 1
  }

  try {
    const algoLower = algorithm.toLowerCase()
    if (!SUPPORTED_SIGN_ALGORITHMS[algoLower]) {
      await writelnStderr(process, terminal, `crypto sign: unsupported algorithm '${algorithm}'`)
      return 1
    }

    const keyPath = path.resolve(shell.cwd, keyFile)
    const keyData = await readFileToUint8Array(shell.context.fs.promises, keyPath)
    const keyJson = JSON.parse(new TextDecoder().decode(keyData)) as JsonWebKey

    let key: CryptoKey
    let signParams: EcdsaParams | RsaPssParams | Algorithm

    if (algoLower === 'ecdsa') {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
      signParams = { name: 'ECDSA', hash: 'SHA-256' }
    } else if (algoLower === 'rsa-pss') {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign'])
      signParams = { name: 'RSA-PSS', saltLength: 32 }
    } else if (algoLower === 'rsassa-pkcs1-v1_5' || algoLower === 'rsassa-pkcs1-v1-5') {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
      signParams = { name: 'RSASSA-PKCS1-v1_5' }
    } else {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      signParams = { name: 'HMAC' }
    }

    let inputData: Uint8Array
    if (input) {
      inputData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, input as string))
    } else {
      if (!process?.stdin) {
        await writelnStderr(process, terminal, 'crypto sign: no input specified')
        return 1
      }
      const reader = process.stdin.getReader()
      inputData = await readStreamToUint8Array(reader)
    }

    const inputBuffer = toArrayBuffer(inputData.buffer)
    const signature = await crypto.subtle.sign(signParams, key, new Uint8Array(inputBuffer, inputData.byteOffset, inputData.length))
    const outputData = new Uint8Array(signature)

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), outputData)
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto sign: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleVerify(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto verify [OPTIONS]

Verify signatures using various algorithms.

Options:
  --algorithm, -a ALGORITHM    Algorithm (ECDSA, RSA-PSS, RSASSA-PKCS1-v1_5, HMAC)
  --key-file, -k FILE           Public key file (JWK format, can use key pair file)
  --input, -i FILE              Input file (default: stdin)
  --signature, -s FILE           Signature file
  --help                        Display this help

Examples:
  crypto verify --algorithm ecdsa --key-file ecdsa-key.json --input message.txt --signature signature.sig
  crypto verify --algorithm hmac --key-file hmac-key.json --input data.bin --signature signature.sig`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const algorithm = parsed.algorithm || parsed.a
  const keyFile = parsed['key-file'] || parsed.k
  const input = parsed.input || parsed.i
  const signatureFile = parsed.signature || parsed.s

  if (!algorithm || typeof algorithm !== 'string') {
    await writelnStderr(process, terminal, 'crypto verify: --algorithm is required')
    return 1
  }

  if (!keyFile || typeof keyFile !== 'string') {
    await writelnStderr(process, terminal, 'crypto verify: --key-file is required')
    return 1
  }

  if (!signatureFile || typeof signatureFile !== 'string') {
    await writelnStderr(process, terminal, 'crypto verify: --signature is required')
    return 1
  }

  try {
    const algoLower = algorithm.toLowerCase()
    if (!SUPPORTED_SIGN_ALGORITHMS[algoLower]) {
      await writelnStderr(process, terminal, `crypto verify: unsupported algorithm '${algorithm}'`)
      return 1
    }

    const keyPath = path.resolve(shell.cwd, keyFile)
    const keyData = await readFileToUint8Array(shell.context.fs.promises, keyPath)
    let keyJson = JSON.parse(new TextDecoder().decode(keyData)) as JsonWebKey

    // Extract public key from private key JWK if needed
    if (keyJson.d) {
      const publicKeyJson: JsonWebKey = {
        kty: keyJson.kty,
        key_ops: ['verify'],
        ext: keyJson.ext
      }
      if (keyJson.kty === 'EC') {
        publicKeyJson.crv = keyJson.crv
        publicKeyJson.x = keyJson.x
        publicKeyJson.y = keyJson.y
      } else if (keyJson.kty === 'RSA') {
        ;(publicKeyJson as any).n = keyJson.n
        ;(publicKeyJson as any).e = keyJson.e
      }
      keyJson = publicKeyJson
    }

    let key: CryptoKey
    let verifyParams: EcdsaParams | RsaPssParams | Algorithm

    if (algoLower === 'ecdsa') {
      const namedCurve = (keyJson.crv || 'P-256') as NamedCurve
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'ECDSA', namedCurve }, false, ['verify'])
      verifyParams = { name: 'ECDSA', hash: 'SHA-256' }
    } else if (algoLower === 'rsa-pss') {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['verify'])
      verifyParams = { name: 'RSA-PSS', saltLength: 32 }
    } else if (algoLower === 'rsassa-pkcs1-v1_5' || algoLower === 'rsassa-pkcs1-v1-5') {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
      verifyParams = { name: 'RSASSA-PKCS1-v1_5' }
    } else {
      key = await crypto.subtle.importKey('jwk', keyJson, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
      verifyParams = { name: 'HMAC' }
    }

    let inputData: Uint8Array
    if (input) {
      inputData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, input as string))
    } else {
      if (!process?.stdin) {
        await writelnStderr(process, terminal, 'crypto verify: no input specified')
        return 1
      }
      const reader = process.stdin.getReader()
      inputData = await readStreamToUint8Array(reader)
    }

    const signature = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, signatureFile))
    const signatureBuffer = toArrayBuffer(signature.buffer)
    const inputBuffer = toArrayBuffer(inputData.buffer)
    const isValid = await crypto.subtle.verify(verifyParams, key, new Uint8Array(signatureBuffer, signature.byteOffset, signature.length), new Uint8Array(inputBuffer, inputData.byteOffset, inputData.length))

    if (isValid) {
      await writelnStdout(process, terminal, chalk.green('Signature is valid'))
      return 0
    } else {
      await writelnStderr(process, terminal, chalk.red('Signature is invalid'))
      return 1
    }
  } catch (error) {
    await writelnStderr(process, terminal, `crypto verify: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleImport(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto import [OPTIONS]

Import keys from various formats.

Options:
  --format, -f FORMAT           Input format (jwk, raw, pkcs8, spki)
  --algorithm, -a ALGORITHM    Algorithm (required for raw format)
  --input, -i FILE              Input file (default: stdin)
  --output, -o FILE             Output file (default: stdout)
  --output-format FORMAT        Output format (jwk, raw, pkcs8, spki) (default: jwk)
  --help                        Display this help

Examples:
  crypto import --format jwk --input key.json --output-format raw --output key.bin
  crypto import --format pkcs8 --algorithm ecdsa --input key.pem --output-format jwk --output key.json
  crypto import --format jwk --input key.json --output-format pkcs8 --output private.pem`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const formatValue = parsed.format || parsed.f || 'jwk'
  const format = (typeof formatValue === 'string' ? formatValue : 'jwk').toLowerCase()
  const algorithm = parsed.algorithm || parsed.a
  const input = parsed.input || parsed.i
  const output = parsed.output || parsed.o
  const outputFormatValue = parsed['output-format'] || 'jwk'
  const outputFormat = (typeof outputFormatValue === 'string' ? outputFormatValue : 'jwk').toLowerCase()

  const keyFormat = SUPPORTED_KEY_FORMATS[format]
  if (!keyFormat) {
    await writelnStderr(process, terminal, `crypto import: unsupported input format '${format}'`)
    return 1
  }

  const outputKeyFormat = SUPPORTED_KEY_FORMATS[outputFormat]
  if (!outputKeyFormat) {
    await writelnStderr(process, terminal, `crypto import: unsupported output format '${outputFormat}'`)
    return 1
  }

  if (keyFormat !== 'jwk' && (!algorithm || typeof algorithm !== 'string')) {
    await writelnStderr(process, terminal, 'crypto import: --algorithm is required for non-JWK formats')
    return 1
  }

  try {
    let inputData: Uint8Array
    if (input) {
      inputData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, input as string))
    } else {
      if (!process?.stdin) {
        await writelnStderr(process, terminal, 'crypto import: no input specified')
        return 1
      }
      const reader = process.stdin.getReader()
      inputData = await readStreamToUint8Array(reader)
    }

    let keyMaterial: JsonWebKey | ArrayBuffer
    let importAlgorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | HmacImportParams
    let keyUsages: KeyUsage[]

    if (keyFormat === 'jwk') {
      const json = new TextDecoder().decode(inputData)
      const jwk = JSON.parse(json) as JsonWebKey
      keyMaterial = jwk

      if (jwk.kty === 'RSA') {
        importAlgorithm = { name: 'RSA-OAEP', hash: 'SHA-256' }
        keyUsages = jwk.d ? ['decrypt', 'encrypt'] : ['encrypt']
      } else if (jwk.kty === 'EC') {
        importAlgorithm = { name: 'ECDSA', namedCurve: jwk.crv || 'P-256' }
        keyUsages = jwk.d ? ['sign', 'verify'] : ['verify']
      } else if (jwk.kty === 'oct') {
        importAlgorithm = { name: 'AES-GCM' }
        keyUsages = ['encrypt', 'decrypt']
      } else {
        await writelnStderr(process, terminal, 'crypto import: unsupported key type in JWK')
        return 1
      }
    } else {
      keyMaterial = toArrayBuffer(inputData.buffer)
      const algoLower = (algorithm as string).toLowerCase()

      if (SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower]) {
        importAlgorithm = { name: SUPPORTED_SYMMETRIC_ALGORITHMS[algoLower] }
        keyUsages = ['encrypt', 'decrypt']
      } else if (SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'ECDSA' || SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'ECDH') {
        importAlgorithm = { name: SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower], namedCurve: 'P-256' }
        keyUsages = SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'ECDSA' ? ['sign', 'verify'] : ['deriveKey', 'deriveBits']
      } else if (SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower]?.startsWith('RSA')) {
        importAlgorithm = { name: SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower], hash: 'SHA-256' }
        keyUsages = SUPPORTED_ASYMMETRIC_ALGORITHMS[algoLower] === 'RSA-OAEP' ? ['encrypt', 'decrypt'] : ['sign', 'verify']
      } else if (algoLower === 'hmac') {
        importAlgorithm = { name: 'HMAC', hash: 'SHA-256' }
        keyUsages = ['sign', 'verify']
      } else {
        await writelnStderr(process, terminal, `crypto import: unsupported algorithm '${algorithm}'`)
        return 1
      }
    }

    const key = keyFormat === 'jwk'
      ? await crypto.subtle.importKey('jwk', keyMaterial as JsonWebKey, importAlgorithm, true, keyUsages)
      : await crypto.subtle.importKey(keyFormat as 'raw' | 'pkcs8' | 'spki', keyMaterial as ArrayBuffer, importAlgorithm, true, keyUsages)
    
    let exported: ArrayBuffer | JsonWebKey
    if ('publicKey' in key && 'privateKey' in key) {
      const keyPair = key as CryptoKeyPair
      if (outputKeyFormat === 'spki') {
        exported = await crypto.subtle.exportKey('spki', keyPair.publicKey)
      } else if (outputKeyFormat === 'pkcs8') {
        exported = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      } else if (outputKeyFormat === 'jwk') {
        exported = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
      } else {
        await writelnStderr(process, terminal, 'crypto import: asymmetric keys cannot be exported in raw format')
        return 1
      }
    } else {
      if (outputKeyFormat === 'pkcs8' || outputKeyFormat === 'spki') {
        await writelnStderr(process, terminal, `crypto import: symmetric keys cannot be exported in ${outputKeyFormat} format`)
        return 1
      }
      exported = await crypto.subtle.exportKey(outputKeyFormat, key as CryptoKey)
    }

    let outputData: Uint8Array
    if (outputKeyFormat === 'jwk') {
      outputData = new TextEncoder().encode(JSON.stringify(exported as JsonWebKey, null, 2))
    } else {
      outputData = new Uint8Array(exported as ArrayBuffer)
    }

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), outputData)
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
          if (outputKeyFormat === 'jwk') {
            await writer.write(new TextEncoder().encode('\n'))
          }
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto import: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleExport(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto export [OPTIONS]

Export keys to various formats.

Options:
  --key-file, -k FILE           Key file (JWK format)
  --format, -f FORMAT           Output format (jwk, raw, pkcs8, spki) (default: jwk)
  --output, -o FILE             Output file (default: stdout)
  --help                        Display this help`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const keyFile = parsed['key-file'] || parsed.k
  const formatValue = parsed.format || parsed.f || 'jwk'
  const format = (typeof formatValue === 'string' ? formatValue : 'jwk').toLowerCase()
  const output = parsed.output || parsed.o

  if (!keyFile || typeof keyFile !== 'string') {
    await writelnStderr(process, terminal, 'crypto export: --key-file is required')
    return 1
  }

  const keyFormat = SUPPORTED_KEY_FORMATS[format]
  if (!keyFormat) {
    await writelnStderr(process, terminal, `crypto export: unsupported format '${format}'`)
    return 1
  }

  try {
    const keyPath = path.resolve(shell.cwd, keyFile)
    const keyData = await readFileToUint8Array(shell.context.fs.promises, keyPath)
    const keyJson = JSON.parse(new TextDecoder().decode(keyData)) as JsonWebKey

    let importAlgorithm: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams | HmacImportParams
    let keyUsages: KeyUsage[]

    if (keyJson.kty === 'RSA') {
      importAlgorithm = { name: 'RSA-OAEP', hash: 'SHA-256' }
      keyUsages = keyJson.d ? ['decrypt', 'encrypt'] : ['encrypt']
    } else if (keyJson.kty === 'EC') {
      importAlgorithm = { name: 'ECDSA', namedCurve: keyJson.crv || 'P-256' }
      keyUsages = keyJson.d ? ['sign', 'verify'] : ['verify']
    } else if (keyJson.kty === 'oct') {
      importAlgorithm = { name: 'AES-GCM' }
      keyUsages = ['encrypt', 'decrypt']
    } else {
      await writelnStderr(process, terminal, 'crypto export: unsupported key type in JWK')
      return 1
    }

    const key = await crypto.subtle.importKey('jwk', keyJson, importAlgorithm, true, keyUsages)
    const exported = await crypto.subtle.exportKey(keyFormat, key)

    let outputData: Uint8Array
    if (keyFormat === 'jwk') {
      outputData = new TextEncoder().encode(JSON.stringify(exported as JsonWebKey, null, 2))
    } else {
      outputData = new Uint8Array(exported as ArrayBuffer)
    }

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), outputData)
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
          if (keyFormat === 'jwk') {
            await writer.write(new TextEncoder().encode('\n'))
          }
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto export: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleDerive(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto derive [OPTIONS]

Derive keys from passwords or other keys.

Options:
  --algorithm, -a ALGORITHM    Algorithm (PBKDF2, HKDF, ECDH)
  --password, -p PASSWORD        Password (for PBKDF2/HKDF)
  --salt-file FILE               Salt file (for PBKDF2/HKDF)
  --iterations, -i COUNT         Iterations (for PBKDF2, default: 100000)
  --key-file FILE                 Private key file (for ECDH)
  --public-key-file FILE          Public key file (for ECDH)
  --output, -o FILE               Output file (default: stdout, JWK format)
  --help                          Display this help`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const algorithm = parsed.algorithm || parsed.a
  const password = parsed.password || parsed.p
  const saltFile = parsed['salt-file']
  const iterations = parsed.iterations || parsed.i
  const keyFile = parsed['key-file']
  const publicKeyFile = parsed['public-key-file']
  const output = parsed.output || parsed.o

  if (!algorithm || typeof algorithm !== 'string') {
    await writelnStderr(process, terminal, 'crypto derive: --algorithm is required')
    return 1
  }

  try {
    const algoLower = algorithm.toLowerCase()
    if (!SUPPORTED_DERIVE_ALGORITHMS[algoLower]) {
      await writelnStderr(process, terminal, `crypto derive: unsupported algorithm '${algorithm}'`)
      return 1
    }

    let derivedKey: CryptoKey

    if (algoLower === 'pbkdf2') {
      if (!password || typeof password !== 'string') {
        await writelnStderr(process, terminal, 'crypto derive: --password is required for PBKDF2')
        return 1
      }

      let salt: Uint8Array
      if (saltFile && typeof saltFile === 'string') {
        salt = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, saltFile))
      } else {
        salt = crypto.getRandomValues(new Uint8Array(16))
      }

      const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
      )

      const saltBuffer = toArrayBuffer(salt.buffer)
      derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: new Uint8Array(saltBuffer, salt.byteOffset, salt.length),
          iterations: iterations ? parseInt(iterations as string, 10) : 100000,
          hash: 'SHA-256'
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
    } else if (algoLower === 'hkdf') {
      if (!password || typeof password !== 'string') {
        await writelnStderr(process, terminal, 'crypto derive: --password is required for HKDF')
        return 1
      }

      let salt: Uint8Array
      if (saltFile && typeof saltFile === 'string') {
        salt = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, saltFile))
      } else {
        salt = crypto.getRandomValues(new Uint8Array(16))
      }

      const passwordKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'HKDF',
        false,
        ['deriveBits', 'deriveKey']
      )

      const saltBuffer = toArrayBuffer(salt.buffer)
      derivedKey = await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          salt: new Uint8Array(saltBuffer, salt.byteOffset, salt.length),
          hash: 'SHA-256',
          info: new Uint8Array(0)
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
    } else {
      if (!keyFile || typeof keyFile !== 'string') {
        await writelnStderr(process, terminal, 'crypto derive: --key-file is required for ECDH')
        return 1
      }

      if (!publicKeyFile || typeof publicKeyFile !== 'string') {
        await writelnStderr(process, terminal, 'crypto derive: --public-key-file is required for ECDH')
        return 1
      }

      const privateKeyData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, keyFile))
      const privateKeyJson = JSON.parse(new TextDecoder().decode(privateKeyData)) as JsonWebKey

      const publicKeyData = await readFileToUint8Array(shell.context.fs.promises, path.resolve(shell.cwd, publicKeyFile))
      const publicKeyJson = JSON.parse(new TextDecoder().decode(publicKeyData)) as JsonWebKey

      const privateKey = await crypto.subtle.importKey('jwk', privateKeyJson, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits', 'deriveKey'])
      const publicKey = await crypto.subtle.importKey('jwk', publicKeyJson, { name: 'ECDH', namedCurve: 'P-256' }, false, [])

      derivedKey = await crypto.subtle.deriveKey(
        { name: 'ECDH', public: publicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
    }

    const exported = await crypto.subtle.exportKey('jwk', derivedKey)
    const outputData = new TextEncoder().encode(JSON.stringify(exported, null, 2))

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), outputData)
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(outputData)
          await writer.write(new TextEncoder().encode('\n'))
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(outputData))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto derive: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

async function handleRandom(
  shell: Shell,
  terminal: Terminal,
  process: Process | undefined,
  args: string[]
): Promise<number> {
  const usage = `Usage: crypto random [OPTIONS]

Generate random bytes.

Options:
  --length, -l LENGTH          Number of bytes to generate (default: 32)
  --output, -o FILE             Output file (default: stdout)
  --help                        Display this help`

  const parsed = parseArgs(args)

  if (parsed.help) {
    await writelnStderr(process, terminal, usage)
    return 0
  }

  const length = parsed.length || parsed.l
  const output = parsed.output || parsed.o

  const byteLength = length ? parseInt(length as string, 10) : 32

  if (isNaN(byteLength) || byteLength <= 0) {
    await writelnStderr(process, terminal, 'crypto random: --length must be a positive number')
    return 1
  }

  try {
    const randomBytes = crypto.getRandomValues(new Uint8Array(byteLength))

    if (output) {
      await writeUint8ArrayToFile(shell.context.fs.promises, path.resolve(shell.cwd, output as string), randomBytes)
    } else {
      if (process?.stdout) {
        const writer = process.stdout.getWriter()
        try {
          await writer.write(randomBytes)
        } finally {
          writer.releaseLock()
        }
      } else {
        terminal.write(new TextDecoder().decode(randomBytes))
      }
    }

    return 0
  } catch (error) {
    await writelnStderr(process, terminal, `crypto random: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return 1
  }
}

export function createCommand(kernel: Kernel, shell: Shell, terminal: Terminal): TerminalCommand {
  return new TerminalCommand({
    command: 'crypto',
    description: 'Cryptographic utilities using the Web Crypto API',
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

      if (argv.length === 0) {
        printUsage(process, terminal)
        return 0
      }

      const subcommand = argv[0]?.toLowerCase()
      const subArgs = argv.slice(1)

      try {
        switch (subcommand) {
          case 'generate':
            return await handleGenerate(shell, terminal, process, subArgs)
          case 'encrypt':
            return await handleEncrypt(shell, terminal, process, subArgs)
          case 'decrypt':
            return await handleDecrypt(shell, terminal, process, subArgs)
          case 'sign':
            return await handleSign(shell, terminal, process, subArgs)
          case 'verify':
            return await handleVerify(shell, terminal, process, subArgs)
          case 'import':
            return await handleImport(shell, terminal, process, subArgs)
          case 'export':
            return await handleExport(shell, terminal, process, subArgs)
          case 'derive':
            return await handleDerive(shell, terminal, process, subArgs)
          case 'random':
            return await handleRandom(shell, terminal, process, subArgs)
          default:
            await writelnStderr(process, terminal, chalk.red(`Error: Unknown subcommand: ${subcommand}`))
            await writelnStderr(process, terminal, 'Run "crypto --help" for usage information')
            return 1
        }
      } catch (error) {
        await writelnStderr(process, terminal, chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`))
        return 1
      }
    }
  })
}
