import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCatalogue, type NoteSource } from '../src/domain/catalogue'
import { prepareChange } from '../src/domain/changes'
import { createNote, propertiesOf } from '../src/domain/markdown'
import { readBoard, readTask } from '../src/domain/model'
import { completionPatch, movePatch } from '../src/domain/ordering'
import { TaskRepository, type NoteStore } from '../src/storage/repository'

const boardId = '8db7d248-02c7-4f1e-9e21-5a7e945d9f01'
const taskId = 'bccfc80c-46f1-41f3-bbd5-1a643b9ad254'
const boardContent = createNote({
  kanban_kind: 'board', kanban_schema: 1, kanban_id: boardId,
  kanban_columns: ['todo', 'doing', 'done'], kanban_default_column: 'todo', kanban_done_column: 'done',
  kanban_column_todo_title: 'Todo', kanban_column_doing_title: 'Doing', kanban_column_done_title: 'Done',
  kanban_new_task_folder: 'Tasks',
})
const taskContent = createNote({
  kanban_kind: 'task', kanban_schema: 1, kanban_id: taskId, kanban_board: boardId,
  kanban_column: 'todo', kanban_order: 'a0', kanban_title: 'Task',
}, '# Original body\n')

class MemoryStore implements NoteStore {
  readonly files = new Map([['Board.md', boardContent], ['Task.md', taskContent]])
  writes = 0
  fail = false
  readonly unreadable = new Set<string>()
  beforeProcess: (() => Promise<void>) | undefined
  beforeCreate: ((path: string, content: string) => Promise<void>) | undefined
  beforeTrash: (() => Promise<void>) | undefined
  readonly trashed = new Map<string, string>()

  listPaths(): readonly string[] { return [...this.files.keys()] }
  async read(path: string): Promise<string> {
    if (this.unreadable.has(path)) throw new Error('Note could not be read')
    const content = this.files.get(path)
    if (content === undefined) throw new Error('Missing file')
    return content
  }
  async process(path: string, update: (content: string) => string): Promise<string> {
    await this.beforeProcess?.()
    const result = update(await this.read(path))
    if (this.fail) throw new Error('Disk write failed')
    this.files.set(path, result)
    this.writes += 1
    return result
  }

  async create(path: string, content: string, assertActive: () => void, source?: NoteSource): Promise<void> {
    await this.beforeCreate?.(path, content)
    assertActive()
    if (source && await this.read(source.path) !== source.content) throw new Error('Source changed since review')
    assertActive()
    if (this.fail) throw new Error('Disk write failed')
    if ([...this.files.keys()].some((entry) => entry.toLowerCase() === path.toLowerCase())) throw new Error('Destination exists')
    this.files.set(path, content)
    this.writes += 1
  }

  // Model a guarded host trash operation without deleting real files
  // type: (string, string, () => void) => Promise<void>
  async trash(path: string, expectedContent: string, assertActive: () => void): Promise<void> {
    await this.beforeTrash?.()
    assertActive()
    const content = await this.read(path)
    assertActive()
    if (content !== expectedContent) throw new Error('Note changed since review')
    if (this.fail) throw new Error('Trash unavailable')
    this.trashed.set(path, content)
    this.files.delete(path)
    this.writes += 1
  }
}

test('task copies stay in the source folder with unique names, IDs and no new undo', async () => {
  const store = new MemoryStore()
  store.files.delete('Task.md')
  store.files.set('Nested/Task.md', taskContent)
  const repository = new TaskRepository(store)
  const draft = await repository.draft(taskId)
  const first = await repository.copyTask(draft)
  const second = await repository.copyTask(draft)
  assert.equal(first.path, 'Nested/Task (2).md')
  assert.equal(second.path, 'Nested/Task (3).md')
  assert.notEqual(first.id, second.id)
  assert.notEqual(first.id, taskId)
  assert.ok(second.order! > first.order!)
  assert.equal(store.files.get('Nested/Task.md'), taskContent)
  assert.equal(repository.hasUndo(boardId), false)
  assert.equal((await repository.scan()).tasks.length, 3)
})

test('file operations reject changed body, renamed source, changed board and duplicate identities', async () => {
  for (const kind of ['copy', 'delete'] as const) {
    for (const change of ['body', 'path', 'board', 'duplicate'] as const) {
      const store = new MemoryStore()
      const repository = new TaskRepository(store)
      const draft = await repository.draft(taskId)
      if (change === 'body') store.files.set('Task.md', taskContent + 'New text\n')
      if (change === 'path') { store.files.delete('Task.md'); store.files.set('Moved.md', taskContent) }
      if (change === 'board') store.files.set('Board.md', boardContent.replace('Todo', 'Changed'))
      if (change === 'duplicate') store.files.set('Duplicate.md', taskContent)
      const before = [...store.files]
      await assert.rejects(kind === 'copy' ? repository.copyTask(draft) : repository.deleteTask(draft))
      assert.deepEqual([...store.files], before)
      assert.equal(store.writes, 0)
    }
  }
})

