
import i18nextLoader from 'vite-plugin-i18next-loader'
import path from 'path'
import { defineConfig, ViteUserConfig } from 'vitest/config'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import dts from 'vite-plugin-dts'

import pkg from './package.json'

export default defineConfig({
  plugins: [
    nodePolyfills({
      protocolImports: true,
      include: [
        'assert', 'child_process', 'cluster', 'console', 'constants', 'crypto',
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
    'import.meta.env.DESCRIPTION': JSON.stringify(pkg.description),
    'import.meta.env.HOMEPAGE': JSON.stringify(pkg.homepage),
    'import.meta.env.REPOSITORY': JSON.stringify(pkg.repository),
    'import.meta.env.AUTHOR': JSON.stringify(pkg.author),
    'import.meta.env.KNOWN_ISSUES': JSON.stringify(pkg.knownIssues),
    'import.meta.env.TIPS': JSON.stringify(pkg.tips)
  },
  resolve: {
    alias: {
      '@zenfs/core-dev': path.resolve(process.env['HOME'] || process.env['USERPROFILE'] || __dirname, 'code/zenfs-core/dist')
    }
  },
  server: {
    port: Number(process.env['VITE_PORT']) || 30443,
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
    poolOptions: {
      forks: {
        execArgv: ['--no-warnings=ExperimentalWarning']
      }
    }
  }
})
