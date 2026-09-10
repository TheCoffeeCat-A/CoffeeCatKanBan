import { compareTasks, invalid, KanbanError, type Board, type Task } from './model'
import { completionPatch, movePatch } from './ordering'
import type { TaskPatch } from './changes'

export type TaskAction =
  | { readonly kind: 'move'; readonly columnId: string; readonly anchor?: Task; readonly side?: 'before' | 'after' }
  | { readonly kind: 'reorder'; readonly direction: -1 | 1 }
  | { readonly kind: 'complete'; readonly completed: boolean }
  | { readonly kind: 'priority' | 'archive'; readonly value: boolean }

export type BatchTaskAction =
  | { readonly kind: 'complete'; readonly completed: boolean }
  | { readonly kind: 'archive'; readonly value: boolean }

export type TaskOperationStatus = 'success' | 'skipped' | 'failed' | 'not-executed'

export interface TaskOperationResult {
  readonly taskId: string
  readonly title: string
  readonly status: TaskOperationStatus
  readonly message?: string
}

export interface TaskOperationReport {
  readonly results: readonly TaskOperationResult[]
}

export function assertTaskSnapshot(expected: Task, current: Task, action: TaskAction): void {
  if (expected.id !== current.id || expected.boardId !== current.boardId
    || expected.column !== current.column || expected.order !== current.order || expected.archived !== current.archived
    || (action.kind === 'complete' && expected.previousColumn !== current.previousColumn)
    || (action.kind === 'priority' && expected.priority !== current.priority)) {
    throw new KanbanError('CONFLICT', 'Task changed elsewhere; refresh before retrying this action')
  }
}

export function taskActionPatch(tasks: readonly Task[], task: Task, board: Board, action: TaskAction): TaskPatch {
  switch (action.kind) {
    case 'priority': return { kanban_priority: action.value }
    case 'archive': return { kanban_archived: action.value }
    case 'complete': {
      if ((task.column === board.doneColumn) === action.completed) return {}
      const completion = completionPatch(task, board)
      return movePatch(tasks, task, board, String(completion.kanban_column))
    }
    case 'reorder': {
      const column = tasks.filter((entry) => entry.boardId === board.id && entry.column === task.column).sort(compareTasks)
      const position = column.findIndex((entry) => entry.id === task.id)
      if (position < 0) invalid('Task is no longer in this column')
      if (position + action.direction < 0 || position + action.direction >= column.length) return {}
      return movePatch(tasks, task, board, task.column,
        action.direction === -1 ? column[position - 1]!.id : column[position + 2]?.id)
    }
    case 'move': {
      if (!action.anchor) return movePatch(tasks, task, board, action.columnId)
      const anchor = tasks.find((entry) => entry.id === action.anchor!.id)
      if (!anchor || anchor.boardId !== board.id || anchor.column !== action.columnId) {
        throw new KanbanError('ORDER_CONFLICT', 'The drop target no longer exists in this column')
      }
      assertTaskSnapshot(action.anchor, anchor, action)
      if (anchor.id === task.id) return {}
      const column = tasks.filter((entry) => entry.boardId === board.id && entry.column === action.columnId && entry.id !== task.id)
        .sort(compareTasks)
      const position = column.findIndex((entry) => entry.id === anchor.id)
      const beforeId = action.side === 'after' ? column[position + 1]?.id : anchor.id
      return movePatch(tasks, task, board, action.columnId, beforeId)
    }
  }
}