test('copy refuses a final source change or competing destination and preserves existing undo', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  await repository.commit(prepareChange(taskContent, { kanban_priority: true }))
  let draft = await repository.draft(taskId)
  store.beforeCreate = async () => { store.files.set('Task.md', draft.content + 'External body\n') }
  await assert.rejects(repository.copyTask(draft), /changed/)
  assert.equal(repository.hasUndo(boardId), true)
  draft = await repository.draft(taskId)
  store.beforeCreate = async (path) => { store.files.set(path, '# Competing note\n') }
  await assert.rejects(repository.copyTask(draft), /Destination exists/)
  assert.equal(store.files.get('Task (2).md'), '# Competing note\n')
  assert.equal(store.trashed.size, 0)
})

test('trash removes only the confirmed note, clears its undo and never cascades', async () => {
  const store = new MemoryStore()
  store.files.set('Linked.md', '[[Task]] ![[image.png]]\n')
  const repository = new TaskRepository(store)
  await repository.commit(prepareChange(taskContent, { kanban_priority: true }))
  const draft = await repository.draft(taskId)
  await repository.deleteTask(draft)
  assert.equal(store.files.has('Task.md'), false)
  assert.equal(store.trashed.get('Task.md'), draft.content)
  assert.equal(store.files.get('Linked.md'), '[[Task]] ![[image.png]]\n')
  assert.equal(store.files.get('Board.md'), boardContent)
  assert.equal(repository.hasUndo(boardId), false)
  assert.equal((await repository.scan()).tasks.length, 0)
})

test('trash failure or final conflict preserves the note, undo and usable queue', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  await repository.commit(prepareChange(taskContent, { kanban_priority: true }))
  const draft = await repository.draft(taskId)
  store.fail = true
  await assert.rejects(repository.deleteTask(draft), /Trash unavailable/)
  assert.equal(store.files.get('Task.md'), draft.content)
  assert.equal(repository.hasUndo(boardId), true)
  store.fail = false
  store.beforeTrash = async () => { store.files.set('Task.md', draft.content + 'Fresh text\n') }
  await assert.rejects(repository.deleteTask(draft), /changed/)
  assert.equal(store.trashed.size, 0)
  store.beforeTrash = undefined
  await repository.deleteTask(await repository.draft(taskId))
  assert.equal(store.trashed.size, 1)
})

test('copy and trash refuse incomplete scans and disposal before host submission', async () => {
  for (const kind of ['copy', 'delete'] as const) {
    const store = new MemoryStore()
    const repository = new TaskRepository(store)
    const draft = await repository.draft(taskId)
    store.unreadable.add('Board.md')
    await assert.rejects(kind === 'copy' ? repository.copyTask(draft) : repository.deleteTask(draft), /could not be read/)
    store.unreadable.clear()
    store.beforeCreate = async () => repository.dispose()
    store.beforeTrash = async () => repository.dispose()
    await assert.rejects(kind === 'copy' ? repository.copyTask(draft) : repository.deleteTask(draft), /no longer active/)
    assert.equal(store.files.get('Task.md'), taskContent)
    assert.equal(store.writes, 0)
  }
})

test('catalogue ignores ordinary notes and blocks all duplicate identities', () => {
  const store = new MemoryStore()
  store.files.set('Ordinary.md', '# A normal note')
  const source = () => [...store.files].map(([path, content]) => ({ path, content }))
  assert.equal(buildCatalogue(source()).tasks.length, 1)
  store.files.set('Duplicate.md', taskContent)
  const catalogue = buildCatalogue(source())
  assert.equal(catalogue.tasks.length, 0)
  assert.equal(catalogue.diagnostics.filter((entry) => entry.message.startsWith('Duplicate')).length, 2)
})

test('a future-schema identity collision still blocks its otherwise valid counterpart', () => {
  const catalogue = buildCatalogue([
    { path: 'Board.md', content: boardContent }, { path: 'Task.md', content: taskContent },
    { path: 'Future.md', content: taskContent.replace('kanban_schema: 1', 'kanban_schema: 2') },
  ])
  assert.equal(catalogue.tasks.length, 0)
  assert.equal(catalogue.diagnostics.length, 2)
})

test('missing board and unknown columns remain visible as diagnostics', () => {
  assert.equal(buildCatalogue([{ path: 'Task.md', content: taskContent }]).diagnostics.length, 1)
  const result = buildCatalogue([
    { path: 'Board.md', content: boardContent },
    { path: 'Task.md', content: taskContent.replace('kanban_column: todo', 'kanban_column: unknown') },
  ])
  assert.equal(result.tasks.length, 0)
  assert.equal(result.diagnostics[0]!.path, 'Task.md')
})

