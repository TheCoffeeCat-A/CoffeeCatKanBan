import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Script } from 'node:vm'

const project = fileURLToPath(new URL('../', import.meta.url))
const workspace = resolve(project, '..')
const vault = resolve(workspace, '开发知识库')
const manifest = JSON.parse(await readFile(resolve(project, 'manifest.json'), 'utf8'))
const packageJson = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(resolve(project, 'package-lock.json'), 'utf8'))
assert.equal(manifest.id, packageJson.name)
assert.equal(manifest.version, packageJson.version)
assert.equal(lock.version, packageJson.version)
assert.equal(lock.packages[''].version, packageJson.version)
assert.equal(manifest.isDesktopOnly, true)
assert.equal(manifest.author, 'TheCoffeeCat')
assert.equal(packageJson.dependencies.react, undefined)
assert.equal(packageJson.dependencies.electron, undefined)
const bundle = await readFile(resolve(project, 'main.js'), 'utf8')
new Script(bundle, { filename: 'main.js' })
const imports = [...bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1])
assert.ok(imports.includes('obsidian'), 'The host API must remain external')
assert.ok(imports.every((name) => name === 'obsidian'), `Unexpected runtime imports: ${imports.join(', ')}`)
const temporaryEntries = await readdir(resolve(project, '.cache/tmp'))
assert.ok(temporaryEntries.every((name) => !/^(test-|file-test-)/.test(name)), 'Temporary test directories remain')

const notes = (await readdir(vault)).filter((name) => name.endsWith('.md'))
const files = [resolve(workspace, 'AGENTS.md'), resolve(workspace, 'README.md'), resolve(project, 'README.md'),
  ...notes.map((name) => resolve(vault, name))]
const decoder = new TextDecoder('utf-8', { fatal: true })
const documents = new Map()
let links = 0
for (const file of files) {
  const content = decoder.decode(await readFile(file))
  documents.set(file, content)
  assert.match(content, /^# /, `Missing title: ${file}`)
  assert.equal([...content.matchAll(/^```/gm)].length % 2, 0, `Unpaired code fence: ${file}`)
  const prose = content.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').replace(/`[^`\n]*`/g, '')
  for (const match of prose.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:|^#/.test(target)) continue
    const path = resolve(dirname(file), decodeURIComponent(target.split('#')[0]))
    assert.ok((await stat(path)).isFile(), `Missing link target: ${path}`)
    if (dirname(file) === vault) {
      const inside = relative(vault, path)
      assert.ok(inside !== '..' && !inside.startsWith(`..${sep}`), `Link leaves vault: ${target}`)
    }
    links += 1
  }
}
const index = documents.get(resolve(vault, 'README.md'))
for (const name of notes.filter((name) => name !== 'README.md')) assert.ok(index.includes(`](${name})`), `Not indexed: ${name}`)
const require = createRequire(import.meta.url)
const { parseDocument } = require('yaml')
const contract = documents.get(resolve(vault, '数据与文件安全.md'))
for (const match of contract.matchAll(/^```yaml\r?\n([\s\S]*?)^```/gm)) {
  const source = match[1].replace(/^---\r?\n/, '').replace(/---\r?\n?$/, '')
  const document = parseDocument(source, { strict: true, uniqueKeys: true })
  assert.equal(document.errors.length, 0, 'Invalid YAML example in knowledge base')
}
console.log(`PASS: manifest, host-only runtime imports, clean test outputs, ${files.length} documents and ${links} local links`)