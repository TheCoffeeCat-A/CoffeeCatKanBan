import type { ConversionDraft, KanbanService, NoteStore, TaskDraft } from '../contracts'
import { convertNote } from '../domain/conversion'
import { buildCatalogue, type Catalogue, type Diagnostic, type NoteSource } from '../domain/catalogue'
import { changeColumns, type ColumnAction } from '../domain/columns'
import { applyChange, prepareChange, reverseChange, type TaskChange } from '../domain/changes'
import { availableNotePath, newBoardNote, newTaskNote, type NewBoard, type NewTask } from '../domain/creation'
import { parseNote, propertiesOf } from '../domain/markdown'
import { invalid, KanbanError, readBoard, readTask, validateNotePath, type Board, type Task } from '../domain/model'
import { assertTaskSnapshot, taskActionPatch, type BatchTaskAction, type TaskAction, type TaskOperationReport, type TaskOperationResult } from '../domain/task-actions'
import { copiedTaskNote } from '../domain/task-files'
import { planOrderRepair, type OrderRepairPlan } from '../domain/order-repair'

export type { NoteStore, TaskDraft } from '../contracts'

export class TaskRepository implements KanbanService {
  private active = true
  private queue: Promise<unknown> = Promise.resolve()
  private notes: readonly NoteSource[] = []
  private catalogue: Catalogue = buildCatalogue([])
  private readonly history = new Map<string, readonly TaskChange[]>()
  private readonly displayNotes = new Map<string, NoteSource>()
  private readonly displayParsed = new WeakMap<NoteSource, ReturnType<typeof parseNote>>()
  private readonly dirtyPaths = new Set<string>()
  private displayRevision = 0

  constructor(private readonly store: NoteStore, private readonly incremental = false) {}

  scan(force = false): Promise<Catalogue> {
    if (force) this.invalidate()
    return this.enqueue(() => this.incremental ? this.loadDisplay() : this.load('display'))
  }

  invalidate(path?: string): void {
    this.displayRevision += 1
    if (path === undefined) { this.displayNotes.clear(); this.dirtyPaths.clear() }
    else this.dirtyPaths.add(path)
  }

  private async loadDisplay(): Promise<Catalogue> {
    this.assertActive()
    const revision = this.displayRevision
    const paths = this.store.listPaths()
    const present = new Set(paths)
    for (const path of this.displayNotes.keys()) if (!present.has(path)) this.displayNotes.delete(path)
    const notes: NoteSource[] = []
    const errors: Diagnostic[] = []
    for (const path of paths) {
      let note = this.dirtyPaths.has(path) ? undefined : this.displayNotes.get(path)
      if (!note) {
        try {
          note = { path, content: await this.store.read(path) }
          if (revision === this.displayRevision) this.displayNotes.set(path, note)
        } catch {
          this.displayNotes.delete(path)
          errors.push({ path, message: 'Note could not be read; restore access and refresh' })
        }
      }
      this.assertActive()
      if (note) notes.push(note)
    }
    if (revision === this.displayRevision) this.dirtyPaths.clear()
    const catalogue = buildCatalogue(notes, this.displayParsed)
    return Object.freeze({ ...catalogue, diagnostics: Object.freeze([...catalogue.diagnostics, ...errors]) })
  }

  previewConversion(path: string, boardId: string, columnId: string): Promise<ConversionDraft> {
    return this.enqueue(async () => {
      await this.load()
      if (this.catalogue.diagnostics.length) throw new KanbanError('CONFLICT', 'Resolve data diagnostics before converting notes')
      const source = this.notes.find((note) => note.path === path)
      const board = this.catalogue.boards.find((entry) => entry.id === boardId)
      if (!source || !board) throw new KanbanError('NOT_FOUND', 'Note or board unavailable')
      const title = path.split('/').at(-1)!.replace(/\.md$/i, '')
      const content = convertNote(source.content, path, { boardId, columnId, title }, crypto.randomUUID(), board, this.catalogue.tasks)
      const task = readTask(propertiesOf(content), path)
      return Object.freeze({ source, board, columnId, task, content })
    })
  }