test('failed persistence creates no undo entry and the queue remains usable', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const change = prepareChange(taskContent, { kanban_priority: true })
  store.fail = true
  await assert.rejects(repository.commit(change), /Disk write failed/)
  assert.equal(repository.hasUndo(boardId), false)
  assert.equal(store.files.get('Task.md'), taskContent)
  store.fail = false
  await repository.commit(change)
  assert.equal(repository.hasUndo(boardId), true)
  await repository.undo(boardId)
  assert.equal(Object.hasOwn(propertiesOf(store.files.get('Task.md')!), 'kanban_priority'), false)
})

test('two stale drafts serialize and the second cannot overwrite the first', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const first = prepareChange(taskContent, { kanban_title: 'First' })
  const second = prepareChange(taskContent, { kanban_title: 'Second' })
  const outcomes = await Promise.allSettled([repository.commit(first), repository.commit(second)])
  assert.equal(outcomes[0]!.status, 'fulfilled')
  assert.equal(outcomes[1]!.status, 'rejected')
  assert.equal(propertiesOf(store.files.get('Task.md')!).kanban_title, 'First')
  assert.equal(store.writes, 1)
})

test('the atomic callback catches edits made after the catalogue scan', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  store.beforeProcess = async () => {
    store.files.set('Task.md', taskContent.replace('kanban_column: todo', 'kanban_column: doing'))
  }
  await assert.rejects(repository.commit(prepareChange(taskContent, { kanban_column: 'done' })), /changed elsewhere/)
  assert.equal(store.writes, 0)
})

test('undo follows the stable ID after rename and keeps externally added body text', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  await repository.commit(prepareChange(taskContent, { kanban_archived: true }))
  store.files.set('Moved.md', store.files.get('Task.md')! + 'New body\n')
  store.files.delete('Task.md')
  await repository.undo(boardId)
  assert.equal(Object.hasOwn(propertiesOf(store.files.get('Moved.md')!), 'kanban_archived'), false)
  assert.ok(store.files.get('Moved.md')!.endsWith('New body\n'))
})

test('dispose refuses an in-flight callback and queued operations', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  let signalEntered!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => { signalEntered = resolve })
  const paused = new Promise<void>((resolve) => { release = resolve })
  store.beforeProcess = async () => { signalEntered(); await paused }
  const operation = repository.commit(prepareChange(taskContent, { kanban_priority: true }))
  const failure = assert.rejects(operation, /no longer active/)
  await entered
  repository.dispose()
  release()
  await failure
  await assert.rejects(repository.scan(), /no longer active/)
  assert.equal(store.writes, 0)
})

test('moving uses all neighbours, rejects duplicate keys and does not mutate hidden tasks', () => {
  const board = readBoard(propertiesOf(boardContent), 'Board.md')
  const first = readTask(propertiesOf(taskContent), 'Task.md')
  const hidden = { ...first, id: '00000000-0000-4000-8000-000000000001', order: 'a1' }
  const last = { ...first, id: '00000000-0000-4000-8000-000000000002', order: 'a2' }
  const patch = movePatch([first, hidden, last], first, board, 'todo', last.id)
  assert.ok(typeof patch.kanban_order === 'string' && patch.kanban_order > hidden.order && patch.kanban_order < last.order)
  assert.equal(hidden.order, 'a1')
  assert.throws(() => movePatch([first, hidden, { ...last, order: 'a1' }], first, board, 'todo', last.id), /repair/)
  assert.throws(() => movePatch([first], first, board, 'todo', 'missing'), /no longer exists/)
})

test('completion records the previous column and never guesses a missing restore target', () => {
  const board = readBoard(propertiesOf(boardContent), 'Board.md')
  const task = readTask(propertiesOf(taskContent), 'Task.md')
  assert.equal(completionPatch(task, board).kanban_previous_column, 'todo')
  assert.equal(completionPatch({ ...task, column: 'done', previousColumn: 'doing' }, board).kanban_column, 'doing')
  assert.throws(() => completionPatch({ ...task, column: 'done' }, board), /Choose a valid column/)
})

test('new boards use unique identities and never overwrite matching note names', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const first = await repository.createBoard({ title: 'Board', folder: '', taskFolder: 'Tasks/Project' })
  const second = await repository.createBoard({ title: 'board', folder: '', taskFolder: 'Tasks/Project' })
  assert.equal(first.path, 'Board (2).md')
  assert.equal(second.path, 'board (3).md')
  assert.notEqual(first.id, second.id)
  assert.equal(first.columns.length, 3)
  assert.equal(store.files.get('Board.md'), boardContent)
  assert.equal((await repository.scan()).boards.length, 3)
})

test('task creation persists native schema in the selected board folder and column', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const first = await repository.createTask({ boardId, title: 'Plan: [release]', columnId: 'doing', due: '2026-09-20' })
  const second = await repository.createTask({ boardId, title: 'Plan: [release]', columnId: 'doing' })
  assert.equal(first.path, 'Tasks/Plan- -release-.md')
  assert.equal(second.path, 'Tasks/Plan- -release- (2).md')
  assert.equal(first.column, 'doing')
  assert.equal(first.due, '2026-09-20')
  assert.ok(second.order! > first.order!)
  assert.equal(repository.hasUndo(boardId), false)
  assert.equal((await repository.scan()).tasks.length, 3)
})

