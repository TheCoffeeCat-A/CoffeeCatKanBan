import { build, context } from 'esbuild'
import { runtimeLicenses } from './licenses.mjs'

const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'main.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian'],
  logLevel: 'info',
  sourcemap: false,
  legalComments: 'inline',
  banner: { js: `/*! Third-party notices\n${(await runtimeLicenses()).replaceAll('*/', '* /')}*/` },
}

if (process.argv.includes('--watch')) {
  const builder = await context(options)
  await builder.watch()
} else {
  await build(options)
}
