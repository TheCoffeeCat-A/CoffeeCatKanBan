import { generateKeyBetween } from 'fractional-indexing'

export type Properties = Record<string, unknown>
export type ErrorCode = 'INVALID_DATA' | 'CONFLICT' | 'NOT_FOUND' | 'INACTIVE' | 'ORDER_CONFLICT'

export class KanbanError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message)
    this.name = 'KanbanError'
  }
}

export interface Column {
  readonly id: string
  readonly title: string
}

export interface Board {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly columns: readonly Column[]
  readonly defaultColumn: string
  readonly doneColumn: string
  readonly taskFolder: string
}

export interface Task {
  readonly id: string
  readonly path: string
  readonly boardId: string
  readonly title: string
  readonly type?: string
  readonly column: string
  readonly order?: string
  readonly previousColumn?: string
  readonly due?: string
  readonly priority: boolean
  readonly archived: boolean
  readonly assignees: readonly string[]
  readonly tags: readonly string[]
  readonly searchText?: string
}

export function invalid(message: string): never {
  throw new KanbanError('INVALID_DATA', message)
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => char.charCodeAt(0) < 0x20)
}

export function validateFolder(path: string): string {
  if (path === '') return path
  if (path.split('/').some((part) => !part || part.startsWith('.') || /[\\:*?"<>|]/.test(part)
    || hasControlCharacter(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    invalid('Folder must be a visible, vault-relative path')
  }
  return path
}

export function validateNotePath(path: string): string {
  if (!path.endsWith('.md')) invalid('A Markdown file path is required')
  validateFolder(path)
  return path
}

export function text(properties: Properties, key: string): string {
  const value = properties[key]
  if (typeof value !== 'string' || !value.trim()) invalid(`${key} must be non-empty text`)
  return value
}

function optionalText(properties: Properties, key: string): string | undefined {
  return Object.hasOwn(properties, key) ? text(properties, key) : undefined
}

function stringList(properties: Properties, key: string): readonly string[] {
  if (!Object.hasOwn(properties, key)) return Object.freeze([])
  const value = properties[key]
  if (!Array.isArray(value)) invalid(`${key} must be a list of non-empty strings`)
  const entries: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) invalid(`${key} must be a list of non-empty strings`)
    entries.push(entry)
  }
  return Object.freeze(entries)
}

function checkbox(properties: Properties, key: string): boolean {
  if (!Object.hasOwn(properties, key)) return false
  const value = properties[key]
  if (typeof value !== 'boolean') invalid(`${key} must be a boolean`)
  return value
}

function identity(properties: Properties, kind: 'task' | 'board'): string {
  if (properties.kanban_kind !== kind || properties.kanban_schema !== 1) {
    invalid(`Expected ${kind} schema 1`)
  }
  if (!isUuid(properties.kanban_id)) invalid('kanban_id must be a lowercase UUID')
  return properties.kanban_id
}

function columnId(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) invalid('Invalid column ID')
  return value
}

function title(properties: Properties, path: string): string {
  return optionalText(properties, 'kanban_title') ?? path.split('/').at(-1)!.slice(0, -3)
}

export function validateOrder(value: string): string {
  if (!/^[A-Za-z][0-9A-Za-z]{1,511}$/.test(value)) invalid('Invalid order key characters or length')
  try {
    generateKeyBetween(value, null)
  } catch {
    invalid('Invalid fractional order key')
  }
  return value
}

export function readBoard(properties: Properties, path: string): Board {
  const id = identity(properties, 'board')
  const ids = stringList(properties, 'kanban_columns')
  if (ids.length < 2 || new Set(ids).size !== ids.length) invalid('A board needs distinct columns')
  const columns = ids.map((id) => Object.freeze({
    id: columnId(id),
    title: text(properties, `kanban_column_${id}_title`),
  }))
  const defaultColumn = text(properties, 'kanban_default_column')
  const doneColumn = text(properties, 'kanban_done_column')
  if (!ids.includes(defaultColumn) || !ids.includes(doneColumn) || defaultColumn === doneColumn) {
    invalid('Default and completed columns must be distinct valid columns')
  }
  if (typeof properties.kanban_new_task_folder !== 'string') invalid('Missing task folder')
  return Object.freeze({
    id, path, title: title(properties, path), columns: Object.freeze(columns), defaultColumn, doneColumn,
    taskFolder: validateFolder(properties.kanban_new_task_folder),
  })
}

export function readTask(properties: Properties, path: string): Task {
  const id = identity(properties, 'task')
  if (!isUuid(properties.kanban_board)) invalid('kanban_board must be a lowercase UUID')
  const order = optionalText(properties, 'kanban_order')
  const previousColumn = optionalText(properties, 'kanban_previous_column')
  const due = optionalText(properties, 'kanban_due')
  const taskType = optionalText(properties, 'kanban_type')
  if (due !== undefined && !isIsoDate(due)) invalid('Invalid due date')
  return Object.freeze({
    id, path, boardId: properties.kanban_board, title: title(properties, path),
    ...(taskType === undefined ? {} : { type: taskType }),
    column: columnId(text(properties, 'kanban_column')),
    ...(order === undefined ? {} : { order: validateOrder(order) }),
    ...(previousColumn === undefined ? {} : { previousColumn: columnId(previousColumn) }),
    ...(due === undefined ? {} : { due }),
    priority: checkbox(properties, 'kanban_priority'), archived: checkbox(properties, 'kanban_archived'),
    assignees: stringList(properties, 'kanban_assignees'), tags: stringList(properties, 'tags'),
  })
}

export function assertMembership(task: Task, board: Board): void {
  if (task.boardId !== board.id || !board.columns.some((column) => column.id === task.column)) {
    invalid('Task belongs to an unknown board or column')
  }
}

export function compareTasks(left: Task, right: Task): number {
  if (left.order !== right.order) {
    if (left.order === undefined) return 1
    if (right.order === undefined) return -1
    return left.order < right.order ? -1 : 1
  }
  return left.id < right.id ? -1 : left.id === right.id ? 0 : 1
}