test('invalid creation requests and disk failures leave existing notes untouched', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  for (const input of [
    { title: '', folder: '', taskFolder: 'Tasks' },
    { title: 'Board', folder: '../outside', taskFolder: 'Tasks' },
    { title: 'Board', folder: '', taskFolder: '.obsidian' },
  ]) await assert.rejects(repository.createBoard(input))
  await assert.rejects(repository.createTask({ boardId, title: 'Task', columnId: 'missing' }))
  await assert.rejects(repository.createTask({ boardId, title: 'Task', due: '2025-02-29' }))
  store.fail = true
  await assert.rejects(repository.createTask({ boardId, title: 'Task' }), /Disk write failed/)
  assert.equal(store.files.size, 2)
  assert.equal(store.writes, 0)
  assert.equal(store.files.get('Task.md'), taskContent)
})

test('creation is blocked for conflicting board identities or a disposed repository', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  store.files.set('Duplicate.md', boardContent)
  await assert.rejects(repository.createTask({ boardId, title: 'Task' }), /conflicting/)
  repository.dispose()
  await assert.rejects(repository.createBoard({ title: 'Board', folder: '', taskFolder: 'Tasks' }), /no longer active/)
  assert.equal(store.writes, 0)
})

test('column add, rename and reorder persist in the board without editing tasks or body', async () => {
  const store = new MemoryStore()
  store.files.set('Board.md', boardContent + '# Keep the board body\n')
  const repository = new TaskRepository(store)
  let board = (await repository.scan()).boards[0]!
  board = await repository.editColumns(board, { kind: 'add', id: 'review', title: 'Review' })
  board = await repository.editColumns(board, { kind: 'rename', id: 'review', title: 'In review' })
  board = await repository.editColumns(board, { kind: 'move', id: 'review', direction: -1 })
  assert.deepEqual(board.columns.map((column) => column.id), ['todo', 'doing', 'review', 'done'])
  assert.equal(board.columns[2]!.title, 'In review')
  assert.equal(store.files.get('Task.md'), taskContent)
  assert.ok(store.files.get('Board.md')!.endsWith('# Keep the board body\n'))
  board = await repository.editColumns(board, { kind: 'remove', id: 'review' })
  assert.equal(board.columns.length, 3)
  assert.equal(Object.hasOwn(propertiesOf(store.files.get('Board.md')!), 'kanban_column_review_title'), false)
})

test('column edits reject stale settings but preserve unrelated board properties', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const board = (await repository.scan()).boards[0]!
  store.files.set('Board.md', createNote({ ...propertiesOf(boardContent), custom: 'keep' }))
  await repository.editColumns(board, { kind: 'rename', id: 'doing', title: 'Active' })
  assert.equal(propertiesOf(store.files.get('Board.md')!).custom, 'keep')
  await assert.rejects(repository.editColumns(board, { kind: 'remove', id: 'doing' }), /changed elsewhere/)
})

test('nonempty column deletion includes archived and invalid-schema task references', async () => {
  for (const extra of [{ kanban_archived: true }, { kanban_schema: 2 }]) {
    const store = new MemoryStore()
    store.files.set('Task.md', createNote({ ...propertiesOf(taskContent), kanban_column: 'doing', ...extra }))
    const repository = new TaskRepository(store)
    const board = (await repository.scan()).boards[0]!
    await assert.rejects(repository.editColumns(board, { kind: 'remove', id: 'doing' }), /including archived/)
    assert.equal(store.writes, 0)
  }
})

test('column roles validate occupancy and preserve default/completed distinction', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  let board = (await repository.scan()).boards[0]!
  await assert.rejects(repository.editColumns(board, { kind: 'remove', id: 'todo' }), /cannot be deleted/)
  await assert.rejects(repository.editColumns(board, { kind: 'default', id: 'done' }), /cannot be the default/)
  board = await repository.editColumns(board, { kind: 'default', id: 'doing' })
  await assert.rejects(repository.editColumns(board, { kind: 'done', id: 'todo' }), /must be empty/)
  board = await repository.editColumns(board, { kind: 'add', id: 'finished', title: 'Finished' })
  board = await repository.editColumns(board, { kind: 'done', id: 'finished' })
  assert.equal(board.doneColumn, 'finished')
  assert.equal(board.defaultColumn, 'doing')
})

test('column persistence errors retain the previous definition and malformed references block removal', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const board = (await repository.scan()).boards[0]!
  store.fail = true
  await assert.rejects(repository.editColumns(board, { kind: 'rename', id: 'doing', title: 'Active' }), /Disk write failed/)
  assert.equal(store.files.get('Board.md'), boardContent)
  store.fail = false
  store.files.set('Broken.md', '---\nkanban_kind: task\nkanban_id: broken\nkanban_id: duplicate\n---\n')
  await assert.rejects(repository.editColumns(board, { kind: 'remove', id: 'doing' }), /Repair invalid task notes/)
})

