import { WASIShim } from '@bytecodealliance/preview2-shim/instantiation'
import type { Kernel, Shell, WasiStreamOptions } from '@ecmaos/types'

interface WasiComponentResult {
  instance: WebAssembly.Instance
  exitCode: Promise<number>
}

/**
 * Load a WASI Preview 2 component
 * Uses jco to transpile component model to core wasm + JS, then uses preview2-shim
 */
export default async function loadWasiPreview2(
  path: string,
  wasmBytes: Uint8Array,
  streams: WasiStreamOptions,
  args: string[],
  kernel: Kernel,
  shell?: Shell
): Promise<WasiComponentResult> {
  const stdinReader = streams.stdin.getReader()
  const stdoutWriter = streams.stdout.getWriter()
  const stderrWriter = streams.stderr.getWriter()

  // Dynamically import jco for transpilation
  const jco = await import('@bytecodealliance/jco')
  const { transpile: transpileComponent } = jco

  // Import preview2-shim CLI module to set args/env
  const wasiCli = await import('@bytecodealliance/preview2-shim/cli')
  const wasiCliAny = wasiCli as Record<string, unknown>

  // Set args if provided
  if (args.length > 0 && typeof wasiCliAny._setArgs === 'function') {
    (wasiCliAny._setArgs as (args: string[]) => void)(args)
  }

  // Set environment variables
  const activeShell = shell || kernel.shell
  if (activeShell && activeShell.env && typeof wasiCliAny._setEnv === 'function') {
    const envArray: Array<[string, string]> = []
    for (const [key, value] of activeShell.env.entries()) {
      envArray.push([key, value])
    }
    (wasiCliAny._setEnv as (env: Array<[string, string]>) => void)(envArray)
  }

  // Set custom stdin handler
  if (typeof wasiCliAny._setStdin === 'function') {
    const ioAny = await import('@bytecodealliance/preview2-shim/io') as Record<string, unknown>
    const streamsModule = ioAny.streams as Record<string, unknown>
    const InputStream = streamsModule.InputStream as new (handler: unknown) => unknown
    const stdinStream = new InputStream({
      blockingRead: async (len: bigint) => {
        try {
          const { done, value } = await stdinReader.read()
          if (done) {
            return new Uint8Array(0)
          }
          const result = value || new Uint8Array(0)
          return result.slice(0, Number(len))
        } catch {
          return new Uint8Array(0)
        }
      },
      subscribe: () => ({ tag: 'ready' as const }),
      [Symbol.dispose || Symbol.for('dispose')]: () => {}
    })
    ;(wasiCliAny._setStdin as (stream: typeof stdinStream) => void)(stdinStream)
  }

  // Set custom stdout handler
  if (typeof wasiCliAny._setStdout === 'function') {
    const ioAny = await import('@bytecodealliance/preview2-shim/io') as Record<string, unknown>
    const streamsModule = ioAny.streams as Record<string, unknown>
    const OutputStream = streamsModule.OutputStream as new (handler: unknown) => unknown
    const stdoutStream = new OutputStream({
      write: async (contents: Uint8Array) => {
        try {
          await stdoutWriter.write(contents)
        } catch {
          // Ignore write errors
        }
      },
      blockingFlush: async () => {
        try {
          await stdoutWriter.ready
        } catch {
          // Ignore flush errors
        }
      },
      [Symbol.dispose || Symbol.for('dispose')]: () => {}
    })
    ;(wasiCliAny._setStdout as (stream: typeof stdoutStream) => void)(stdoutStream)
  }

  // Set custom stderr handler
  if (typeof wasiCliAny._setStderr === 'function') {
    const ioAny = await import('@bytecodealliance/preview2-shim/io') as Record<string, unknown>
    const streamsModule = ioAny.streams as Record<string, unknown>
    const OutputStream = streamsModule.OutputStream as new (handler: unknown) => unknown
    const stderrStream = new OutputStream({
      write: async (contents: Uint8Array) => {
        try {
          await stderrWriter.write(contents)
        } catch {
          // Ignore write errors
        }
      },
      blockingFlush: async () => {
        try {
          await stderrWriter.ready
        } catch {
          // Ignore flush errors
        }
      },
      [Symbol.dispose || Symbol.for('dispose')]: () => {}
    })
    ;(wasiCliAny._setStderr as (stream: typeof stderrStream) => void)(stderrStream)
  }

  // Create WASI shim
  const shim = new WASIShim()

  // Transpile component model to core wasm + JS
  kernel.log.info('Transpiling WASI Preview 2 component...')
  const { files } = await transpileComponent(wasmBytes, {
    name: 'component',
    wasiShim: false
  })

  // Find the JS file and WASM files
  const jsFile = files.find(([name]: [string, Uint8Array]) => name.endsWith('.js'))
  const wasmFiles = files.filter(([name]: [string, Uint8Array]) => name.endsWith('.wasm'))

  if (!jsFile) {
    throw new Error('Transpilation did not produce a JS file')
  }

  // Pre-import preview2-shim modules to provide them to the transpiled code
  
  const [wasiCliModule, wasiClocksModule, wasiFilesystemModule, wasiIoModule] = await Promise.all([
    import('@bytecodealliance/preview2-shim/cli'),
    import('@bytecodealliance/preview2-shim/clocks'),
    import('@bytecodealliance/preview2-shim/filesystem'),
    import('@bytecodealliance/preview2-shim/io')
  ])

  // Convert JS content to string to fix wasi: imports
  const jsContent = jsFile[1] as Uint8Array
  const decoder = new TextDecoder('utf-8')
  let jsCode = decoder.decode(jsContent)

  // Store pre-imported modules in a global map that the transpiled code can access
  const globalThisAnyWasi = globalThis as Record<string, unknown>
  if (!globalThisAnyWasi.__ecmaosWasiModules) {
    globalThisAnyWasi.__ecmaosWasiModules = new Map<string, unknown>()
  }
  const globalWasiModuleMap = globalThisAnyWasi.__ecmaosWasiModules as Map<string, unknown>
  
  // Map all wasi: specifiers to their corresponding modules
  const wasiSpecToModule: Array<[string, unknown]> = [
    ['wasi:cli/environment', wasiCliModule],
    ['wasi:cli/exit', wasiCliModule],
    ['wasi:cli/stderr', wasiCliModule],
    ['wasi:cli/stdin', wasiCliModule],
    ['wasi:cli/stdout', wasiCliModule],
    ['wasi:cli/terminal-input', wasiCliModule],
    ['wasi:cli/terminal-output', wasiCliModule],
    ['wasi:cli/terminal-stderr', wasiCliModule],
    ['wasi:cli/terminal-stdin', wasiCliModule],
    ['wasi:cli/terminal-stdout', wasiCliModule],
    ['wasi:clocks/monotonic-clock', wasiClocksModule],
    ['wasi:clocks/wall-clock', wasiClocksModule],
    ['wasi:filesystem/preopens', wasiFilesystemModule],
    ['wasi:filesystem/types', wasiFilesystemModule],
    ['wasi:io/error', wasiIoModule],
    ['wasi:io/poll', wasiIoModule],
    ['wasi:io/streams', wasiIoModule]
  ]
  
  for (const [spec, mod] of wasiSpecToModule) {
    globalWasiModuleMap.set(spec, mod)
  }

  // Inject import resolver code
  const resolverCode = `
// Injected module resolver for wasi: imports
function __resolveWasiSpec(specifier) {
  if (specifier.startsWith('wasi:')) {
    const moduleMap = globalThis.__ecmaosWasiModules;
    if (!moduleMap) {
      throw new Error('WASI module map not initialized');
    }
    let module = moduleMap.get(specifier);
    if (module) return Promise.resolve(module);
    // Handle versioned specifiers (e.g., wasi:cli/exit@0.2.6)
    const baseSpec = specifier.split('@')[0];
    module = moduleMap.get(baseSpec);
    if (module) return Promise.resolve(module);
    throw new Error(\`Unknown wasi: specifier: \${specifier}\`);
  }
  
  // Validate specifier before calling import()
  if (!specifier || typeof specifier !== 'string') {
    throw new Error(\`Invalid import specifier: \${specifier}\`);
  }
  
  // Try to validate it's a valid URL or relative path
  try {
    new URL(specifier);
    // It's a valid absolute URL, use it directly
    return import(specifier);
  } catch (e) {
    // Not a valid absolute URL, check if it's a relative path
    if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) {
      // Relative paths don't work with blob URLs - we need to resolve them differently
      throw new Error(\`Relative imports are not supported from blob URLs: \${specifier}. This is likely a non-wasi import in the transpiled code.\`);
    }
    // Not a relative path either - invalid specifier
    throw new Error(\`Invalid import specifier (not a valid URL or relative path): \${specifier}\`);
  }
}
`

  // Convert static imports to dynamic imports
  // Pattern: import { x } from 'wasi:...' -> const __wasiMod_X = await __resolveWasiSpec('wasi:...'); const { x } = __wasiMod_X;
  // Handle imports with 'as' clauses by converting them to proper JavaScript destructuring syntax
  // Match various import patterns:
  // - import { x, y } from '...'
  // - import * as x from '...'
  // - import x from '...'
  // - import { x as y } from '...'
  const staticImportPattern = /import\s+(\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"](wasi:[^'"]+)['"]/g
  
  jsCode = jsCode.replace(staticImportPattern, (_match, imports, specifier) => {
    // Generate a unique variable name for this import
    const importVar = `__wasiMod_${specifier.replace(/[^a-zA-Z0-9]/g, '_')}`
    
    // Convert TypeScript-style 'as' to JavaScript destructuring syntax
    // { a as b } -> { a: b }
    // Need to match: identifier [as identifier] pattern
    let destructuringPattern = imports
    if (imports.startsWith('{') && imports.includes(' as ')) {
      // Replace 'identifier as identifier' with 'identifier: identifier'
      // Match word boundaries to avoid partial matches
      destructuringPattern = imports.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')
    }
    
    // Use top-level await (ES modules support this)
    const replacement = `const ${importVar} = await __resolveWasiSpec('${specifier}');\nconst ${destructuringPattern} = ${importVar};`
    return replacement
  })

  // Handle dynamic imports: import('wasi:...') -> __resolveWasiSpec('wasi:...')
  jsCode = jsCode.replace(/import\(['"](wasi:[^'"]+)['"]\)/g, (_match, specifier) => {
    return `__resolveWasiSpec('${specifier}')`
  })

  // Wrap the entire module in a try-catch to catch any import errors
  // Also need to handle the case where the module might have imports at the top level
  // that we haven't caught. Let's wrap the code in an async IIFE if it's not already
  
  // Check if the code starts with imports (which we've already converted)
  // If there are any remaining import statements we missed, they'll fail
  // Let's add error handling around the entire module execution
  
  // Prepend the resolver code
  jsCode = resolverCode + '\n' + jsCode
  
  // Fix URL construction issues: jco generates code like `new URL('./file.wasm', import.meta.url)`
  // which fails with blob URLs. We need to replace these with direct blob URL references.
  // Create a map of WASM file names to their blob URLs
  const wasmFileBlobMap = new Map<string, string>()
  for (const [name] of wasmFiles) {
    // The blob URL will be created later, but we need to inject a function that maps file names to URLs
    wasmFileBlobMap.set(name, `__wasmBlob_${name.replace(/[^a-zA-Z0-9]/g, '_')}`)
  }
  
  // Inject a function to resolve WASM file URLs and override fetchCompile if needed
  const wasmUrlResolverCode = `
// Injected WASM URL resolver
const __wasmFileMap = new Map([
${Array.from(wasmFileBlobMap.entries()).map(([name, varName]) => `  ['${name}', '${varName}']`).join(',\n')}
]);

// Override URL constructor to handle WASM file resolution
const __originalURLConstructor = globalThis.URL;
globalThis.URL = function(input, base) {
  // If base is import.meta.url (blob URL) and input is a relative path to a .wasm file
  if (base && typeof base === 'string' && base.startsWith('blob:') && 
      typeof input === 'string' && (input.endsWith('.wasm') || input.includes('.wasm'))) {
    // Extract the filename from the relative path
    let fileName = input
    if (fileName.startsWith('./')) fileName = fileName.slice(2)
    if (fileName.startsWith('../')) fileName = fileName.slice(3)
    // Try to get from the global map (set by the host code)
    const globalMap = globalThis.__ecmaosWasmFileMap
    const blobUrl = globalMap ? globalMap.get(fileName) : __wasmFileMap.get(fileName)
    if (blobUrl && typeof blobUrl === 'string' && blobUrl.startsWith('blob:')) {
      // Return a proper URL instance (not extended class)
      return new __originalURLConstructor(blobUrl)
    }
  }
  
  // Fall back to original URL constructor
  return new __originalURLConstructor(input, base)
};
// Copy static methods and properties
Object.setPrototypeOf(globalThis.URL, __originalURLConstructor);
Object.defineProperty(globalThis.URL, 'prototype', {
  value: __originalURLConstructor.prototype,
  writable: false
});
`
  
  // Patch fetchCompile in the transpiled code to handle blob URLs
  // jco generates: return fetch(url).then(WebAssembly.compileStreaming);
  // We need to ensure the URL works correctly with fetch
  jsCode = jsCode.replace(
    /return\s+fetch\(url\)\.then\(WebAssembly\.compileStreaming\);/g,
    `return fetch(url).then(response => {
      if (!response.ok) {
        throw new Error(\`Failed to fetch WASM: \${response.status} \${response.statusText}\`);
      }
      return WebAssembly.compileStreaming(response);
    });`
  )
  
  // Prepend the WASM URL resolver code
  jsCode = wasmUrlResolverCode + '\n' + jsCode

  // Convert back to Uint8Array
  const encoder = new TextEncoder()
  const fixedJsContent = encoder.encode(jsCode)
  const jsBuffer = fixedJsContent.buffer.slice(fixedJsContent.byteOffset, fixedJsContent.byteOffset + fixedJsContent.byteLength) as ArrayBuffer
  const jsBlob = new Blob([jsBuffer], { type: 'application/javascript' })
  const jsUrl = URL.createObjectURL(jsBlob)

  const wasmFileMap = new Map<string, string>()
  // Store in global for the URL constructor override to access
  const globalThisAny = globalThis as Record<string, unknown>
  if (!globalThisAny.__ecmaosWasmFileMap) {
    globalThisAny.__ecmaosWasmFileMap = new Map<string, string>()
  }
  const globalWasmFileMap = globalThisAny.__ecmaosWasmFileMap as Map<string, string>
  
  for (const [name, content] of wasmFiles) {
    const wasmContent = content as Uint8Array
    const wasmBuffer = wasmContent.buffer.slice(wasmContent.byteOffset, wasmContent.byteOffset + wasmContent.byteLength) as ArrayBuffer
    const wasmBlob = new Blob([wasmBuffer], { type: 'application/wasm' })
    const wasmUrl = URL.createObjectURL(wasmBlob)
    wasmFileMap.set(name, wasmUrl)
    globalWasmFileMap.set(name, wasmUrl)
  }

  // Dynamic import of transpiled module
  const module = await import(/* @vite-ignore */ jsUrl)

  // Create getCoreModule function for instantiation
  const getCoreModule = async (modulePath: string): Promise<WebAssembly.Module> => {
    const wasmUrl = wasmFileMap.get(modulePath)
    if (!wasmUrl) {
      throw new Error(`WASM module not found: ${modulePath}`)
    }
    const response = await fetch(wasmUrl)
    const buffer = await response.arrayBuffer()
    return await WebAssembly.compile(buffer)
  }

  // Get import object from shim
  const importObject = shim.getImportObject()

  // Instantiate the transpiled component
  const instantiate = module.instantiate || module.default?.instantiate
  if (!instantiate || typeof instantiate !== 'function') {
    throw new Error('Transpiled module does not export instantiate function')
  }

  const component = await instantiate(getCoreModule, importObject)

  // Find the instance (it might be nested in the component exports)
  let instance: WebAssembly.Instance | null = null
  let exitCodePromise: Promise<number> = Promise.resolve(0)

  // Look for wasi:cli/run export
  if (component['wasi:cli/run'] && typeof component['wasi:cli/run'] === 'object') {
    const run = component['wasi:cli/run'] as { run?: () => Promise<number> }
    if (run.run) {
      exitCodePromise = run.run().catch((error) => {
        kernel.log.error(`WASI run failed: ${(error as Error).message}`)
        return 1
      })
    }
  } else if (component.run && typeof component.run === 'function') {
    exitCodePromise = Promise.resolve(component.run()).catch((error) => {
      kernel.log.error(`Component run failed: ${(error as Error).message}`)
      return 1
    })
  } else {
    // Try to find _start or _initialize in exports
    const exports = component as Record<string, unknown>
    if (typeof exports._start === 'function') {
      try {
        (exports._start as () => void)()
        exitCodePromise = Promise.resolve(0)
      } catch (error) {
        kernel.log.error(`WASM _start failed: ${(error as Error).message}`)
        exitCodePromise = Promise.resolve(1)
      }
    } else if (typeof exports._initialize === 'function') {
      try {
        (exports._initialize as () => void)()
        exitCodePromise = Promise.resolve(0)
      } catch (error) {
        kernel.log.error(`WASM _initialize failed: ${(error as Error).message}`)
        exitCodePromise = Promise.resolve(1)
      }
    }
  }

  // Create a dummy instance for compatibility
  instance = {
    exports: component as WebAssembly.Exports
  } as WebAssembly.Instance

  exitCodePromise = exitCodePromise.finally(async () => {
    try {
      await stdinReader.releaseLock()
    } catch {}
    try {
      await stdoutWriter.releaseLock()
    } catch {}
    try {
      await stderrWriter.releaseLock()
    } catch {}
    // Clean up blob URLs
    URL.revokeObjectURL(jsUrl)
    for (const url of wasmFileMap.values()) {
      URL.revokeObjectURL(url)
    }
  })

  return { instance, exitCode: exitCodePromise }
}
