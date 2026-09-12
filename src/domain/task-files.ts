import { newTaskNote } from './creation'
import { createNote, parseNote, propertiesOf } from './markdown'
import { invalid, readTask, type Board, type Task } from './model'

export type TaskFileAction = 'copy' | 'delete'

// Create a new task identity while preserving body text and supported task fields
// type: (string, string, string, string, Board, readonly Task[]) => string
export function copiedTaskNote(content: string, sourcePath: string, id: string, path: string,
  board: Board, tasks: readonly Task[]): string {
  const source = parseNote(content)
  if (!source) return invalid('This note has no task frontmatter')
  const task = readTask(source.properties, sourcePath)
  const properties = propertiesOf(newTaskNote({ boardId: task.boardId, title: task.title,
    columnId: task.column, ...(task.due === undefined ? {} : { due: task.due }),
    ...(task.type === undefined ? {} : { type: task.type }) }, id, path, board, tasks))
  return createNote({ ...properties, kanban_priority: task.priority,
    kanban_assignees: [...task.assignees], tags: [...task.tags],
    ...(task.previousColumn === undefined ? {} : { kanban_previous_column: task.previousColumn }),
  }, source.body)
}
