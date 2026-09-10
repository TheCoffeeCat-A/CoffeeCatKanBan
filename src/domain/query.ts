import { compareTasks, isIsoDate, type Task } from './model'

export type TaskSort = 'manual' | 'title' | 'due' | 'priority'
export type DueFilter = '' | 'overdue' | 'today' | 'undated'
export interface TaskQuery {
  readonly text: string
  readonly column: string
  readonly tag: string
  readonly priorityOnly: boolean
  readonly due: DueFilter
  readonly sort: TaskSort
}

export function defaultQuery(): TaskQuery {
  return { text: '', column: '', tag: '', priorityOnly: false, due: '', sort: 'manual' }
}

export function readQuery(value: unknown): TaskQuery {
  if (!value || typeof value !== 'object') return defaultQuery()
  const data = value as Record<string, unknown>
  return {
    text: typeof data.text === 'string' ? data.text : '',
    column: typeof data.column === 'string' ? data.column : '',
    tag: typeof data.tag === 'string' ? data.tag : '',
    priorityOnly: data.priorityOnly === true,
    due: data.due === 'overdue' || data.due === 'today' || data.due === 'undated' ? data.due : '',
    sort: data.sort === 'title' || data.sort === 'due' || data.sort === 'priority' ? data.sort : 'manual',
  }
}

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function queryTasks(tasks: readonly Task[], boardId: string, query: TaskQuery,
  showArchived: boolean, today = localDay(), doneColumn?: string): readonly Task[] {
  const words = query.text.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const filtered = tasks.filter((task) => {
    if (task.boardId !== boardId || (!showArchived && task.archived)) return false
    if (query.column && task.column !== query.column) return false
    if (query.tag && !task.tags.includes(query.tag)) return false
    if (query.priorityOnly && !task.priority) return false
    if (query.due === 'undated' && task.due !== undefined) return false
    if (query.due === 'today' && task.due !== today) return false
    if (query.due === 'overdue' && (!isIsoDate(today) || !task.due || task.due >= today || task.column === doneColumn)) return false
    const searchable = [task.title, ...task.tags, ...task.assignees, task.searchText ?? ''].join('\n').toLocaleLowerCase()
    return words.every((word) => searchable.includes(word))
  })
  return filtered.sort((left, right) => {
    let comparison = 0
    if (query.sort === 'title') comparison = left.title.localeCompare(right.title, 'zh-CN')
    if (query.sort === 'priority') comparison = Number(right.priority) - Number(left.priority)
    if (query.sort === 'due') comparison = (left.due ?? '9999-99-99').localeCompare(right.due ?? '9999-99-99')
    return comparison || compareTasks(left, right)
  })
}

export function textValues(text: string): readonly string[] {
  return [...new Set(text.split(/[,\n\uFF0C\u3001]/).map((value) => value.trim()).filter(Boolean))]
}

export function tagValues(text: string): readonly string[] {
  return [...new Set(textValues(text).map((tag) => tag.replace(/^#/, '')))]
}