import { visit } from 'yaml'
import { newTaskNote, type NewTask } from './creation'
import { createNote, parseNote, propertiesOf } from './markdown'
import { invalid, readTask, validateNotePath, type Board, type Task } from './model'

export function convertNote(content: string, path: string, input: NewTask, id: string, board: Board, tasks: readonly Task[]): string {
  validateNotePath(path)
  const parsed = parseNote(content)
  const original = parsed?.properties ?? {}
  if (Object.keys(original).some((key) => key.startsWith('kanban_'))) invalid('Note already contains kanban fields')
  const fields = propertiesOf(newTaskNote(input, id, path, board, tasks))
  delete fields.tags
  readTask({ ...original, ...fields }, path)
  if (!parsed) {
    const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
    const newline = content.includes('\r\n') ? '\r\n' : '\n'
    return bom + createNote(fields).replace(/\n/g, newline) + content.slice(bom.length)
  }
  visit(parsed.document, { Alias() { invalid('Cannot modify YAML aliases') } })
  for (const [key, value] of Object.entries(fields)) parsed.document.set(key, value)
  return parsed.opening + parsed.document.toString({ lineWidth: 0 }).replace(/\n/g, parsed.newline) + parsed.tail
}