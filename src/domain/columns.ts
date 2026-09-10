import { isAlias, visit } from 'yaml'
import { creationTitle } from './creation'
import { parseNote } from './markdown'
import { invalid, KanbanError, readBoard, type Board, type Properties } from './model'

export type ColumnAction =
  | { readonly kind: 'add'; readonly id: string; readonly title: string }
  | { readonly kind: 'rename'; readonly id: string; readonly title: string }
  | { readonly kind: 'move'; readonly id: string; readonly direction: -1 | 1 }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'default' | 'done'; readonly id: string }

function configuration(board: Board): string {
  return JSON.stringify([board.id, board.columns, board.defaultColumn, board.doneColumn])
}

export function changeColumns(content: string, expected: Board, action: ColumnAction,
  references: readonly Properties[]): string {
  const parsed = parseNote(content)
  if (!parsed) invalid('Board frontmatter is missing')
  visit(parsed.document, (_key, node) => {
    if (isAlias(node)) invalid('Resolve YAML aliases before editing board properties')
  })
  const board = readBoard(parsed.properties, expected.path)
  if (configuration(board) !== configuration(expected)) {
    throw new KanbanError('CONFLICT', 'Board columns changed elsewhere; reopen column settings')
  }
  const ids = board.columns.map((column) => column.id)
  const position = ids.indexOf(action.id)
  const occupied = (columnId: string): boolean => references.some((properties) =>
    properties.kanban_board === board.id && properties.kanban_column === columnId)
  if (action.kind !== 'add' && position < 0) invalid('Column no longer exists')
  switch (action.kind) {
    case 'add':
      if (position >= 0) invalid('Column ID already exists')
      ids.push(action.id)
      parsed.document.set(`kanban_column_${action.id}_title`, creationTitle(action.title))
      break
    case 'rename':
      parsed.document.set(`kanban_column_${action.id}_title`, creationTitle(action.title))
      break
    case 'move': {
      const destination = position + action.direction
      if (destination < 0 || destination >= ids.length) return content
      ids.splice(position, 1)
      ids.splice(destination, 0, action.id)
      break
    }
    case 'remove':
      if (action.id === board.defaultColumn || action.id === board.doneColumn) {
        invalid('Default and completed columns cannot be deleted')
      }
      if (occupied(action.id)) invalid('Move all tasks, including archived tasks, before deleting this column')
      ids.splice(position, 1)
      parsed.document.delete(`kanban_column_${action.id}_title`)
      break
    case 'default':
      if (action.id === board.doneColumn) invalid('The completed column cannot be the default column')
      parsed.document.set('kanban_default_column', action.id)
      break
    case 'done':
      if (action.id === board.defaultColumn) invalid('The default column cannot be the completed column')
      if (action.id === board.doneColumn) return content
      if (occupied(action.id) || occupied(board.doneColumn)) invalid('Both completed columns must be empty before changing this setting')
      parsed.document.set('kanban_done_column', action.id)
      break
  }
  parsed.document.set('kanban_columns', ids)
  const yaml = parsed.document.toString({ lineWidth: 0 }).replace(/\r?\n/g, parsed.newline)
  const result = parsed.opening + yaml + parsed.tail
  const verified = parseNote(result)!
  readBoard(verified.properties, board.path)
  return result
}