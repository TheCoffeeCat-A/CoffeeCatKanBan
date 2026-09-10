import assert from 'node:assert/strict'
import { test } from 'node:test'
import { convertNote } from '../src/domain/conversion'
import { newBoardNote } from '../src/domain/creation'
import { parseNote, propertiesOf } from '../src/domain/markdown'
import { readBoard } from '../src/domain/model'

const boardId = '8db7d248-02c7-4f1e-9e21-5a7e945d9f01'
const taskId = 'bccfc80c-46f1-41f3-bbd5-1a643b9ad254'
const board = readBoard(propertiesOf(newBoardNote({ title: 'Board', folder: '', taskFolder: 'Tasks' }, boardId, 'Board.md')), 'Board.md')
const input = { boardId, title: 'Existing', columnId: 'todo' }

test('conversion preserves body, BOM, CRLF and unrelated properties without moving notes', () => {
  for (const content of ['\uFEFFBody\r\n[[Other]]\r\n', '\uFEFF---\r\ntags: [work]\r\naliases: [Other]\r\ncustom: {nested: 42}\r\n---\r\nBody\r\n']) {
    const result = convertNote(content, 'Existing.md', input, taskId, board, [])
    assert.equal(parseNote(result)!.body, parseNote(content)?.body ?? content.slice(1))
    assert.ok(result.startsWith('\uFEFF---\r\n'))
    const properties = propertiesOf(result)
    assert.equal(properties.kanban_id, taskId)
    assert.equal(properties.kanban_board, boardId)
    if (parseNote(content)) {
      for (const [key, value] of Object.entries(propertiesOf(content))) assert.deepEqual(properties[key], value)
    }
  }
})

test('conversion rejects plugin fields, malformed YAML, aliases and invalid destinations', () => {
  for (const content of ['---\nkanban_kind: task\n---\nBody', '---\nkanban_custom: x\n---\n', '---\nkey: 1\nkey: 2\n---\n', '---\none: &value [a]\ntwo: *value\n---\n']) {
    assert.throws(() => convertNote(content, 'Existing.md', input, taskId, board, []))
  }
  assert.throws(() => convertNote('Body', 'Existing.md', { ...input, columnId: 'missing' }, taskId, board, []))
})