test('creation recovers an exact durable result after an interrupted acknowledgement', async () => {
  const store = new MemoryStore()
  store.beforeCreate = async (path, content) => {
    store.files.set(path, content)
    throw new Error('Acknowledgement interrupted')
  }
  const repository = new TaskRepository(store)
  const task = await repository.createTask({ boardId, title: 'New task' })
  assert.equal(propertiesOf(store.files.get(task.path)!).kanban_id, task.id)
  assert.equal((await repository.scan()).tasks.length, 2)
  assert.equal(repository.hasUndo(boardId), false)
})

test('a conflicting file created during a race is never overwritten or claimed', async () => {
  const store = new MemoryStore()
  store.beforeCreate = async (path) => { store.files.set(path, '# External content\n') }
  const repository = new TaskRepository(store)
  await assert.rejects(repository.createTask({ boardId, title: 'New task' }), /Destination exists/)
  assert.equal(store.files.get('Tasks/New task.md'), '# External content\n')
  assert.equal((await repository.scan()).tasks.length, 1)
})

test('queued creation stops before writing when the repository is disposed', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  store.beforeCreate = async () => { repository.dispose() }
  await assert.rejects(repository.createTask({ boardId, title: 'New task' }), /no longer active/)
  assert.equal(store.files.size, 2)
})

test('an unreadable note does not hide healthy boards and tasks during display scans', async () => {
  const store = new MemoryStore()
  store.files.set('Unreadable.md', '# Other note')
  store.unreadable.add('Unreadable.md')
  const repository = new TaskRepository(store)
  const catalogue = await repository.scan()
  assert.equal(catalogue.boards.length, 1)
  assert.equal(catalogue.tasks.length, 1)
  assert.equal(catalogue.diagnostics.length, 1)
  assert.equal(catalogue.diagnostics[0]!.path, 'Unreadable.md')
  assert.match(catalogue.diagnostics[0]!.message, /read/i)
  assert.equal(store.writes, 0)
})

test('read failures never bypass mutation checks and recovery restores writes', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const initial = (await repository.scan()).boards[0]!
  await repository.commit(prepareChange(taskContent, { kanban_priority: true }))
  store.files.set('Unreadable.md', taskContent)
  store.unreadable.add('Unreadable.md')
  await assert.rejects(repository.createBoard({ title: 'New', folder: '', taskFolder: 'Tasks' }), /could not be read/i)
  await assert.rejects(repository.createTask({ boardId, title: 'New' }), /could not be read/i)
  await assert.rejects(repository.editColumns(initial, { kind: 'remove', id: 'doing' }), /could not be read/i)
  await assert.rejects(repository.commit(prepareChange(taskContent, { kanban_title: 'Changed' })), /could not be read/i)
  await assert.rejects(repository.undo(boardId), /could not be read/i)
  assert.equal(store.writes, 1)
  assert.equal(repository.hasUndo(boardId), true)
  store.unreadable.clear()
  store.files.delete('Unreadable.md')
  await repository.undo(boardId)
  assert.equal(Object.hasOwn(propertiesOf(store.files.get('Task.md')!), 'kanban_priority'), false)
  assert.equal((await repository.scan()).diagnostics.length, 0)
})

test('display scan does not retain stale tasks when a previously readable note fails', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  assert.equal((await repository.scan()).tasks.length, 1)
  store.unreadable.add('Task.md')
  const catalogue = await repository.scan()
  assert.equal(catalogue.boards.length, 1)
  assert.equal(catalogue.tasks.length, 0)
  assert.equal(catalogue.diagnostics[0]!.path, 'Task.md')
  store.unreadable.clear()
  assert.equal((await repository.scan()).tasks.length, 1)
})

test('task actions complete and restore a task with valid order keys and support undo', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  let task = (await repository.draft(taskId)).task
  await repository.actOnTask(task, { kind: 'complete', completed: true })
  task = (await repository.draft(taskId)).task
  assert.equal(task.column, 'done')
  assert.equal(task.previousColumn, 'todo')
  assert.ok(task.order)
  await repository.actOnTask(task, { kind: 'complete', completed: false })
  assert.equal((await repository.draft(taskId)).task.column, 'todo')
  await repository.undo(boardId)
  assert.equal((await repository.draft(taskId)).task.column, 'done')
  assert.ok(store.files.get('Task.md')!.endsWith('# Original body\n'))
})

