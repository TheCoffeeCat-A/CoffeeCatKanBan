import type { Board, Task } from '../domain/model'
import { defaultQuery, type TaskQuery } from '../domain/query'
import { iconButton } from './controls'

export function renderQueryBar(container: HTMLElement, board: Board, tasks: readonly Task[], query: TaskQuery,
  changed: (query: TaskQuery) => void): HTMLInputElement {
  let current = query
  const update = (patch: Partial<TaskQuery>): void => { current = { ...current, ...patch }; changed(current) }
  const bar = container.createDiv({ cls: 'cckb-query-bar', attr: { role: 'search', 'aria-label': '筛选当前看板' } })
  const search = bar.createEl('input', { cls: 'cckb-search', type: 'search', attr: { 'aria-label': '搜索任务', placeholder: '搜索任务' } })
  search.value = current.text
  search.addEventListener('input', () => update({ text: search.value }))
  const select = (label: string, value: string, options: readonly (readonly [string, string])[], action: (value: string) => void): HTMLSelectElement => {
    const input = bar.createEl('select', { attr: { 'aria-label': label, title: label } })
    for (const [id, text] of options) input.createEl('option', { value: id, text })
    if (value && !options.some(([id]) => id === value)) input.createEl('option', { value, text: `${value} (已失效)` })
    input.value = value
    input.addEventListener('change', () => action(input.value))
    return input
  }
  const column = select('状态筛选', current.column, [['', '全部状态'], ...board.columns.map((entry) => [entry.id, entry.title] as const)],
    (value) => update({ column: value }))
  const tags = [...new Set(tasks.flatMap((task) => [...task.tags]))].sort()
  const tag = select('标签筛选', current.tag, [['', '全部标签'], ...tags.map((value) => [value, value] as const)],
    (value) => update({ tag: value }))
  const due = select('日期筛选', current.due, [['', '全部日期'], ['overdue', '已逾期'], ['today', '今天到期'], ['undated', '无日期']],
    (value) => update({ due: value as TaskQuery['due'] }))
  const sort = select('显示排序', current.sort, [['manual', '手动顺序'], ['title', '按标题'], ['column', '按列顺序'], ['due', '按截止日期'], ['priority', '高优先级优先']],
    (value) => { update({ sort: value as TaskQuery['sort'] }); direction.disabled = value === 'manual' })
  const direction = select('排序方向', current.direction, [['asc', '正序'], ['desc', '倒序']],
    (value) => update({ direction: value as TaskQuery['direction'] }))
  direction.disabled = current.sort === 'manual'
  const priority = bar.createEl('label', { cls: 'cckb-priority-filter' })
  const checkbox = priority.createEl('input', { type: 'checkbox' })
  checkbox.checked = current.priorityOnly
  checkbox.addEventListener('change', () => update({ priorityOnly: checkbox.checked }))
  priority.createSpan({ text: '仅高优先级' })
  iconButton(bar, 'filter-x', '清除筛选和排序', () => {
    current = defaultQuery()
    search.value = ''; column.value = ''; tag.value = ''; due.value = ''; sort.value = 'manual'; checkbox.checked = false
    direction.value = 'asc'; direction.disabled = true
    changed(current)
    search.focus()
  })
  return search
}