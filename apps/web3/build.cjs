const esbuild = require('esbuild')

const nodeBuiltins = [
  'stream',
  'crypto',
  'events',
  'http',
  'https',
  'net',
  'tls',
  'zlib',
  'url',
  'util',
  'buffer',
  'process',
  'os',
  'path',
  'fs',
  'child_process',
  'dns',
  'dgram',
  'querystring',
  'string_decoder',
  'timers',
  'tty',
  'vm',
  'assert',
  'constants',
  'cluster',
  'http2',
  'punycode'
]

esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: true,
  platform: 'neutral',
  format: 'esm',
  outfile: 'dist/index.js',
  banner: {
    js: '#!ecmaos:bin:app:web3'
  },
  external: [
    '@ecmaos/types',
    'ws',
    ...nodeBuiltins
  ],
  target: 'es2022',
  minify: false,
  keepNames: true
}).catch(() => process.exit(1))
