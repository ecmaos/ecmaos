
import i18nextLoader from 'vite-plugin-i18next-loader'
import path from 'path'
import { defineConfig, ViteUserConfig } from 'vitest/config'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import dts from 'vite-plugin-dts'
import type { ViteDevServer } from 'vite'

import pkg from './package.json'

const xterm = pkg.dependencies['@xterm/xterm']
const xtermVersion = xterm.replace('^', '').replace('~', '')
const zenfs = pkg.dependencies['@zenfs/core']
const zenfsVersion = zenfs.replace('^', '').replace('~', '')

const gzipFixPlugin = () => {
  const fixHeader = (server: ViteDevServer) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.includes(".gz")) {
        res.setHeader("Content-Type", "application/x-gzip")
        // `res.removeHeader("Content-Encoding")` does not work
        res.setHeader("Content-Encoding", "invalid-value")
      }
      
      if (req.url?.includes('.wasm')) {
        res.setHeader("Content-Type", "application/wasm")
      }

      next()
    })
  }

  return {
    name: "gzip-fix-plugin",
    configureServer: fixHeader,
    configurePreviewServer: fixHeader
  }
}

// TODO: Revisit this approach
const jcoBrowserFixPlugin = () => {
  return {
    name: 'jco-browser-fix',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (id.includes('js-component-bindgen-component.js')) {
        let modified = code

        // Fix base64Compile to always use browser path (atob instead of Buffer)
        // The Buffer polyfill causes issues with WebAssembly.compile
        modified = modified.replace(
          /const\s+base64Compile\s*=\s*str\s*=>\s*WebAssembly\.compile\(typeof\s+Buffer\s*!==\s*['"]undefined['"]\s*\?\s*Buffer\.from\(str,\s*['"]base64['"]\)\s*:\s*Uint8Array\.from\(atob\(str\),\s*b\s*=>\s*b\.charCodeAt\(0\)\)\);?/g,
          `const base64Compile = str => WebAssembly.compile(Uint8Array.from(atob(str), b => b.charCodeAt(0)));`
        )
        
        // Fix fetchCompile - async function returns Promise without await, causing Promise<Promise<Module>>
        modified = modified.replace(
          /return\s+fetch\(url\)\.then\(WebAssembly\.compileStreaming\);/g,
          `return await fetch(url).then(WebAssembly.compileStreaming);`
        )

        // Fix instantiateCore to return { exports } instead of Instance, and handle Promise sources
        const instantiateCorePattern = /const\s+instantiateCore\s*=\s*WebAssembly\.instantiate;?/g
        if (instantiateCorePattern.test(code)) {
          modified = modified.replace(
            instantiateCorePattern,
            `const _originalInstantiateCore = WebAssembly.instantiate;
const instantiateCore = (source, imports) => {
  const sourceHasThen = source && typeof source.then === 'function';
  const sourceTypeName = source?.constructor?.name;
  const isLikelyPromise = sourceTypeName === 'Promise' || sourceHasThen;
  const sourceIsModule = source instanceof WebAssembly.Module;
  
  // If source is a Promise (e.g., from fetchCompile), await it first
  if (isLikelyPromise && !sourceIsModule) {
    return source.then(resolvedSource => {
      return _originalInstantiateCore(resolvedSource, imports).then(result => {
        const exportsValue = result instanceof WebAssembly.Instance ? result.exports : (result?.instance?.exports || result?.exports);
        return { exports: exportsValue };
      });
    });
  }
  
  // If source is not a Promise, proceed normally
  return _originalInstantiateCore(source, imports).then(result => {
    const exportsValue = result instanceof WebAssembly.Instance ? result.exports : (result?.instance?.exports || result?.exports);
    return { exports: exportsValue };
  });
};`
          )
        }

        if (modified !== code) {
          return { code: modified, map: null }
        }
      }
      return null
    }
  }
}

export default defineConfig({
  envPrefix: 'ECMAOS_',
  plugins: [
    gzipFixPlugin(),
    jcoBrowserFixPlugin(),
    nodePolyfills({
      protocolImports: true,
      globals: { Buffer: true, global: true, process: true },
      include: [
        'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
        'events', 'fs', 'http', 'http2', 'https', 'os', 'path', 'punycode', 'querystring',
        'stream', 'string_decoder', 'timers', 'timers/promises', 'tty', 'url', 'util', 'vm', 'zlib'
      ]
    }),
    i18nextLoader({ namespaceResolution: 'basename', paths: ['locales'] }),
    dts({ rollupTypes: true, exclude: ['src/ui.ts'] })
  ] as ViteUserConfig['plugins'],
  define: {
    'import.meta.env.NAME': JSON.stringify(pkg.name),
    'import.meta.env.VERSION': JSON.stringify(pkg.version),
    'import.meta.env.XTERM_VERSION': JSON.stringify(xtermVersion),
    'import.meta.env.ZENFS_VERSION': JSON.stringify(zenfsVersion),
    'import.meta.env.DESCRIPTION': JSON.stringify(pkg.description),
    'import.meta.env.HOMEPAGE': JSON.stringify(pkg.homepage),
    'import.meta.env.REPOSITORY': JSON.stringify(pkg.repository),
    'import.meta.env.AUTHOR': JSON.stringify(pkg.author),
    'import.meta.env.KNOWN_ISSUES': JSON.stringify(pkg.knownIssues),
    'import.meta.env.TIPS': JSON.stringify(pkg.tips)
  },
  resolve: {
    alias: {
      '@zenfs/core-dev': path.resolve(process.env['HOME'] || process.env['USERPROFILE'] || __dirname, 'code/zenfs-core/dist'),
      // Ensure buffer shim resolves correctly (both singular and plural for compatibility)
      'vite-plugin-node-polyfills/shim/buffer': 'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shim/global': 'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shim/process': 'vite-plugin-node-polyfills/shims/process',
      // Stub node:fs/promises for browser builds (jco library tries to import it)
      'node:fs/promises': path.resolve(__dirname, 'src/stubs/node-fs-promises.ts')
    },
    dedupe: ['vite-plugin-node-polyfills']
  },
  optimizeDeps: {
    include: ['vite-plugin-node-polyfills/shims/buffer', 'vite-plugin-node-polyfills/shims/global', 'vite-plugin-node-polyfills/shims/process'],
    exclude: ['@wasmer/sdk', '@bytecodealliance/jco']
  },
  server: {
    allowedHosts: [
      '127.0.0.1',
      'localhost',
      'ecmaos.local',
      '.ngrok-free.app',
      '.share.zrok.io'
    ],
    port: Number(process.env['ECMAOS_PORT']) || 30443,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    },
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/docs/**', '**/wasm/**']
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler'
      }
    }
  },
  esbuild: {
    minifyIdentifiers: false,
    keepNames: true
  },
  build: {
    sourcemap: true,
    minify: false,
    manifest: true,
    target: ['es2020'],
    lib: {
      entry: ['src/ui.ts', 'src/tree/kernel.ts'],
      formats: ['es'],
      name: 'ecmaos',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    deps: {
      optimizer: {
        web: {
          include: ['vitest-canvas-mock', '@ecmaos/coreutils']
        }
      }
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary', 'json'],
    },
    browser: {
      enabled: false,
      provider: 'playwright',
      name: 'chromium',
      providerOptions: {
        launch: {
          devtools: true
        }
      }
    },
    environmentOptions: {
      jsdom: {
        resources: 'usable'
      }
    },
    poolOptions: {
      forks: {
        execArgv: ['--no-warnings=ExperimentalWarning']
      }
    }
  }
})
