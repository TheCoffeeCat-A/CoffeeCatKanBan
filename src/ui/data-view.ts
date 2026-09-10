import type { Board, Task } from '../domain/model'
import { iconButton } from './controls'
import { showTaskMenu, type TaskInteraction } from './task-menu'
import { selectionCheckbox, type TaskSelection } from './task-selection'
import { renderVirtualList } from './virtual-list'

export function renderData(container: HTMLElement, board: Board, visible: readonly Task[], allTasks: readonly Task[], interaction: TaskInteraction, selection: TaskSelection): () => void {
  const wrapper = container.createDiv({ cls: 'cckb-data-scroll' })
  const table = wrapper.createEl('table', { cls: 'cckb-table' })
  const heading = table.createEl('thead').createEl('tr')
  for (const label of ['任务', '状态', '截止日期', '优先级', '标签', '负责人', '归档', '操作']) heading.createEl('th', { text: label })
  const body = table.createEl('tbody')
  table.setAttribute('aria-rowcount', String(visible.length + 1))
  const focused = visible.findIndex((task) => task.id === interaction.focusTaskId)
  const dispose = renderVirtualList(body, visible, (row, task) => {
    row.setAttribute('data-task-id', task.id)
    const taskCell = row.createEl('td')
    selectionCheckbox(taskCell, task, selection)
    const button = taskCell.createEl('button', { cls: 'cckb-task-link', text: task.title })
    button.addEventListener('click', () => interaction.openTask(task))
    row.createEl('td', { text: board.columns.find((column) => column.id === task.column)?.title ?? task.column })
    row.createEl('td', { text: task.due ?? '' })
    row.createEl('td', { text: task.priority ? '高' : '' })
    row.createEl('td', { text: task.tags.join(', ') })
    row.createEl('td', { text: task.assignees.join(', ') })
    row.createEl('td', { text: task.archived ? '已归档' : '' })
    iconButton(row.createEl('td'), 'more-horizontal', `任务操作: ${task.title}`, (event) => showTaskMenu(event, task, board, allTasks, interaction))
  }, { viewport: wrapper, rowTag: 'tr', estimate: 54, label: '任务数据表', initialIndex: focused < 0 ? undefined : focused,
    scrollTop: interaction.listScroll?.get('data'), onScroll: (top) => interaction.listScroll?.set('data', top) })
  if (!visible.length) wrapper.createEl('p', { text: '没有匹配的任务' })
  return dispose
}
