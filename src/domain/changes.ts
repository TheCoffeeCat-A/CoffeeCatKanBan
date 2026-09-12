import { isAlias, visit } from 'yaml'
import { parseNote, propertiesOf } from './markdown'
import { assertMembership, invalid, KanbanError, readTask, type Board, type Properties } from './model'

export const editableFields = [
  'kanban_title', 'kanban_column', 'kanban_order', 'kanban_previous_column', 'kanban_due',
  'kanban_priority', 'kanban_archived', 'kanban_assignees', 'tags',
] as const

export type EditableField = typeof editableFields[number]
export type PropertyValue = string | boolean | readonly string[]
export type TaskPatch = Partial<Record<EditableField, PropertyValue | undefined>>
export type FieldState = { readonly present: false } | { readonly present: true; readonly value: PropertyValue }
export interface FieldChange {
  readonly key: EditableField
  readonly before: FieldState
  readonly after: FieldState
}
export interface TaskChange {
  readonly taskId: string
  readonly boardId: string
  readonly fields: readonly FieldChange[]
}

function state(properties: Properties, key: string): FieldState {
  if (!Object.hasOwn(properties, key)) return Object.freeze({ present: false })
  const value = properties[key]
  if (typeof value !== 'string' && typeof value !== 'boolean'
    && !(Array.isArray(value) && value.every((entry) => typeof entry === 'string'))) {
    invalid(`Invalid editable property: ${key}`)
  }
  return Object.freeze({ present: true, value: Array.isArray(value) ? Object.freeze([...value]) : value as PropertyValue })
}

function same(left: FieldState, right: FieldState): boolean {
  return left.present === right.present
    && (!left.present || !right.present || JSON.stringify(left.value) === JSON.stringify(right.value))
}

export function prepareChange(content: string, patch: TaskPatch): TaskChange {
  const properties = propertiesOf(content)
  const task = readTask(properties, 'task.md')
  const fields: FieldChange[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (!editableFields.includes(key as EditableField)) invalid(`Field is not editable: ${key}`)
    const before = state(properties, key)
    const after = state(value === undefined ? {} : { [key]: value }, key)
    if (!same(before, after)) fields.push(Object.freeze({ key: key as EditableField, before, after }))
  }
  return Object.freeze({ taskId: task.id, boardId: task.boardId, fields: Object.freeze(fields) })
}

export function reverseChange(change: TaskChange): TaskChange {
  return Object.freeze({ ...change, fields: Object.freeze(change.fields.map((field) => Object.freeze({
    key: field.key, before: field.after, after: field.before,
  }))) })
}

export function applyChange(content: string, change: TaskChange, board: Board): string {
  const parsed = parseNote(content)
  if (!parsed) invalid('Task frontmatter is missing')
  visit(parsed.document, (_key, node) => {
    if (isAlias(node)) invalid('Resolve YAML aliases before editing task properties')
  })
  const task = readTask(parsed.properties, 'task.md')
  if (task.id !== change.taskId || task.boardId !== change.boardId || board.id !== change.boardId) {
    throw new KanbanError('CONFLICT', 'Task identity or board changed')
  }
  assertMembership(task, board)
  const draft = { ...parsed.properties }
  const keys = new Set<string>()
  for (const field of change.fields) {
    if (!editableFields.includes(field.key) || keys.has(field.key)) invalid('Invalid or duplicate field change')
    keys.add(field.key)
    if (!same(state(parsed.properties, field.key), field.before)) {
      throw new KanbanError('CONFLICT', `Property changed elsewhere: ${field.key}`)
    }
    if (field.after.present) draft[field.key] = field.after.value
    else delete draft[field.key]
  }
  assertMembership(readTask(draft, task.path), board)
  if (!change.fields.length) return content
  for (const field of change.fields) {
    if (field.after.present) parsed.document.set(field.key, field.after.value)
    else parsed.document.delete(field.key)
  }
  const yaml = parsed.document.toString({ lineWidth: 0 }).replace(/\r?\n/g, parsed.newline)
  return parsed.opening + yaml + parsed.tail
}
