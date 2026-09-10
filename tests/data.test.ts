import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { applyChange, prepareChange, reverseChange, type TaskPatch } from '../src/domain/changes'
import { createNote, parseNote, propertiesOf } from '../src/domain/markdown'
import { isIsoDate, readBoard, readTask, validateFolder, type Properties } from '../src/domain/model'

const boardId = '8db7d248-02c7-4f1e-9e21-5a7e945d9f01'
const taskId = 'bccfc80c-46f1-41f3-bbd5-1a643b9ad254'
const board = readBoard({
  kanban_kind: 'board', kanban_schema: 1, kanban_id: boardId,
  kanban_columns: ['todo', 'doing', 'done'], kanban_default_column: 'todo', kanban_done_column: 'done',
  kanban_column_todo_title: 'To do', kanban_column_doing_title: 'Doing', kanban_column_done_title: 'Done',
  kanban_new_task_folder: 'Tasks',
}, 'Board.md')
const properties: Properties = {
  kanban_kind: 'task', kanban_schema: 1, kanban_id: taskId, kanban_board: boardId,
  kanban_column: 'todo', kanban_order: 'a0', kanban_title: 'Task',
  other_plugin: { nested: ['retain', 2] },
}
const body = '# Notes\r\n\r\n- [ ] Keep this\r\n[[Another note]]\r\n![file](asset.png)\r\n'

test('field updates retain BOM, CRLF body and unrelated structured properties', () => {
  const source = '\uFEFF' + createNote(properties).replace(/\n/g, '\r\n') + body
  const change = prepareChange(source, { kanban_column: 'doing' })
  const result = applyChange(source, change, board)
  assert.equal(parseNote(result)!.body, body)
  assert.ok(result.startsWith('\uFEFF---\r\n'))
  assert.deepEqual(propertiesOf(result).other_plugin, properties.other_plugin)
  assert.equal(propertiesOf(result).kanban_column, 'doing')
  assert.equal(propertiesOf(source).kanban_column, 'todo')
})

test('stale property changes fail, unrelated changes survive both commit and undo', () => {
  const initial = createNote(properties, 'Original')
  const change = prepareChange(initial, { kanban_priority: true })
  const external = createNote({ ...properties, custom: 'new' }, 'Externally edited')
  const committed = applyChange(external, change, board)
  const restored = applyChange(committed, reverseChange(change), board)
  assert.equal(Object.hasOwn(propertiesOf(restored), 'kanban_priority'), false)
  assert.equal(propertiesOf(restored).custom, 'new')
  assert.equal(parseNote(restored)!.body, 'Externally edited')
  assert.throws(() => applyChange(committed, change, board), /changed elsewhere/)
  const conflicting = applyChange(committed, prepareChange(committed, { kanban_priority: false }), board)
  assert.throws(() => applyChange(conflicting, reverseChange(change), board), /changed elsewhere/)
})

test('YAML parser rejects duplicate keys, invalid structures and unclosed frontmatter', () => {
  const source = createNote(properties)
  assert.throws(() => propertiesOf(source.replace('kanban_schema: 1', 'kanban_schema: 1\nkanban_schema: 2')), /unique keys/)
  assert.throws(() => propertiesOf('---\n- task\n---\n'), /mapping/)
  assert.throws(() => propertiesOf('---\nkanban_kind: task\n'), /not closed/)
  assert.equal(parseNote('# Regular note\n---\nBody'), null)
})

test('invalid field updates and identity replacement cannot partially mutate a note', () => {
  const source = createNote(properties, body)
  for (const patch of [
    { kanban_column: 'missing' }, { kanban_due: '2025-02-29' }, { kanban_priority: 'yes' },
    { kanban_column: undefined }, { kanban_order: 'bad-key' },
  ] satisfies TaskPatch[]) {
    assert.throws(() => applyChange(source, prepareChange(source, patch), board))
    assert.equal(parseNote(source)!.body, body)
  }
  assert.throws(() => prepareChange(source, { kanban_id: boardId } as TaskPatch), /not editable/)
  const replacement = createNote({ ...properties, kanban_id: boardId })
  assert.throws(() => applyChange(replacement, prepareChange(source, { kanban_priority: true }), board), /identity/)
})

test('model validates calendar dates, visible folders and future schema', () => {
  assert.equal(isIsoDate('2024-02-29'), true)
  assert.equal(isIsoDate('2025-02-29'), false)
  assert.equal(isIsoDate('2026-13-01'), false)
  assert.equal(isIsoDate('2026-01-01T00:00:00Z'), false)
  assert.equal(validateFolder('Tasks/Project one'), 'Tasks/Project one')
  for (const folder of ['../Tasks', '/Tasks', '.obsidian', 'C:\\Tasks', 'Tasks//Other', 'Tasks/NUL', 'Tasks/../Other']) {
    assert.throws(() => validateFolder(folder))
  }
  assert.throws(() => readTask({ ...properties, kanban_schema: 2 }, 'Task.md'))
})

test('no-op updates preserve the entire note byte for byte', () => {
  const source = createNote(properties, body)
  assert.equal(applyChange(source, prepareChange(source, { kanban_column: 'todo' }), board), source)
})

test('YAML aliases cannot change unrelated properties through an anchor update', () => {
  const source = createNote(properties, body).replace('kanban_column: todo', 'kanban_column: &shared todo\nother_status: *shared')
  const change = prepareChange(source, { kanban_column: 'doing' })
  assert.throws(() => applyChange(source, change, board), /Resolve YAML aliases/)
  assert.equal(propertiesOf(source).other_status, 'todo')
})

test('real Markdown file retains UTF-8 body bytes after a property commit', async () => {
  const temporaryRoot = resolve('.cache/tmp')
  await mkdir(temporaryRoot, { recursive: true })
  const directory = await mkdtemp(join(temporaryRoot, 'file-test-'))
  const path = join(directory, 'Task.md')
  const originalBody = body + '\u4e2d\u6587\r\n'
  const source = '\uFEFF' + createNote(properties).replace(/\n/g, '\r\n') + originalBody
  try {
    await writeFile(path, source, 'utf8')
    const change = prepareChange(await readFile(path, 'utf8'), { kanban_due: '2026-09-18' })
    const current = await readFile(path, 'utf8')
    await writeFile(path, applyChange(current, change, board), 'utf8')
    const stored = await readFile(path)
    assert.deepEqual(stored.subarray(stored.length - Buffer.byteLength(originalBody)), Buffer.from(originalBody))
    assert.equal(propertiesOf(stored.toString('utf8')).kanban_due, '2026-09-18')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})