  convertNote(expected: ConversionDraft): Promise<Task> {
    return this.enqueue(async () => {
      await this.load()
      if (this.catalogue.diagnostics.length) throw new KanbanError('CONFLICT', 'Resolve data diagnostics before converting notes')
      const source = this.notes.find((note) => note.path === expected.source.path)
      const board = this.catalogue.boards.find((entry) => entry.id === expected.board.id)
      if (!source || !board || source.content !== expected.source.content || JSON.stringify(board) !== JSON.stringify(expected.board)) {
        throw new KanbanError('CONFLICT', 'Note or board changed; reopen the conversion preview')
      }
      const title = source.path.split('/').at(-1)!.replace(/\.md$/i, '')
      const content = convertNote(source.content, source.path, { boardId: board.id, columnId: expected.columnId, title }, expected.task.id, board, this.catalogue.tasks)
      if (content !== expected.content || this.catalogue.tasks.some((task) => task.id === expected.task.id)
        || this.catalogue.boards.some((entry) => entry.id === expected.task.id)) {
        throw new KanbanError('CONFLICT', 'Conversion preview changed; review again')
      }
      if (!this.store.convert) throw new KanbanError('NOT_FOUND', 'Note conversion unavailable')
      const saved = await this.store.convert(source, content, () => this.assertActive())
      this.assertActive()
      this.notes = this.notes.map((note) => note.path === source.path ? { path: note.path, content: saved } : note)
      this.catalogue = buildCatalogue(this.notes)
      return this.locate(expected.task.id).task
    })
  }

  previewOrderRepair(boardId: string, columnId: string): Promise<OrderRepairPlan> {
    return this.enqueue(async () => {
      await this.load()
      return this.orderRepairPlan(boardId, columnId)
    })
  }

  private orderRepairPlan(boardId: string, columnId: string): OrderRepairPlan {
    if (this.catalogue.diagnostics.length) throw new KanbanError('CONFLICT', 'Resolve data diagnostics before repairing order')
    const board = this.catalogue.boards.find((entry) => entry.id === boardId)
    if (!board) throw new KanbanError('NOT_FOUND', 'Board unavailable')
    return planOrderRepair(board, columnId, this.catalogue.tasks)
  }

  repairOrder(plan: OrderRepairPlan): Promise<TaskOperationReport> {
    const expected = structuredClone(plan)
    return this.enqueue(async () => {
      await this.load()
      const fresh = this.orderRepairPlan(expected.board.id, expected.columnId)
      if (JSON.stringify(fresh) !== JSON.stringify(expected)) throw new KanbanError('CONFLICT', 'Repair preview changed; reopen it')
      const snapshots = expected.entries.map((entry) => entry.task)
      const changes: TaskChange[] = []
      const results: TaskOperationResult[] = []
      for (const [index, entry] of expected.entries.entries()) {
        try {
          await this.load()
          const current = this.orderRepairPlan(expected.board.id, expected.columnId)
          const byId = new Map(current.entries.map((item) => [item.task.id, item.task]))
          if (JSON.stringify(current.board) !== JSON.stringify(expected.board) || byId.size !== snapshots.length
            || snapshots.some((task) => JSON.stringify(byId.get(task.id)) !== JSON.stringify(task))) {
            throw new KanbanError('CONFLICT', 'Column changed during repair')
          }
          const draft = this.locate(entry.task.id)
          const change = prepareChange(draft.content, { kanban_order: entry.order })
          const applied = await this.write(change, (content) => {
            if (content !== draft.content) throw new KanbanError('CONFLICT', 'Task changed before repair write')
          })
          if (applied) changes.push(change)
          snapshots[index] = this.locate(entry.task.id).task
          results.push({ taskId: entry.task.id, title: entry.task.title, status: applied ? 'success' : 'skipped' })
        } catch (reason) {
          results.push({ taskId: entry.task.id, title: entry.task.title, status: 'failed', message: reason instanceof Error ? reason.message : '修复失败' })
          for (const pending of expected.entries.slice(index + 1)) results.push({ taskId: pending.task.id, title: pending.task.title, status: 'not-executed', message: '前一项失败, 未执行' })
          break
        }
      }
      if (changes.length && this.active) this.history.set(expected.board.id, Object.freeze(changes))
      return Object.freeze({ results: Object.freeze(results) })
    })
  }

