import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultQuery, localDay, queryTasks, readQuery, tagValues, textValues } from '../src/domain/query'
import type { Task } from '../src/domain/model'

const first: Task = Object.freeze({
  id: 'one', boardId: 'board', path: 'One.md', title: 'Release plan', column: 'todo', order: 'a0',
  priority: true, archived: false, due: '2026-09-09', tags: ['release'], assignees: ['Alice'], searchText: 'Review the design',
})
const second: Task = Object.freeze({ ...first, id: 'two', title: 'Build', priority: false, order: 'a1', due: '2026-09-08', column: 'doing', tags: ['build'] })
const tasks = Object.freeze([first, second, Object.freeze({ ...first, id: 'archived', archived: true }), Object.freeze({ ...first, id: 'other', boardId: 'other' })])

test('query scopes to one board and combines text, property and archive filters', () => {
  const query = { ...defaultQuery(), text: 'ALICE design', tag: 'release', priorityOnly: true, column: 'todo' }
  assert.deepEqual(queryTasks(tasks, 'board', query, false).map((task) => task.id), ['one'])
  assert.equal(queryTasks(tasks, 'board', query, true).length, 2)
  assert.equal(queryTasks(tasks, 'board', { ...query, column: 'doing' }, false).length, 0)
})

test('due filters use local calendar days and overdue excludes completed tasks', () => {
  const done = { ...second, id: 'done', column: 'done' }
  const undated = { ...first, id: 'undated' }
  const { due: _due, ...withoutDate } = undated
  const source = [first, second, done, withoutDate]
  assert.deepEqual(queryTasks(source, 'board', { ...defaultQuery(), due: 'today' }, false, '2026-09-09', 'done').map((task) => task.id), ['one'])
  assert.deepEqual(queryTasks(source, 'board', { ...defaultQuery(), due: 'overdue' }, false, '2026-09-09', 'done').map((task) => task.id), ['two'])
  assert.deepEqual(queryTasks(source, 'board', { ...defaultQuery(), due: 'undated' }, false).map((task) => task.id), ['undated'])
  assert.equal(localDay(new Date(2026, 0, 1, 0, 1)), '2026-01-01')
})

test('view sorting never mutates source arrays or persisted order values', () => {
  const source = Object.freeze([first, second])
  assert.deepEqual(queryTasks(source, 'board', { ...defaultQuery(), sort: 'title' }, false).map((task) => task.id), ['two', 'one'])
  assert.deepEqual(queryTasks(source, 'board', { ...defaultQuery(), sort: 'due' }, false).map((task) => task.id), ['two', 'one'])
  assert.deepEqual(queryTasks(source, 'board', defaultQuery(), false).map((task) => task.id), ['one', 'two'])
  assert.deepEqual(source.map((task) => task.order), ['a0', 'a1'])
})

test('stored query states validate allowed modes without carrying unknown values', () => {
  assert.deepEqual(readQuery(null), defaultQuery())
  assert.deepEqual(readQuery({ text: 123, column: {}, due: 'arbitrary', sort: 'random' }), defaultQuery())
  assert.equal(readQuery({ sort: 'due', text: 'Task' }).sort, 'due')
  assert.equal(readQuery({ sort: 'title' }).direction, 'asc')
  assert.equal(readQuery({ sort: 'column', direction: 'desc' }).direction, 'desc')
})

test('sort directions retain stable ties, missing dates last and board column order', () => {
  const undated = { ...first, id: 'undated', due: undefined, order: 'a2' }
  const source = [first, second, undated] as readonly Task[]
  const columns = [{ id: 'todo', title: 'Z' }, { id: 'doing', title: 'A' }]
  const ids = (sort: 'title' | 'column' | 'due' | 'priority', direction: 'asc' | 'desc') =>
    queryTasks(source, 'board', { ...defaultQuery(), sort, direction }, false, undefined, undefined, columns).map((task) => task.id)
  assert.deepEqual(ids('title', 'desc'), ['one', 'undated', 'two'])
  assert.deepEqual(ids('due', 'asc'), ['two', 'one', 'undated'])
  assert.deepEqual(ids('due', 'desc'), ['one', 'two', 'undated'])
  assert.deepEqual(ids('column', 'asc'), ['one', 'undated', 'two'])
  assert.deepEqual(ids('column', 'desc'), ['two', 'one', 'undated'])
  assert.deepEqual(ids('priority', 'asc'), ['one', 'undated', 'two'])
  assert.deepEqual(ids('priority', 'desc'), ['two', 'one', 'undated'])
})

test('tag and assignee inputs split native separators and remove duplicates', () => {
  assert.deepEqual(textValues(' Alice, Bob\nAlice\uFF0CCarol '), ['Alice', 'Bob', 'Carol'])
  assert.deepEqual(tagValues('#project/demo,project/demo\u3001review'), ['project/demo', 'review'])
  assert.deepEqual(tagValues(''), [])
})