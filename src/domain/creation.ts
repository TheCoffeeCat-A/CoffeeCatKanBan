import { generateKeyBetween } from 'fractional-indexing'
import { createNote } from './markdown'
import { hasControlCharacter, invalid, isIsoDate, readBoard, readTask, validateFolder, validateNotePath, type Board, type Task } from './model'

const forbiddenFileNameChars = new Set('\\/:*?"<>|#^[]%')

function fileNameStem(title: string): string {
  return Array.from(title, (char) => hasControlCharacter(char) || forbiddenFileNameChars.has(char) ? '-' : char).join('')
}

export interface NewBoard {
  readonly title: string
  readonly folder: string
  // Relative to the board directory, empty selects a folder named after the board file
  readonly taskFolder: string
}

export interface NewTask {
  readonly boardId: string
  readonly title: string
  readonly columnId?: string
  readonly due?: string
}

export function creationTitle(value: string): string {
  const title = value.trim()
  if (!title || title.length > 180) invalid('Title must contain 1 to 180 characters')
  return title
}

export function availableNotePath(title: string, folder: string, existingPaths: readonly string[]): string {
  validateFolder(folder)
  const normalized = fileNameStem(creationTitle(title))
  let stem = Array.from(normalized).slice(0, 80).join('').replace(/^[. ]+|[. ]+$/g, '') || 'Untitled'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `Note-${stem}`
  const used = new Set(existingPaths.map((path) => path.toLocaleLowerCase('en-US')))
  for (let suffix = 1; suffix <= 10000; suffix += 1) {
    const filename = `${stem}${suffix === 1 ? '' : ` (${suffix})`}.md`
    const path = folder ? `${folder}/${filename}` : filename
    if (!used.has(path.toLocaleLowerCase('en-US'))) return path
  }
  return invalid('Too many notes with the same title')
}

// Keep new cards in a child folder beside the board, including legacy flat destinations
// type: (Pick<Board, 'path' | 'taskFolder'>) => string
export function taskFolderForBoard(board: Pick<Board, 'path' | 'taskFolder'>): string {
  validateNotePath(board.path)
  const parent = board.path.split('/').slice(0, -1).join('/')
  const folder = validateFolder(board.taskFolder)
  if (folder && (!parent || folder.startsWith(`${parent}/`))) return folder
  return validateFolder(`${board.path.slice(0, -3)}-卡片`)
}

// Persist the resolved vault-relative card folder for a newly created board
// type: (NewBoard, string, string) => string
export function newBoardNote(input: NewBoard, id: string, path: string): string {
  const subfolder = validateFolder(input.taskFolder)
  const parent = path.split('/').slice(0, -1).join('/')
  const taskFolder = subfolder ? [parent, subfolder].filter(Boolean).join('/') : ''
  const properties = {
    kanban_kind: 'board', kanban_schema: 1, kanban_id: id, kanban_title: creationTitle(input.title),
    kanban_columns: ['todo', 'doing', 'done'],
    kanban_column_todo_title: '\u5f85\u5f00\u59cb',
    kanban_column_doing_title: '\u8fdb\u884c\u4e2d',
    kanban_column_done_title: '\u5df2\u5b8c\u6210',
    kanban_default_column: 'todo', kanban_done_column: 'done',
    kanban_new_task_folder: taskFolderForBoard({ path, taskFolder }),
  }
  readBoard(properties, path)
  return createNote(properties)
}

export function newTaskNote(input: NewTask, id: string, path: string, board: Board, tasks: readonly Task[]): string {
  const column = input.columnId ?? board.defaultColumn
  if (input.boardId !== board.id || !board.columns.some((entry) => entry.id === column)) invalid('Unknown board or column')
  if (input.due !== undefined && !isIsoDate(input.due)) invalid('Invalid due date')
  const keys = tasks.filter((task) => task.boardId === board.id && task.column === column)
    .flatMap((task) => task.order === undefined ? [] : [task.order]).sort()
  const properties = {
    kanban_kind: 'task', kanban_schema: 1, kanban_id: id, kanban_board: board.id,
    kanban_title: creationTitle(input.title), kanban_column: column,
    kanban_order: generateKeyBetween(keys.at(-1) ?? null, null),
    kanban_priority: false, kanban_archived: false, kanban_assignees: [], tags: [],
    ...(input.due === undefined ? {} : { kanban_due: input.due }),
  }
  readTask(properties, path)
  return createNote(properties)
}
