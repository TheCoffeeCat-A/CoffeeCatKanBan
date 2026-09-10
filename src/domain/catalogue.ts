import { parseNote } from './markdown'
import { assertMembership, isUuid, readBoard, readTask, type Board, type Task } from './model'

export interface NoteSource {
  readonly path: string
  readonly content: string
}

export interface Diagnostic {
  readonly path: string
  readonly message: string
}

export interface Catalogue {
  readonly boards: readonly Board[]
  readonly tasks: readonly Task[]
  readonly diagnostics: readonly Diagnostic[]
}

export function buildCatalogue(notes: readonly NoteSource[]): Catalogue {
  const identities = new Map<string, string[]>()
  const candidates: (Board | Task)[] = []
  const diagnostics: Diagnostic[] = []
  for (const note of notes) {
    try {
      const parsed = parseNote(note.content)
      if (!parsed || !Object.hasOwn(parsed.properties, 'kanban_kind')) continue
      const properties = parsed.properties
      if (isUuid(properties.kanban_id)) {
        const paths = identities.get(properties.kanban_id) ?? []
        paths.push(note.path)
        identities.set(properties.kanban_id, paths)
      }
      if (properties.kanban_kind === 'board') candidates.push(readBoard(properties, note.path))
      else if (properties.kanban_kind === 'task') candidates.push(Object.freeze({
        ...readTask(properties, note.path), searchText: parsed.body,
      }))
      else diagnostics.push({ path: note.path, message: 'Unknown kanban_kind' })
    } catch {
      if (/^kanban_(?:kind|id|schema)\s*:/m.test(note.content)) {
        diagnostics.push({ path: note.path, message: 'Invalid task or board frontmatter; open the note to repair it' })
      }
    }
  }
  const unique = candidates.filter((candidate) => {
    if ((identities.get(candidate.id)?.length ?? 0) === 1) return true
    diagnostics.push({ path: candidate.path, message: 'Duplicate kanban_id; no file was selected or changed' })
    return false
  })
  const boards = unique.filter((candidate): candidate is Board => 'columns' in candidate)
  const tasks: Task[] = []
  for (const candidate of unique) {
    if (!('boardId' in candidate)) continue
    const board = boards.find((entry) => entry.id === candidate.boardId)
    try {
      if (!board) throw new Error('Unknown or conflicting board')
      assertMembership(candidate, board)
      tasks.push(candidate)
    } catch {
      diagnostics.push({ path: candidate.path, message: 'Unknown board or column; the note is unchanged' })
    }
  }
  return Object.freeze({
    boards: Object.freeze(boards), tasks: Object.freeze(tasks),
    diagnostics: Object.freeze(diagnostics.map((entry) => Object.freeze(entry))),
  })
}