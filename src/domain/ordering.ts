import { generateKeyBetween } from 'fractional-indexing'
import { compareTasks, invalid, KanbanError, type Board, type Task } from './model'
import type { TaskPatch } from './changes'

export function movePatch(tasks: readonly Task[], task: Task, board: Board, columnId: string, beforeId?: string): TaskPatch {
  if (!board.columns.some((column) => column.id === columnId)) invalid('Unknown target column')
  if (beforeId === task.id) return {}
  const others = tasks.filter((entry) => entry.boardId === board.id && entry.column === columnId && entry.id !== task.id)
    .sort(compareTasks)
  const position = beforeId === undefined ? others.length : others.findIndex((entry) => entry.id === beforeId)
  if (position < 0) throw new KanbanError('ORDER_CONFLICT', 'The drop target no longer exists')
  const previous = others[position - 1]
  const next = others[position]
  if ((previous && previous.order === undefined) || (next && next.order === undefined)
    || (previous && next && previous.order! >= next.order!)) {
    throw new KanbanError('ORDER_CONFLICT', 'Order keys need explicit repair before this move')
  }
  const patch: TaskPatch = {
    kanban_column: columnId,
    kanban_order: generateKeyBetween(previous?.order ?? null, next?.order ?? null),
  }
  if (columnId === board.doneColumn && task.column !== board.doneColumn) patch.kanban_previous_column = task.column
  return patch
}

export function completionPatch(task: Task, board: Board): TaskPatch {
  if (task.column !== board.doneColumn) {
    return { kanban_column: board.doneColumn, kanban_previous_column: task.column, kanban_order: undefined }
  }
  if (!task.previousColumn || task.previousColumn === board.doneColumn
    || !board.columns.some((column) => column.id === task.previousColumn)) {
    throw new KanbanError('INVALID_DATA', 'Choose a valid column before restoring this task')
  }
  return { kanban_column: task.previousColumn, kanban_order: undefined }
}