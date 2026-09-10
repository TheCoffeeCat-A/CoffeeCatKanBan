import assert from 'node:assert/strict'
import { test } from 'node:test'
import { performance } from 'node:perf_hooks'
import { TaskRepository } from '../src/storage/repository'
import type { NoteStore } from '../src/contracts'

test('large catalogue baseline retains warm snapshots and reads only the changed file', async (context) => {
  const files = new Map<string, string>()
  const boardIds = Array.from({ length: 100 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`)
  for (const [index, id] of boardIds.entries()) {
    files.set(`Board-${index}.md`, `---\nkanban_kind: board\nkanban_schema: 1\nkanban_id: ${id}\nkanban_columns: [todo, done]\nkanban_column_todo_title: Todo\nkanban_column_done_title: Done\nkanban_default_column: todo\nkanban_done_column: done\nkanban_new_task_folder: Tasks\n---\n`)
  }
  for (let index = 0; index < 5000; index += 1) {
    const id = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    files.set(`Task-${index}.md`, `---\nkanban_kind: task\nkanban_schema: 1\nkanban_id: ${id}\nkanban_board: ${boardIds[index % boardIds.length]}\nkanban_column: todo\nkanban_order: a0\n---\nBody ${index}\n`)
  }
  let reads = 0
  const store: NoteStore = {
    listPaths: () => [...files.keys()],
    read: async (path) => { reads += 1; const content = files.get(path); if (content === undefined) throw new Error('Missing file'); return content },
    process: async () => { throw new Error('Unexpected write') },
    create: async () => { throw new Error('Unexpected create') },
    trash: async () => { throw new Error('Unexpected trash') },
  }
  const repository = new TaskRepository(store, true)
  const start = performance.now()
  const first = await repository.scan()
  const cold = performance.now() - start
  assert.equal(first.boards.length, 100)
  assert.equal(first.tasks.length, 5000)
  assert.equal(first.diagnostics.length, 0)
  assert.equal(reads, 5100)
  const warmStart = performance.now()
  for (let iteration = 0; iteration < 20; iteration += 1) assert.equal(await repository.scan(), first)
  const warm = (performance.now() - warmStart) / 20
  assert.equal(reads, 5100)
  files.set('Task-2500.md', files.get('Task-2500.md')! + 'Updated')
  repository.invalidate('Task-2500.md')
  const updateStart = performance.now()
  const updated = await repository.scan()
  const update = performance.now() - updateStart
  assert.equal(reads, 5101)
  assert.equal(updated.tasks.length, 5000)
  assert.equal(updated.diagnostics.length, 0)
  assert.ok(updated.tasks.find((task) => task.path === 'Task-2500.md')!.searchText!.includes('Updated'))
  assert.equal(await repository.scan(), updated)
  context.diagnostic(`In-memory 5100 notes: cold=${cold.toFixed(2)}ms, warm mean=${warm.toFixed(2)}ms, single update=${update.toFixed(2)}ms`)
  repository.dispose()
})