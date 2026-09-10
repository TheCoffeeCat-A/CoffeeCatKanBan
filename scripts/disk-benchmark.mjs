import { build } from 'esbuild'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const temporaryRoot = resolve('.cache/tmp')
await mkdir(temporaryRoot, { recursive: true })
const directory = await mkdtemp(join(temporaryRoot, 'bench-runner-'))
try {
  const outfile = join(directory, 'run.mjs')
  await build({ entryPoints: ['tests/fixtures/disk-benchmark.ts'], outfile, bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' })
  const { benchmark } = await import(pathToFileURL(outfile).href)
  const report = await benchmark()
  const artifact = resolve('.cache', `disk-benchmark-${Date.now()}.json`)
  await writeFile(artifact, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ artifact, ...report }, null, 2))
} finally {
  const inside = relative(temporaryRoot, directory)
  assert.ok(inside && inside !== '..' && !inside.startsWith(`..${sep}`))
  await rm(directory, { recursive: true, force: true })
}