test('anchored moves use all tasks and leave hidden neighbours untouched', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const anchor = await repository.createTask({ boardId, title: 'Visible', columnId: 'doing' })
  const hidden = await repository.createTask({ boardId, title: 'Hidden', columnId: 'doing' })
  const hiddenBefore = store.files.get(hidden.path)
  const task = (await repository.draft(taskId)).task
  await repository.actOnTask(task, { kind: 'move', columnId: 'doing', anchor, side: 'after' })
  const moved = (await repository.draft(taskId)).task
  assert.ok(moved.order! > anchor.order! && moved.order! < hidden.order!)
  assert.equal(store.files.get(hidden.path), hiddenBefore)
  await repository.undo(boardId)
  assert.equal((await repository.draft(taskId)).task.column, 'todo')
})

test('stale source and drop anchor snapshots reject task actions without new writes', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const source = (await repository.draft(taskId)).task
  const anchor = await repository.createTask({ boardId, title: 'Anchor', columnId: 'doing' })
  await repository.actOnTask(anchor, { kind: 'archive', value: true })
  const writes = store.writes
  await assert.rejects(repository.actOnTask(source, { kind: 'move', columnId: 'doing', anchor }), /changed elsewhere/)
  assert.equal(store.writes, writes)
  await repository.actOnTask(source, { kind: 'priority', value: true })
  await assert.rejects(repository.actOnTask(source, { kind: 'priority', value: false }), /changed elsewhere/)
})

test('atomic task action guard catches order changes after scanning', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const task = (await repository.draft(taskId)).task
  store.beforeProcess = async () => {
    store.files.set('Task.md', taskContent.replace('kanban_order: a0', 'kanban_order: a1'))
  }
  await assert.rejects(repository.actOnTask(task, { kind: 'archive', value: true }), /changed elsewhere/)
  assert.equal(store.writes, 0)
  assert.equal(repository.hasUndo(boardId), false)
})

test('reorder actions change only the selected task and boundaries are no-ops', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const next = await repository.createTask({ boardId, title: 'Second' })
  const task = (await repository.draft(taskId)).task
  const writes = store.writes
  await repository.actOnTask(task, { kind: 'reorder', direction: -1 })
  assert.equal(store.writes, writes)
  await repository.actOnTask(task, { kind: 'reorder', direction: 1 })
  assert.ok((await repository.draft(taskId)).task.order! > next.order!)
  assert.equal((await repository.draft(next.id)).task.order, next.order)
})

test('task actions keep strict read requirements and persistence failures do not add history', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const task = (await repository.draft(taskId)).task
  store.fail = true
  await assert.rejects(repository.actOnTask(task, { kind: 'complete', completed: true }), /Disk write failed/)
  assert.equal(repository.hasUndo(boardId), false)
  store.fail = false
  store.unreadable.add('Task.md')
  await assert.rejects(repository.actOnTask(task, { kind: 'archive', value: true }), /could not be read/)
  assert.equal(store.files.get('Task.md'), taskContent)
})

test('batch actions apply to selected tasks and undo the successful group together', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  const selected = [(await repository.draft(taskId)).task, (await repository.draft(second.id)).task]
  const report = await repository.batchActOnTasks(boardId, selected, { kind: 'archive', value: true })
  assert.deepEqual(report.results.map((result) => result.status), ['success', 'success'])
  assert.equal((await repository.draft(taskId)).task.archived, true)
  assert.equal((await repository.draft(second.id)).task.archived, true)
  const undo = await repository.undo(boardId)
  assert.deepEqual(undo.results.map((result) => result.status), ['success', 'success'])
  assert.equal((await repository.draft(taskId)).task.archived, false)
  assert.equal((await repository.draft(second.id)).task.archived, false)
  assert.equal(repository.hasUndo(boardId), false)
})

test('batch actions stop at the first failure and retain only successful undo entries', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  const third = await repository.createTask({ boardId, title: 'Third' })
  const selected = [(await repository.draft(taskId)).task, (await repository.draft(second.id)).task, (await repository.draft(third.id)).task]
  store.beforeProcess = async () => {
    if (store.writes >= 3) store.fail = true
  }
  const report = await repository.batchActOnTasks(boardId, selected, { kind: 'archive', value: true })
  assert.deepEqual(report.results.map((result) => result.status), ['success', 'failed', 'not-executed'])
  assert.equal((await repository.draft(taskId)).task.archived, true)
  assert.equal((await repository.draft(second.id)).task.archived, false)
  assert.equal((await repository.draft(third.id)).task.archived, false)
  store.fail = false
  store.beforeProcess = undefined
  const undo = await repository.undo(boardId)
  assert.deepEqual(undo.results.map((result) => result.status), ['success'])
  assert.equal((await repository.draft(taskId)).task.archived, false)
  assert.equal(repository.hasUndo(boardId), false)
})

