import { defineConfig } from 'vite'
import cssInjectedByJs from 'vite-plugin-css-injected-by-js'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    nodePolyfills({ include: ['path'] }),
    cssInjectedByJs()
  ],
  define: {
    "import.meta.env.ECMAOS_KERNEL_MODULES": ''
  },
  server: {
    port: Number(process.env['ECMAOS_PORT']) || 30448
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
    lib: {
      entry: './src/main.ts',
      formats: ['es'],
      fileName: 'code'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  }
})
