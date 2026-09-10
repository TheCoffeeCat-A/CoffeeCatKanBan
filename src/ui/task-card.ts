import { setIcon } from 'obsidian'
import type { Board, Task } from '../domain/model'
import type { BoardDrag } from './board-drag'
import { iconButton } from './controls'
import { showTaskMenu, type TaskInteraction } from './task-menu'

export function renderTaskCard(container: HTMLElement, task: Task, board: Board, allTasks: readonly Task[],
  interaction: TaskInteraction, drag: BoardDrag): void {
  const card = container.createEl('article', { cls: 'cckb-card', attr: { 'data-task-id': task.id } })
  if (task.column === board.doneColumn) card.addClass('cckb-card-complete')
  if (task.archived) card.addClass('cckb-card-archived')
  const heading = card.createDiv({ cls: 'cckb-card-heading' })
  const complete = iconButton(heading, task.column === board.doneColumn ? 'square-check' : 'square',
    `${task.column === board.doneColumn ? '恢复' : '完成'}: ${task.title}`, () => {
      if (interaction.available()) interaction.act(task, { kind: 'complete', completed: task.column !== board.doneColumn })
    })
  complete.disabled = !interaction.available()
  complete.setAttribute('aria-pressed', String(task.column === board.doneColumn))
  const title = heading.createEl('h4').createEl('button', { cls: 'cckb-task-link', text: task.title, attr: { type: 'button' } })
  title.addEventListener('click', () => interaction.openTask(task))
  title.addEventListener('keydown', (event) => {
    if (!event.altKey || !interaction.manualOrder || !interaction.available() || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    interaction.act(task, { kind: 'reorder', direction: event.key === 'ArrowUp' ? -1 : 1 })
  })
  const more = iconButton(heading, 'more-horizontal', `任务操作: ${task.title}`, (event) => showTaskMenu(event, task, board, allTasks, interaction))
  more.disabled = !interaction.available()
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    showTaskMenu(event, task, board, allTasks, interaction)
  })
  if (task.tags.length) {
    const tags = card.createDiv({ cls: 'cckb-tags' })
    for (const tag of task.tags) tags.createSpan({ cls: 'cckb-tag', text: tag })
  }
  const metadata = card.createDiv({ cls: 'cckb-card-metadata' })
  if (task.due) {
    const date = metadata.createSpan({ cls: 'cckb-due' })
    setIcon(date.createSpan(), 'calendar-days')
    date.createEl('time', { text: task.due, attr: { datetime: task.due } })
  }
  if (task.priority) setIcon(metadata.createSpan({ cls: 'cckb-priority', attr: { 'aria-label': '高优先级', title: '高优先级' } }), 'flag')
  if (task.archived) metadata.createSpan({ text: '已归档' })
  if (task.assignees.length) card.createDiv({ cls: 'cckb-assignees', text: task.assignees.join(', ') })
  const footer = card.createDiv({ cls: 'cckb-card-tools' })
  iconButton(footer, 'file-text', '打开任务笔记', () => interaction.openNote(task.path))
  const handle = iconButton(footer, 'grip-vertical', '拖动任务', () => undefined)
  handle.addClass('cckb-drag-handle')
  handle.disabled = !interaction.manualOrder || !interaction.available()
  drag.bindSource(handle, card, task)
  drag.bindTarget(card, task.column, task)
}