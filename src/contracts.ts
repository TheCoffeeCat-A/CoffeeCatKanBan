import type { Catalogue, NoteSource } from './domain/catalogue'
import type { OrderRepairPlan } from './domain/order-repair'
import type { TaskChange } from './domain/changes'
import type { ColumnAction } from './domain/columns'
import type { NewBoard, NewTask } from './domain/creation'
import type { Board, Task } from './domain/model'
import type { BatchTaskAction, TaskAction, TaskOperationReport } from './domain/task-actions'

export interface NoteStore {
  appendLink?(source: NoteSource, targetPath: string, assertActive: () => void): Promise<string>
  listPaths(): readonly string[]
  read(path: string): Promise<string>
  process(path: string, update: (content: string) => string): Promise<string>
  create(path: string, content: string, assertActive: () => void, source?: NoteSource): Promise<void>
  trash(path: string, expectedContent: string, assertActive: () => void): Promise<void>
}

export interface TaskDraft {
  readonly task: Task
  readonly board: Board
  readonly content: string
}

export interface KanbanService {
  previewOrderRepair(boardId: string, columnId: string): Promise<OrderRepairPlan>
  repairOrder(plan: OrderRepairPlan): Promise<TaskOperationReport>
  linkNote(expected: TaskDraft, targetPath: string): Promise<TaskDraft>
  scan(): Promise<Catalogue>
  draft(taskId: string): Promise<TaskDraft>
  createBoard(input: NewBoard): Promise<Board>
  createTask(input: NewTask): Promise<Task>
  copyTask(expected: TaskDraft): Promise<Task>
  deleteTask(expected: TaskDraft): Promise<void>
  editColumns(expected: Board, action: ColumnAction): Promise<Board>
  commit(change: TaskChange): Promise<void>
  actOnTask(expected: Task, action: TaskAction): Promise<void>
  batchActOnTasks(boardId: string, expected: readonly Task[], action: BatchTaskAction, signal?: AbortSignal): Promise<TaskOperationReport>
  undo(boardId: string): Promise<TaskOperationReport>
  hasUndo(boardId: string): boolean
}