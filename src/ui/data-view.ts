import type { Board, Task } from '../domain/model'
import { iconButton } from './controls'
import { showTaskMenu, type TaskInteraction } from './task-menu'

export function renderData(container: HTMLElement, board: Board, visible: readonly Task[], allTasks: readonly Task[], interaction: TaskInteraction): void {
  const wrapper = container.createDiv({ cls: 'cckb-data-scroll' })
  const table = wrapper.createEl('table', { cls: 'cckb-table' })
  const heading = table.createEl('thead').createEl('tr')
  for (const label of ['任务', '状态', '截止日期', '优先级', '标签', '负责人', '归档', '操作']) heading.createEl('th', { text: label })
  const body = table.createEl('tbody')
  for (const task of visible) {
    const row = body.createEl('tr', { attr: { 'data-task-id': task.id } })
    const button = row.createEl('td').createEl('button', { cls: 'cckb-task-link', text: task.title })
    button.addEventListener('click', () => interaction.openTask(task))
    row.createEl('td', { text: board.columns.find((column) => column.id === task.column)?.title ?? task.column })
    row.createEl('td', { text: task.due ?? '' })
    row.createEl('td', { text: task.priority ? '高' : '' })
    row.createEl('td', { text: task.tags.join(', ') })
    row.createEl('td', { text: task.assignees.join(', ') })
    row.createEl('td', { text: task.archived ? '已归档' : '' })
    iconButton(row.createEl('td'), 'more-horizontal', `任务操作: ${task.title}`, (event) => showTaskMenu(event, task, board, allTasks, interaction))
  }
  if (!visible.length) wrapper.createEl('p', { text: '没有匹配的任务' })
}