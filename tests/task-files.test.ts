import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNote, parseNote, propertiesOf } from '../src/domain/markdown'
import { readBoard, readTask } from '../src/domain/model'
import { copiedTaskNote } from '../src/domain/task-files'

const boardId = '8db7d248-02c7-4f1e-9e21-5a7e945d9f01'
const taskId = 'bccfc80c-46f1-41f3-bbd5-1a643b9ad254'
const copyId = '00000000-0000-4000-8000-000000000001'
const board = readBoard({ kanban_kind: 'board', kanban_schema: 1, kanban_id: boardId,
  kanban_columns: ['todo', 'doing', 'done'], kanban_default_column: 'todo', kanban_done_column: 'done',
  kanban_column_todo_title: 'Todo', kanban_column_doing_title: 'Doing', kanban_column_done_title: 'Done',
  kanban_new_task_folder: 'Other',
}, 'Board.md')
const fields = { kanban_kind: 'task', kanban_schema: 1, kanban_id: taskId, kanban_board: boardId,
  kanban_title: 'Source', kanban_column: 'done', kanban_previous_column: 'doing', kanban_order: 'a0',
  kanban_due: '2026-09-20', kanban_priority: true, kanban_archived: true,
  kanban_assignees: ['Owner'], tags: ['project/test'], aliases: ['Do not copy'],
  other_plugin_id: 'foreign-identity', custom: { keepOnlyInSource: true },
}

test('copy creates a new identity and order with supported fields and exact body only', () => {
  const body = '# Body\r\n\r\n[[Linked note]] ![[image.png]] [Relative](../Other.md)\r\n'
  const source = createNote(fields, body)
  const original = readTask(fields, 'Tasks/Source.md')
  const copied = copiedTaskNote(source, original.path, copyId, 'Tasks/Source (2).md', board, [original])
  const properties = propertiesOf(copied)
  const task = readTask(properties, 'Tasks/Source (2).md')
  assert.equal(task.id, copyId)
  assert.equal(task.boardId, original.boardId)
  assert.equal(task.column, 'done')
  assert.equal(task.previousColumn, 'doing')
  assert.ok(task.order! > original.order!)
  assert.equal(task.archived, false)
  assert.equal(task.priority, true)
  assert.equal(task.due, original.due)
  assert.deepEqual(task.tags, original.tags)
  assert.deepEqual(task.assignees, original.assignees)
  assert.equal(parseNote(copied)!.body, body)
  for (const key of ['aliases', 'other_plugin_id', 'custom']) assert.equal(Object.hasOwn(properties, key), false)
  assert.equal(source, createNote(fields, body))
})

test('copy uses the original filename fallback and rejects invalid schema or column', () => {
  const { kanban_title: _title, ...withoutTitle } = fields
  const source = createNote(withoutTitle)
  assert.equal(propertiesOf(copiedTaskNote(source, 'Tasks/Original.md', copyId, 'Tasks/Copy.md', board, [])).kanban_title, 'Original')
  assert.throws(() => copiedTaskNote(createNote({ ...fields, kanban_schema: 2 }), 'Source.md', copyId, 'Copy.md', board, []))
  assert.throws(() => copiedTaskNote(createNote({ ...fields, kanban_column: 'missing' }), 'Source.md', copyId, 'Copy.md', board, []))
  assert.throws(() => copiedTaskNote('---\nkanban_id: one\nkanban_id: two\n---\n', 'Source.md', copyId, 'Copy.md', board, []))
})