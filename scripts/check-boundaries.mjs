import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, relative, sep } from 'node:path'
import { checkModuleBoundaries } from './module-boundaries.mjs'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const sources = new Map()

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (/\.tsx?$/.test(entry.name)) sources.set(relative(sourceRoot, path).split(sep).join('/'), await readFile(path, 'utf8'))
  }
}

await collect(sourceRoot)
if (!sources.size) throw new Error('No source modules found')
const errors = checkModuleBoundaries(sources)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`PASS: ${sources.size} modules respect dependency boundaries; no import cycles`)
}