test('batch completion restores original columns and leaves unselected notes unchanged', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second', columnId: 'doing' })
  const hidden = await repository.createTask({ boardId, title: 'Hidden' })
  const hiddenContent = store.files.get(hidden.path)
  const source = (await repository.draft(taskId)).task
  const completed = await repository.batchActOnTasks(boardId, [source, second], { kind: 'complete', completed: true })
  assert.deepEqual(completed.results.map((result) => result.status), ['success', 'success'])
  const firstDone = (await repository.draft(taskId)).task
  const secondDone = (await repository.draft(second.id)).task
  assert.notEqual(firstDone.order, secondDone.order)
  const restored = await repository.batchActOnTasks(boardId, [firstDone, secondDone], { kind: 'complete', completed: false })
  assert.deepEqual(restored.results.map((result) => result.status), ['success', 'success'])
  assert.equal((await repository.draft(taskId)).task.column, 'todo')
  assert.equal((await repository.draft(second.id)).task.column, 'doing')
  assert.equal(store.files.get(hidden.path), hiddenContent)
})

test('batch rejects duplicate and foreign targets before writing and preserves old undo', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const source = (await repository.draft(taskId)).task
  await repository.actOnTask(source, { kind: 'priority', value: true })
  const writes = store.writes
  await assert.rejects(repository.batchActOnTasks(boardId, [source, source], { kind: 'archive', value: true }), /distinct tasks/)
  await assert.rejects(repository.batchActOnTasks(boardId, [source, { ...source, id: 'other', boardId: 'other' }],
    { kind: 'archive', value: true }), /distinct tasks/)
  assert.equal(store.writes, writes)
  await repository.undo(boardId)
  assert.equal((await repository.draft(taskId)).task.priority, false)
})

test('batch stops for stale targets and rechecks strict reads between submissions', async () => {
  for (const failure of ['snapshot', 'read']) {
    const store = new MemoryStore()
    const repository = new TaskRepository(store)
    const second = await repository.createTask({ boardId, title: 'Second' })
    const source = (await repository.draft(taskId)).task
    store.beforeProcess = async () => {
      store.beforeProcess = undefined
      if (failure === 'snapshot') store.files.set(second.path, createNote({ ...propertiesOf(store.files.get(second.path)!), kanban_column: 'doing' }))
      else store.unreadable.add(second.path)
    }
    const report = await repository.batchActOnTasks(boardId, [source, second], { kind: 'archive', value: true })
    assert.deepEqual(report.results.map((result) => result.status), ['success', 'failed'])
    store.unreadable.clear()
    assert.equal((await repository.draft(second.id)).task.archived, false)
    await repository.undo(boardId)
    assert.equal((await repository.draft(taskId)).task.archived, false)
  }
})

test('batch cancellation at the atomic callback prevents remaining writes', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  const source = (await repository.draft(taskId)).task
  const controller = new AbortController()
  const writes = store.writes
  store.beforeProcess = async () => { controller.abort() }
  const report = await repository.batchActOnTasks(boardId, [source, second], { kind: 'archive', value: true }, controller.signal)
  assert.deepEqual(report.results.map((result) => result.status), ['not-executed', 'not-executed'])
  assert.equal(store.writes, writes)
  assert.equal(repository.hasUndo(boardId), false)
})

test('partial group undo preserves a conflicting field and retries only remaining changes', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  const third = await repository.createTask({ boardId, title: 'Third' })
  const source = (await repository.draft(taskId)).task
  await repository.batchActOnTasks(boardId, [source, second, third], { kind: 'archive', value: true })
  const conflict = createNote({ ...propertiesOf(store.files.get(second.path)!), kanban_archived: false }, 'External body\n')
  store.files.set(second.path, conflict)
  const report = await repository.undo(boardId)
  assert.deepEqual(report.results.map((result) => result.status), ['success', 'failed', 'not-executed'])
  assert.equal(store.files.get(second.path), conflict)
  assert.equal((await repository.draft(taskId)).task.archived, true)
  assert.equal((await repository.draft(third.id)).task.archived, false)
  assert.equal(repository.hasUndo(boardId), true)
  store.files.set(second.path, createNote({ ...propertiesOf(conflict), kanban_archived: true }, 'External body\n'))
  const retried = await repository.undo(boardId)
  assert.deepEqual(retried.results.map((result) => result.taskId), [second.id, taskId])
  assert.equal(store.files.get(second.path)!.endsWith('External body\n'), true)
  assert.equal(repository.hasUndo(boardId), false)
})

test('deleting a task removes only its entry from a batch undo group', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  await repository.batchActOnTasks(boardId, [(await repository.draft(taskId)).task, second], { kind: 'archive', value: true })
  await repository.deleteTask(await repository.draft(second.id))
  const undo = await repository.undo(boardId)
  assert.deepEqual(undo.results.map((result) => result.taskId), [taskId])
  assert.equal((await repository.draft(taskId)).task.archived, false)
})