  linkNote(expected: TaskDraft, targetPath: string): Promise<TaskDraft> {
    return this.enqueue(async () => {
      await this.load()
      const draft = this.fileDraft(expected)
      if (!this.store.appendLink) throw new KanbanError('NOT_FOUND', 'Note linking is unavailable')
      const content = await this.store.appendLink({ path: draft.task.path, content: draft.content }, targetPath, () => this.assertActive())
      this.assertActive()
      this.notes = this.notes.map((note) => note.path === draft.task.path ? { ...note, content } : note)
      this.catalogue = buildCatalogue(this.notes)
      return this.locate(draft.task.id)
    })
  }

  createBoard(input: NewBoard): Promise<Board> {
    return this.enqueue(async () => {
      await this.load()
      const path = availableNotePath(input.title, input.folder, this.store.listPaths())
      const content = newBoardNote(input, crypto.randomUUID(), path)
      const board = readBoard(propertiesOf(content), path)
      await this.persistCreated(path, content)
      this.acceptCreated(path, content)
      return board
    })
  }

  createTask(input: NewTask): Promise<Task> {
    return this.enqueue(async () => {
      await this.load()
      const board = this.catalogue.boards.find((entry) => entry.id === input.boardId)
      if (!board) throw new KanbanError('NOT_FOUND', 'Board is missing, invalid, or conflicting')
      const path = availableNotePath(input.title, board.taskFolder, this.store.listPaths())
      const content = newTaskNote(input, crypto.randomUUID(), path, board, this.catalogue.tasks)
      const task = readTask(propertiesOf(content), path)
      await this.persistCreated(path, content)
      this.acceptCreated(path, content)
      return task
    })
  }

  // Create an independent copy only while the reviewed source still matches
  // type: (TaskDraft) => Promise<Task>
  copyTask(expected: TaskDraft): Promise<Task> {
    return this.enqueue(async () => {
      await this.load()
      const draft = this.fileDraft(expected)
      const folder = draft.task.path.split('/').slice(0, -1).join('/')
      const path = availableNotePath(draft.task.title, folder, this.store.listPaths())
      const content = copiedTaskNote(draft.content, draft.task.path, crypto.randomUUID(), path, draft.board, this.catalogue.tasks)
      const task = readTask(propertiesOf(content), path)
      await this.persistCreated(path, content, { path: draft.task.path, content: draft.content })
      this.acceptCreated(path, content)
      return task
    })
  }

  // Remove only the reviewed task through the host trash operation
  // type: (TaskDraft) => Promise<void>
  deleteTask(expected: TaskDraft): Promise<void> {
    return this.enqueue(async () => {
      await this.load()
      const draft = this.fileDraft(expected)
      validateNotePath(draft.task.path)
      await this.store.trash(draft.task.path, draft.content, () => this.assertActive())
      if (this.active) {
        this.notes = this.notes.filter((note) => note.path !== draft.task.path)
        this.catalogue = buildCatalogue(this.notes)
        const previous = this.history.get(draft.board.id)
        if (previous) {
          const remaining = previous.filter((change) => change.taskId !== draft.task.id)
          if (remaining.length) this.history.set(draft.board.id, remaining)
          else this.history.delete(draft.board.id)
        }
      }
    })
  }

  editColumns(expected: Board, action: ColumnAction): Promise<Board> {
    return this.enqueue(async () => {
      await this.load()
      const board = this.catalogue.boards.find((entry) => entry.id === expected.id)
      if (!board) throw new KanbanError('NOT_FOUND', 'Board is missing, invalid, or conflicting')
      const references = this.notes.flatMap((note) => {
        try {
          const parsed = parseNote(note.content)
          return parsed ? [parsed.properties] : []
        } catch {
          if ((action.kind === 'remove' || action.kind === 'done') && /^kanban_/m.test(note.content)) {
            throw new KanbanError('CONFLICT', 'Repair invalid task notes before deleting or changing completed columns')
          }
          return []
        }
      })
      const content = await this.store.process(board.path, (current) => {
        this.assertActive()
        return changeColumns(current, expected, action, references)
      })
      if (this.active) {
        this.notes = this.notes.map((note) => note.path === board.path ? { ...note, content } : note)
        this.catalogue = buildCatalogue(this.notes)
      }
      return readBoard(propertiesOf(content), board.path)
    })
  }

  draft(taskId: string): Promise<TaskDraft> {
    return this.enqueue(async () => {
      await this.load()
      return this.locate(taskId)
    })
  }

