import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { Script } from 'node:vm'
import { runtimeLicenses } from './licenses.mjs'

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'))
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
assert.equal(manifest.id, pkg.name)
assert.equal(manifest.version, pkg.version)
assert.equal(lock.version, pkg.version)
assert.equal(lock.packages[''].version, pkg.version)
assert.equal(manifest.isDesktopOnly, true)
assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['fractional-indexing', 'yaml'])
const bundle = await readFile('main.js', 'utf8')
new Script(bundle)
const imports = [...bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1])
assert.ok(imports.length && imports.every((name) => name === 'obsidian'))
assert.ok(bundle.includes('Third-party notices') && bundle.includes('Copyright Eemeli Aro'))
const directory = resolve('.cache/releases', `${manifest.id}-${manifest.version}-${Date.now()}`)
await mkdir(directory, { recursive: true })
for (const name of ['main.js', 'manifest.json', 'styles.css', 'LICENSE']) await copyFile(name, join(directory, name))
await writeFile(join(directory, 'THIRD_PARTY_NOTICES.txt'), await runtimeLicenses())
await writeFile(join(directory, 'INSTALL.md'), `# CoffeeCatKanBan ${manifest.version}\n\n将 main.js、manifest.json、styles.css 放入库内 .obsidian/plugins/${manifest.id}/，在 Obsidian 中启用插件。\n\n仅桌面端。最低声明版本 ${manifest.minAppVersion}，最低版本兼容和完整宿主验收尚未通过。此目录是本地候选包，不表示已发布到社区目录。\n\n升级前备份旧版三个文件。回退时停用插件，恢复备份并重新启用；不要恢复整个笔记库。卸载只移除插件目录，看板和任务 Markdown 保留。\n`)
const files = (await readdir(directory)).sort()
assert.deepEqual(files, ['INSTALL.md', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'main.js', 'manifest.json', 'styles.css'])
const hashes = []
for (const name of files) hashes.push(`${createHash('sha256').update(await readFile(join(directory, name))).digest('hex')}  ${name}`)
await writeFile(join(directory, 'SHA256SUMS.txt'), hashes.join('\n') + '\n')
console.log(`Release candidate verified: ${directory}`)
