import { build } from 'esbuild'
await build({
  entryPoints: ['src/cli/hv.ts'], outfile: 'out/cli/hv.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  external: ['better-sqlite3-multiple-ciphers'], banner: { js: '#!/usr/bin/env node' },
})
console.log('built out/cli/hv.cjs')
