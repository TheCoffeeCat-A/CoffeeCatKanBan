import { setIcon } from 'obsidian'
import type { Board, Task } from '../domain/model'
import type { BoardDrag } from './board-drag'
import { iconButton } from './controls'
import { showTaskMenu, type TaskInteraction } from './task-menu'
import { selectionCheckbox, type TaskSelection } from './task-selection'

export function renderTaskCard(container: HTMLElement, task: Task, board: Board, allTasks: readonly Task[],
  interaction: TaskInteraction, drag: BoardDrag, selection: TaskSelection): void {
  const card = container.createEl('article', { cls: 'cckb-card', attr: { 'data-task-id': task.id } })
  if (task.column === board.doneColumn) card.addClass('cckb-card-complete')
  if (task.archived) card.addClass('cckb-card-archived')
  const heading = card.createDiv({ cls: 'cckb-card-heading' })
  selectionCheckbox(heading, task, selection)
  const title = heading.createEl('h4').createEl('button', { cls: 'cckb-task-link', text: task.title, attr: { type: 'button' } })
  title.addEventListener('click', () => interaction.openTask(task))
  title.addEventListener('keydown', (event) => {
    if (!event.altKey || !interaction.manualOrder || !interaction.available() || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    interaction.act(task, { kind: 'reorder', direction: event.key === 'ArrowUp' ? -1 : 1 })
  })
  if (task.tags.length) {
    const tags = heading.createDiv({ cls: 'cckb-card-tags' })
    for (const tag of task.tags) tags.createSpan({ cls: 'cckb-tag', text: tag })
  }
  const more = iconButton(heading, 'more-horizontal', `任务操作: ${task.title}`, (event) => showTaskMenu(event, task, board, allTasks, interaction))
  more.disabled = !interaction.available()
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    showTaskMenu(event, task, board, allTasks, interaction)
  })
  const metadata = card.createDiv({ cls: 'cckb-card-metadata' })
  if (task.due) {
    const date = metadata.createSpan({ cls: 'cckb-due' })
    setIcon(date.createSpan(), 'calendar-days')
    date.createEl('time', { text: task.due, attr: { datetime: task.due } })
  }
  if (task.priority) setIcon(metadata.createSpan({ cls: 'cckb-priority', attr: { 'aria-label': '高优先级', title: '高优先级' } }), 'flag')
  if (task.archived) metadata.createSpan({ text: '已归档' })
  const footer = card.createDiv({ cls: 'cckb-card-tools' })
  const taskIndex = board.columns.findIndex((column) => column.id === task.column)
  const inProgress = task.column !== board.defaultColumn && task.column !== board.doneColumn
  const nextColumn = taskIndex >= 0 ? board.columns[taskIndex + 1] : undefined
  const startColumn = nextColumn?.id === board.doneColumn ? undefined : nextColumn
  if (task.column === board.defaultColumn || inProgress) {
    const label = inProgress ? '\u5b8c\u6210' : '\u5f00\u59cb'
    const status = footer.createEl('button', {
      cls: 'cckb-status-action mod-cta', text: label,
      attr: { type: 'button', 'aria-label': `${label}: ${task.title}` },
    })
    status.disabled = !interaction.available()
    status.addEventListener('click', () => {
      if (!interaction.available()) return
      if (inProgress || !startColumn) {
        interaction.act(task, { kind: 'complete', completed: true })
      } else {
        interaction.act(task, { kind: 'move', columnId: startColumn.id })
      }
    })
  }
  if (task.assignees.length) footer.createDiv({ cls: 'cckb-assignees', text: task.assignees.join(', ') })
  iconButton(footer, 'file-text', '打开任务笔记', () => interaction.openNote(task.path))
  drag.bindSource(card, task)
  drag.bindTarget(card, task.column, task)
}
