import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { App } from 'obsidian'
import type { NoteStore } from '../src/contracts'

class FileStub {
  readonly extension = 'md'
  constructor(public path: string) {}
}

class MarkdownViewStub {
  constructor(readonly file: FileStub, readonly editor: { getValue: () => string }) {}
}

const compiled = buildSync({
  entryPoints: [resolve('src/storage/obsidian-store.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
}).outputFiles[0]!.text
const moduleResult = { exports: {} as { ObsidianNoteStore: new (app: App) => NoteStore } }
const nativeRequire = createRequire(resolve('package.json'))
new Function('module', 'exports', 'require', compiled)(moduleResult, moduleResult.exports,
  (name: string) => name === 'obsidian'
    ? { TFile: FileStub, TFolder: class {}, MarkdownView: MarkdownViewStub }
    : nativeRequire(name))

// Build a host substitute that records only explicit trash and create calls
// type: () => host fixture
function fixture() {
  const file = new FileStub('Task.md')
  const files = new Map([['Task.md', file]])
  const contents = new Map([['Task.md', '# Saved body\n']])
  const leaves: { view: MarkdownViewStub }[] = []
  const trashed: FileStub[] = []
  const created: string[] = []
  const host = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      getMarkdownFiles: () => [...files.values()],
      read: async (target: FileStub) => {
        const content = contents.get(target.path)
        if (content === undefined) throw new Error('Missing file')
        return content
      },
      create: async (path: string, content: string) => {
        created.push(path)
        files.set(path, new FileStub(path))
        contents.set(path, content)
      },
    },
    workspace: { getLeavesOfType: () => leaves },
    fileManager: { trashFile: async (target: FileStub) => { trashed.push(target); files.delete(target.path) } },
  }
  const store = new moduleResult.exports.ObsidianNoteStore(host as unknown as App)
  return { host, store, file, files, contents, leaves, trashed, created }
}

test('host deletion delegates only the reviewed Markdown file to preferred trash', async () => {
  const current = fixture()
  current.files.set('Other.md', new FileStub('Other.md'))
  let guards = 0
  await current.store.trash('Task.md', '# Saved body\n', () => { guards += 1 })
  assert.deepEqual(current.trashed, [current.file])
  assert.equal(current.files.has('Other.md'), true)
  assert.equal(current.created.length, 0)
  assert.ok(guards >= 2)
})

test('copy and trash reject unsaved native editors without host mutations', async () => {
  for (const operation of ['copy', 'trash']) {
    const current = fixture()
    current.leaves.push({ view: new MarkdownViewStub(current.file, { getValue: () => '# Unsaved new body\n' }) })
    const result = operation === 'copy'
      ? current.store.create('Copy.md', '# Copy', () => undefined, { path: 'Task.md', content: '# Saved body\n' })
      : current.store.trash('Task.md', '# Saved body\n', () => undefined)
    await assert.rejects(result, /Save the native editor/)
    assert.equal(current.trashed.length, 0)
    assert.equal(current.created.length, 0)
    assert.equal(current.files.get('Task.md'), current.file)
  }
})

test('copy permits a saved native editor and does not create or trash attachments', async () => {
  const current = fixture()
  current.leaves.push({ view: new MarkdownViewStub(current.file, { getValue: () => '# Saved body\n' }) })
  await current.store.create('Copy.md', '# Saved body\n', () => undefined, { path: 'Task.md', content: '# Saved body\n' })
  assert.deepEqual(current.created, ['Copy.md'])
  assert.equal(current.trashed.length, 0)
  assert.equal(current.contents.get('Task.md'), '# Saved body\n')
})

test('final host checks reject changed content, replaced file objects and disposal', async () => {
  for (const change of ['content', 'replacement', 'disposed']) {
    for (const operation of ['copy', 'trash']) {
      const current = fixture()
      let active = true
      current.host.vault.read = async () => {
        if (change === 'replacement') current.files.set('Task.md', new FileStub('Task.md'))
        if (change === 'disposed') active = false
        return change === 'content' ? '# Changed\n' : '# Saved body\n'
      }
      const guard = () => { if (!active) throw new Error('Inactive') }
      await assert.rejects(operation === 'copy'
        ? current.store.create('Copy.md', '# Copy', guard, { path: 'Task.md', content: '# Saved body\n' })
        : current.store.trash('Task.md', '# Saved body\n', guard))
      assert.equal(current.trashed.length, 0)
      assert.equal(current.created.length, 0)
    }
  }
})

test('trash rejects unsafe paths and reports host failure without falling back to deletion', async () => {
  const current = fixture()
  await assert.rejects(current.store.trash('../Task.md', '# Saved body\n', () => undefined))
  await assert.rejects(current.store.trash('image.png', '# Saved body\n', () => undefined))
  current.host.fileManager.trashFile = async () => { throw new Error('Recycle service unavailable') }
  await assert.rejects(current.store.trash('Task.md', '# Saved body\n', () => undefined), /Recycle service unavailable/)
  assert.equal(current.files.get('Task.md'), current.file)
  assert.equal(current.trashed.length, 0)
})