  commit(change: TaskChange): Promise<void> {
    return this.enqueue(async () => {
      await this.load()
      const applied = await this.write(change)
      if (applied && this.active) this.history.set(change.boardId, Object.freeze([change]))
    })
  }

  // Undo each successful field change in the most recent operation group
  // type: (string) => Promise<TaskOperationReport>
  undo(boardId: string): Promise<TaskOperationReport> {
    return this.enqueue(async () => {
      const previous = this.history.get(boardId)
      if (!previous) throw new KanbanError('NOT_FOUND', 'No supported operation to undo')
      await this.load()
      const results: TaskOperationResult[] = []
      const remaining = [...previous]
      while (remaining.length) {
        const change = remaining.at(-1)!
        const title = this.catalogue.tasks.find((task) => task.id === change.taskId)?.title ?? change.taskId
        try {
          await this.load()
          const applied = await this.write(reverseChange(change))
          results.push({ taskId: change.taskId, title, status: applied ? 'success' : 'skipped' })
          remaining.pop()
        } catch (reason) {
          results.push({ taskId: change.taskId, title, status: 'failed', message: reason instanceof Error ? reason.message : '撤销失败' })
          for (const pending of remaining.slice(0, -1).reverse()) {
            results.push({ taskId: pending.taskId,
              title: this.catalogue.tasks.find((task) => task.id === pending.taskId)?.title ?? pending.taskId,
              status: 'not-executed', message: '前一项失败, 未执行' })
          }
          break
        }
      }
      if (remaining.length && this.active) this.history.set(boardId, Object.freeze(remaining))
      else this.history.delete(boardId)
      return Object.freeze({ results: Object.freeze(results) })
    })
  }

  // Apply one safe action to each selected task until the first failure
  // type: (string, readonly Task[], BatchTaskAction, AbortSignal?) => Promise<TaskOperationReport>
  batchActOnTasks(boardId: string, expected: readonly Task[], action: BatchTaskAction, signal?: AbortSignal): Promise<TaskOperationReport> {
    const snapshots = expected.map((task) => Object.freeze({ ...task }))
    const command = Object.freeze({ ...action })
    return this.enqueue(async () => {
      if (!snapshots.length || new Set(snapshots.map((task) => task.id)).size !== snapshots.length
        || snapshots.some((task) => task.boardId !== boardId)) invalid('Select distinct tasks from one board')
      if (!((command.kind === 'complete' && typeof command.completed === 'boolean')
        || (command.kind === 'archive' && typeof command.value === 'boolean'))) invalid('Unsupported batch action')
      const results: TaskOperationResult[] = []
      const changes: TaskChange[] = []
      for (let index = 0; index < snapshots.length; index += 1) {
        const snapshot = snapshots[index]!
        let submitting = false
        try {
          if (signal?.aborted) throw new KanbanError('INACTIVE', 'Batch cancelled before submission')
          await this.load()
          if (signal?.aborted) throw new KanbanError('INACTIVE', 'Batch cancelled before submission')
          const draft = this.locate(snapshot.id)
          assertTaskSnapshot(snapshot, draft.task, command)
          const patch = taskActionPatch(this.catalogue.tasks, draft.task, draft.board, command)
          const change = prepareChange(draft.content, patch)
          if (!change.fields.length) {
            results.push({ taskId: snapshot.id, title: snapshot.title, status: 'skipped', message: '任务已经处于目标状态' })
            continue
          }
          const applied = await this.write(change, (current) => {
            if (signal?.aborted) throw new KanbanError('INACTIVE', 'Batch cancelled before submission')
            assertTaskSnapshot(snapshot, readTask(propertiesOf(current), draft.task.path), command)
            submitting = true
          })
          if (applied) {
            changes.push(change)
            results.push({ taskId: snapshot.id, title: snapshot.title, status: 'success' })
          } else {
            results.push({ taskId: snapshot.id, title: snapshot.title, status: 'skipped', message: '任务没有发生变化' })
          }
        } catch (reason) {
          const cancelled = signal?.aborted && !submitting
          results.push({ taskId: snapshot.id, title: snapshot.title, status: cancelled ? 'not-executed' : 'failed',
            message: reason instanceof Error ? reason.message : '批量操作失败' })
          for (const remaining of snapshots.slice(index + 1)) {
            results.push({ taskId: remaining.id, title: remaining.title, status: 'not-executed', message: cancelled ? '操作已停止' : '前一项失败, 未执行' })
          }
          break
        }
      }
      if (changes.length && this.active) this.history.set(boardId, Object.freeze(changes))
      return Object.freeze({ results: Object.freeze(results) })
    })
  }

