import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const temporaryRoot = resolve('.cache/tmp')
await mkdir(temporaryRoot, { recursive: true })
const outputDirectory = await mkdtemp(join(temporaryRoot, 'test-'))

try {
  const tests = (await readdir('tests')).filter((name) => /\.test\.(ts|mjs)$/.test(name))
  if (!tests.length) throw new Error('No tests found')
  await build({
    entryPoints: tests.map((name) => join('tests', name)),
    outdir: outputDirectory,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  })
  const result = spawnSync(process.execPath, [
    '--test',
    ...tests.map((name) => join(outputDirectory, name.replace(/\.(ts|mjs)$/, '.mjs'))),
  ], {
    stdio: 'inherit',
    env: { ...process.env, TEMP: temporaryRoot, TMP: temporaryRoot, NODE_DISABLE_COMPILE_CACHE: '1' },
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(outputDirectory, { recursive: true, force: true })
}