import { renderBoard } from '../../src/ui/board-view'
import { renderData } from '../../src/ui/data-view'
import { renderCalendar } from '../../src/ui/calendar-view'
import { renderVirtualList } from '../../src/ui/virtual-list'
import { defaultQuery, queryTasks } from '../../src/domain/query'
import type { Board, Task } from '../../src/domain/model'
import type { TaskAction } from '../../src/domain/task-actions'
import { generateNKeysBetween } from 'fractional-indexing'

// Only Obsidian's DOM convenience methods are adapted; rendering and ordering
// use production modules against a real Chromium DOM. This is not host acceptance.
HTMLElement.prototype.createEl = function(this: HTMLElement, tag: string, options: Record<string, unknown> = {}) {
  const element = this.ownerDocument.createElement(tag)
  if (options.cls) element.className = String(options.cls)
  if (options.text) element.textContent = String(options.text)
  if (options.type) element.setAttribute('type', String(options.type))
  for (const [key, value] of Object.entries((options.attr ?? {}) as Record<string, string>)) element.setAttribute(key, value)
  this.appendChild(element)
  return element
} as typeof HTMLElement.prototype.createEl
HTMLElement.prototype.createDiv = function(options) { return this.createEl('div', typeof options === 'string' ? { cls: options } : options) }
HTMLElement.prototype.createSpan = function(options) { return this.createEl('span', typeof options === 'string' ? { cls: options } : options) }
HTMLElement.prototype.addClass = function(...names) { this.classList.add(...names) }
HTMLElement.prototype.removeClass = function(...names) { this.classList.remove(...names) }
HTMLElement.prototype.empty = function() { this.replaceChildren() }
HTMLElement.prototype.setText = function(text) { this.textContent = String(text) }

const board: Board = { id: 'board', path: 'Board.md', title: '性能测试', taskFolder: 'Tasks', defaultColumn: 'todo', doneColumn: 'done',
  columns: [{ id: 'todo', title: '待开始' }, { id: 'doing', title: '进行中' }, { id: 'done', title: '已完成' }] }
const root = document.getElementById('root')!
let dispose: (() => void) | undefined
let actions: { id: string; action: TaskAction }[] = []
let tasks: Task[] = []
let enabled = true
const selection = { isSelected: () => false, toggle: () => undefined }
const interaction = {
  available: () => enabled, manualOrder: true,
  act: (task: Task, action: TaskAction) => { actions.push({ id: task.id, action }) },
  openTask: () => undefined, openNote: () => undefined, fileAction: () => undefined,
}

function render(mode: string, count: number, search = ''): { elapsed: number; nodes: number; matches: number } {
  dispose?.()
  root.empty()
  actions = []
  enabled = true
  if (tasks.length !== count) {
    const orders = generateNKeysBetween(null, null, count)
    tasks = Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`, boardId: 'board', path: `${String(index).padStart(5, '0')}.md`,
    title: `${String(index).padStart(5, '0')} ${index % 7 === 0 ? '很长的任务标题用于测试中文换行和可变高度 '.repeat(4) : '任务'}`,
    column: board.columns[index % 3]!.id, order: orders[index]!, archived: false, priority: index % 4 === 0,
    tags: index % 3 === 0 ? ['项目', 'long-tag-for-measurement'] : [], assignees: [],
    ...(index % 5 === 0 ? {} : { due: `2026-09-${String(index % 30 + 1).padStart(2, '0')}` }),
    }))
  }
  const start = performance.now()
  const visible = queryTasks(tasks, board.id, { ...defaultQuery(), text: search }, false, undefined, board.doneColumn, board.columns)
  if (mode === 'board') dispose = renderBoard(root, board, visible, tasks, interaction, () => undefined, selection)
  else if (mode === 'data') dispose = renderData(root, board, visible, tasks, interaction, selection)
  else dispose = renderCalendar(root, board, visible, tasks, interaction, '2026-09', () => undefined, selection, () => undefined)
  void root.offsetHeight
  return { elapsed: performance.now() - start, nodes: root.querySelectorAll('[data-task-id]').length, matches: visible.length }
}

function failingRow(): void {
  dispose?.()
  root.empty()
  dispose = renderVirtualList(root, [0, 1, 2], (row, item) => {
    if (item === 1) throw new Error('Render failure')
    row.createEl('button', { text: `healthy-${item}` })
  }, { label: '故障隔离' })
}

Object.assign(window, { cckbTest: { render, failingRow, actions: () => actions,
  dispose: () => { enabled = false; dispose?.() }, root } })