test('completion never guesses invalid restore targets or silently repairs missing neighbour keys', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  store.files.set('Task.md', createNote({ ...propertiesOf(taskContent), kanban_column: 'done' }))
  await assert.rejects(repository.actOnTask((await repository.draft(taskId)).task,
    { kind: 'complete', completed: false }), /Choose a valid column/)
  store.files.set('Task.md', taskContent)
  const target = await repository.createTask({ boardId, title: 'No order', columnId: 'doing' })
  const properties = propertiesOf(store.files.get(target.path)!)
  delete properties.kanban_order
  store.files.set(target.path, createNote(properties))
  const writes = store.writes
  await assert.rejects(repository.actOnTask((await repository.draft(taskId)).task,
    { kind: 'move', columnId: 'doing' }), /explicit repair/)
  assert.equal(store.writes, writes)
  assert.equal(store.files.get('Task.md'), taskContent)
})

test('task actions preserve unrelated external fields and edited body text', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const task = (await repository.draft(taskId)).task
  store.beforeProcess = async () => {
    store.files.set('Task.md', createNote({ ...propertiesOf(taskContent), other_plugin: 'retained' }, 'New body\n'))
    store.beforeProcess = undefined
  }
  await repository.actOnTask(task, { kind: 'move', columnId: 'doing' })
  await repository.undo(boardId)
  assert.equal(propertiesOf(store.files.get('Task.md')!).other_plugin, 'retained')
  assert.ok(store.files.get('Task.md')!.endsWith('New body\n'))
})

test('order repair includes archived and missing keys, preserves body and supports grouped undo', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  store.files.set(second.path, createNote({ ...propertiesOf(store.files.get(second.path)!), kanban_order: undefined, kanban_archived: true }, 'Preserved body'))
  const before = store.files.get(second.path)!
  const plan = await repository.previewOrderRepair(boardId, 'todo')
  assert.equal(plan.entries.length, 2)
  assert.ok(plan.entries[0]!.order < plan.entries[1]!.order)
  const report = await repository.repairOrder(plan)
  assert.deepEqual(report.results.map((entry) => entry.status), ['success', 'success'])
  assert.ok(store.files.get(second.path)!.endsWith('Preserved body'))
  await repository.undo(boardId)
  assert.deepEqual(propertiesOf(store.files.get(second.path)!), propertiesOf(before))
})

test('order repair refuses stale previews, tampered keys and diagnostics without writes', async () => {
  for (const mode of ['stale', 'tampered', 'diagnostic']) {
    const store = new MemoryStore()
    const repository = new TaskRepository(store)
    const plan = await repository.previewOrderRepair(boardId, 'todo')
    if (mode === 'stale') store.files.set('Task.md', createNote({ ...propertiesOf(taskContent), kanban_order: 'a2' }))
    if (mode === 'diagnostic') store.files.set('Duplicate.md', taskContent)
    const submitted = mode === 'tampered' ? { ...plan, entries: plan.entries.map((entry) => ({ ...entry, order: 'a9' })) } : plan
    await assert.rejects(repository.repairOrder(submitted), /preview changed|diagnostics/)
    assert.equal(store.writes, 0)
    assert.equal(repository.hasUndo(boardId), false)
  }
})

test('order repair stops after failure and undo restores only its successful subset', async () => {
  const store = new MemoryStore()
  const repository = new TaskRepository(store)
  const second = await repository.createTask({ boardId, title: 'Second' })
  const third = await repository.createTask({ boardId, title: 'Third' })
  store.files.set(second.path, createNote({ ...propertiesOf(store.files.get(second.path)!), kanban_order: 'a0' }))
  const original = new Map(store.files)
  const plan = await repository.previewOrderRepair(boardId, 'todo')
  let calls = 0
  store.beforeProcess = async () => { calls += 1; if (calls === 2) store.fail = true }
  const report = await repository.repairOrder(plan)
  assert.deepEqual(report.results.map((result) => result.status), ['success', 'failed', 'not-executed'])
  assert.equal(store.files.get(third.path), original.get(third.path))
  store.beforeProcess = undefined
  store.fail = false
  const undone = await repository.undo(boardId)
  assert.equal(undone.results.length, 1)
  for (const [path, content] of original) assert.deepEqual(propertiesOf(store.files.get(path)!), propertiesOf(content))
})

test('order repair detects column membership races and final source changes', async () => {
  for (const mode of ['membership', 'source', 'disposed']) {
    const store = new MemoryStore()
    const repository = new TaskRepository(store)
    const second = await repository.createTask({ boardId, title: 'Second' })
    const plan = await repository.previewOrderRepair(boardId, 'todo')
    store.beforeProcess = async () => {
      store.beforeProcess = undefined
      if (mode === 'membership') store.files.set(second.path, createNote({ ...propertiesOf(store.files.get(second.path)!), kanban_column: 'doing' }))
      if (mode === 'source') store.files.set('Task.md', taskContent + 'External body')
      if (mode === 'disposed') repository.dispose()
    }
    const report = await repository.repairOrder(plan)
    assert.equal(report.results[mode === 'membership' ? 1 : 0]!.status, 'failed')
    if (mode === 'source') assert.equal(store.files.get('Task.md'), taskContent + 'External body')
    if (mode === 'disposed') assert.equal(repository.hasUndo(boardId), false)
  }
})