  actOnTask(expected: Task, action: TaskAction): Promise<void> {
    return this.enqueue(async () => {
      await this.load()
      const draft = this.locate(expected.id)
      assertTaskSnapshot(expected, draft.task, action)
      const patch = taskActionPatch(this.catalogue.tasks, draft.task, draft.board, action)
      const change = prepareChange(draft.content, patch)
      const applied = await this.write(change, (current) => {
        assertTaskSnapshot(expected, readTask(propertiesOf(current), draft.task.path), action)
      })
        if (applied && this.active) this.history.set(change.boardId, Object.freeze([change]))
    })
  }

  hasUndo(boardId: string): boolean {
    return this.active && this.history.has(boardId)
  }

  dispose(): void {
    this.active = false
    this.history.clear()
    this.invalidate()
  }

  private assertActive(): void {
    if (!this.active) throw new KanbanError('INACTIVE', 'Plugin is no longer active')
  }

  private acceptCreated(path: string, content: string): void {
    if (!this.active) return
    this.notes = [...this.notes, { path, content }]
    this.catalogue = buildCatalogue(this.notes)
  }

  private async persistCreated(path: string, content: string, source?: NoteSource): Promise<void> {
    validateNotePath(path)
    try {
      await this.store.create(path, content, () => this.assertActive(), source)
    } catch (reason) {
      let current: string
      try {
        current = await this.store.read(path)
      } catch {
        throw reason
      }
      if (current !== content) throw reason
    }
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(() => {
      this.assertActive()
      return operation()
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async load(mode: 'strict' | 'display' = 'strict'): Promise<Catalogue> {
    this.assertActive()
    this.invalidate()
    const notes: NoteSource[] = []
    const readErrors: Diagnostic[] = []
    for (const path of this.store.listPaths()) {
      try {
        notes.push({ path, content: await this.store.read(path) })
      } catch (reason) {
        if (mode === 'strict') throw reason
        readErrors.push(Object.freeze({ path, message: 'Note could not be read; other readable notes are still displayed. Retry after restoring access' }))
      }
      this.assertActive()
    }
    this.notes = notes
    const catalogue = buildCatalogue(notes)
    this.catalogue = Object.freeze({
      ...catalogue,
      diagnostics: Object.freeze([...catalogue.diagnostics, ...readErrors]),
    })
    return this.catalogue
  }

  private locate(taskId: string): TaskDraft {
    const task = this.catalogue.tasks.find((entry) => entry.id === taskId)
    if (!task) throw new KanbanError('NOT_FOUND', 'Task is missing, invalid, or has an identity conflict')
    const board = this.catalogue.boards.find((entry) => entry.id === task.boardId)
    const source = this.notes.find((entry) => entry.path === task.path)
    if (!board || !source) throw new KanbanError('NOT_FOUND', 'Task source is unavailable')
    return Object.freeze({ task, board, content: source.content })
  }

  // Reject a file operation when its confirmed path, content or board changed
  // type: (TaskDraft) => TaskDraft
  private fileDraft(expected: TaskDraft): TaskDraft {
    const current = this.locate(expected.task.id)
    if (current.task.path !== expected.task.path || current.content !== expected.content
      || JSON.stringify(current.board) !== JSON.stringify(expected.board)) {
      throw new KanbanError('CONFLICT', 'Task or board changed since review; reopen the confirmation')
    }
    return current
  }

  private async write(change: TaskChange, guard?: (current: string) => void): Promise<boolean> {
    this.assertActive()
    const draft = this.locate(change.taskId)
    if (!change.fields.length) return false
    let changed = false
    const content = await this.store.process(draft.task.path, (current) => {
      this.assertActive()
      guard?.(current)
      const next = applyChange(current, change, draft.board)
      changed = next !== current
      return next
    })
    if (this.active) {
      this.notes = this.notes.map((entry) => entry.path === draft.task.path ? { ...entry, content } : entry)
      this.catalogue = buildCatalogue(this.notes)
    }
    return changed
  }
}