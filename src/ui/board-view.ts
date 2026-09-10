import { setIcon } from 'obsidian'
import type { Board, Task } from '../domain/model'
import { BoardDrag } from './board-drag'
import { iconButton } from './controls'
import { renderTaskCard } from './task-card'
import type { TaskInteraction } from './task-menu'
import type { TaskSelection } from './task-selection'
import { renderVirtualList } from './virtual-list'

export function renderBoard(container: HTMLElement, board: Board, visible: readonly Task[], allTasks: readonly Task[],
  interaction: TaskInteraction, createTask: (columnId: string) => void, selection: TaskSelection): () => void {
  const drag = new BoardDrag(board.id, interaction.manualOrder, interaction.available, interaction.act)
  const cleanup: (() => void)[] = []
  const scroll = container.createDiv({ cls: 'cckb-board-scroll' })
  const grid = scroll.createDiv({ cls: 'cckb-board-grid', attr: { 'aria-label': board.title } })
  for (const column of board.columns) {
    const tasks = visible.filter((task) => task.column === column.id)
    const section = grid.createEl('section', { cls: 'cckb-column', attr: { 'aria-label': column.title, 'data-column-id': column.id } })
    const header = section.createDiv({ cls: 'cckb-column-header' })
    setIcon(header.createSpan({ cls: 'cckb-column-icon' }), column.id === board.doneColumn ? 'circle-check' : column.id === board.defaultColumn ? 'circle-dashed' : 'circle-dot')
    header.createEl('h3', { text: column.title })
    header.createSpan({ cls: 'cckb-column-count', text: String(tasks.length) })
    iconButton(header, 'plus', `在${column.title}中新建任务`, () => createTask(column.id))
    const cards = section.createDiv({ cls: 'cckb-cards' })
    const key = `board:${column.id}`
    const focused = tasks.findIndex((task) => task.id === interaction.focusTaskId)
    cleanup.push(renderVirtualList(cards, tasks, (row, task) => renderTaskCard(row, task, board, allTasks, interaction, drag, selection), {
      label: column.title, initialIndex: focused < 0 ? undefined : focused, estimate: 170,
      scrollTop: interaction.listScroll?.get(key), onScroll: (top) => interaction.listScroll?.set(key, top),
    }))
    if (!tasks.length) cards.createEl('p', { cls: 'cckb-column-empty', text: '暂无匹配任务' })
    const add = section.createEl('button', { cls: 'cckb-add-task', text: '添加任务', attr: { type: 'button' } })
    add.addEventListener('click', () => createTask(column.id))
    drag.bindTarget(section, column.id)
  }
  return () => { drag.dispose(); for (const dispose of cleanup) dispose() }
}
