const esbuild = require('esbuild')
const { nodeModulesPolyfillPlugin } = require('esbuild-plugins-node-modules-polyfill')

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: true,
  platform: 'neutral',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!ecmaos:bin:app:edit'
  },
  external: ['@ecmaos/types'],
  plugins: [
    nodeModulesPolyfillPlugin({
      modules: {
        path: true
      }
    })
  ]
}).catch(() => process.exit(1))
