import { generateKeyBetween } from 'fractional-indexing'
import { compareTasks, invalid, type Board, type Task } from './model'

export interface OrderRepairPlan {
  readonly board: Board
  readonly columnId: string
  readonly entries: readonly { readonly task: Task; readonly order: string }[]
}

export function planOrderRepair(board: Board, columnId: string, tasks: readonly Task[]): OrderRepairPlan {
  if (!board.columns.some((column) => column.id === columnId)) invalid('Unknown column')
  const column = tasks.filter((task) => task.boardId === board.id && task.column === columnId).sort(compareTasks)
  let previous = column.reduce<string | null>((maximum, task) => task.order && (!maximum || task.order > maximum) ? task.order : maximum, null)
  const entries = column.map((task) => {
    previous = generateKeyBetween(previous, null)
    if (previous.length > 512) invalid('Order key limit exceeded')
    return Object.freeze({ task, order: previous })
  })
  return Object.freeze({ board, columnId, entries: Object.freeze(entries) })
}