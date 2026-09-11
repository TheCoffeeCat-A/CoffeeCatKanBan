import { Menu, setIcon } from 'obsidian'
import type { Board, Task } from '../domain/model'
import { calendarMonth, shiftMonth } from '../domain/calendar'
import { iconButton } from './controls'
import { showTaskMenu, type TaskInteraction } from './task-menu'
import { selectionCheckbox, type TaskSelection } from './task-selection'
import { renderVirtualList } from './virtual-list'

export function renderCalendar(container: HTMLElement, board: Board, visible: readonly Task[], allTasks: readonly Task[],
  interaction: TaskInteraction, monthValue: string, changeMonth: (month: string) => void, selection: TaskSelection,
  createTask: (date: string) => void): () => void {
  const month = calendarMonth(monthValue)
  const cleanup: (() => void)[] = []
  const renderTasks = (container: HTMLElement, tasks: readonly Task[], key: string): void => {
    const focused = tasks.findIndex((task) => task.id === interaction.focusTaskId)
    cleanup.push(renderVirtualList(container, tasks, (row, task) => renderCalendarTask(row, task, board, allTasks, interaction, selection), {
      estimate: 40, label: key, initialIndex: focused < 0 ? undefined : focused,
      scrollTop: interaction.listScroll?.get(key), onScroll: (top) => interaction.listScroll?.set(key, top),
    }))
  }
  const scroll = container.createDiv({ cls: 'cckb-data-scroll' })
  const wrapper = scroll.createDiv({ cls: 'cckb-calendar' })
  const header = wrapper.createDiv({ cls: 'cckb-calendar-header' })
  iconButton(header, 'chevron-left', '上一个月', () => {
    if (interaction.available()) changeMonth(shiftMonth(month.key, -1))
  })
  header.createEl('h3', { text: month.title })
  iconButton(header, 'chevron-right', '下一个月', () => {
    if (interaction.available()) changeMonth(shiftMonth(month.key, 1))
  })
  iconButton(header, 'calendar-check', '回到本月', () => {
    if (interaction.available()) changeMonth(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`)
  })

  const byDate = new Map<string, Task[]>()
  for (const task of visible) {
    if (!task.due) continue
    const tasks = byDate.get(task.due) ?? []
    tasks.push(task)
    byDate.set(task.due, tasks)
  }
  const grid = wrapper.createDiv({ cls: 'cckb-calendar-grid', attr: { role: 'grid', 'aria-label': month.title } })
  for (const weekday of ['一', '二', '三', '四', '五', '六', '日']) {
    grid.createDiv({ cls: 'cckb-calendar-weekday', text: weekday, attr: { role: 'columnheader' } })
  }
  const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
  for (const cell of month.cells) {
    const day = grid.createDiv({ cls: `cckb-calendar-day${cell.inMonth ? '' : ' cckb-calendar-day-outside'}${cell.date === today ? ' cckb-calendar-day-today' : ''}`, attr: { role: 'gridcell', 'aria-label': cell.date } })
    day.createEl('time', { text: String(cell.day), attr: { datetime: cell.date } })
    day.addEventListener('dblclick', () => {
      if (interaction.available()) createTask(cell.date)
    })
    day.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      if ((event.target as Element).closest('.cckb-calendar-task-row')) return
      if (!interaction.available()) return
      const menu = new Menu()
      menu.addItem((item) => item.setTitle('创建任务').setIcon('plus').onClick(() => {
        if (interaction.available()) createTask(cell.date)
      }))
      menu.showAtMouseEvent(event)
    })
    const tasks = day.createDiv({ cls: 'cckb-calendar-tasks' })
    if (cell.inMonth) {
      renderTasks(tasks, byDate.get(cell.date) ?? [], cell.date)
    }
  }

  const unplaced = visible.filter((task) => !task.due || !task.due.startsWith(`${month.key}-`))
  if (unplaced.length) {
    const list = wrapper.createDiv({ cls: 'cckb-calendar-unplaced' })
    list.createEl('h3', { text: '本月之外或无日期' })
    renderTasks(list, unplaced, '本月之外或无日期')
  }
  return () => { for (const dispose of cleanup) dispose() }
}

function renderCalendarTask(container: HTMLElement, task: Task, board: Board, allTasks: readonly Task[], interaction: TaskInteraction, selection: TaskSelection): void {
  const row = container.createDiv({ cls: 'cckb-calendar-task-row', attr: { 'data-task-id': task.id } })
  selectionCheckbox(row, task, selection)
  const button = row.createEl('button', { cls: `cckb-calendar-task${task.priority ? ' cckb-calendar-task-priority' : ''}${task.archived ? ' cckb-calendar-task-archived' : ''}`, attr: { type: 'button', 'aria-label': task.title, title: task.title } })
  if (task.priority) setIcon(button.createSpan({ cls: 'cckb-calendar-task-icon' }), 'flag')
  button.createSpan({ text: task.title })
  button.addEventListener('click', () => {
    if (interaction.available()) interaction.openTask(task)
  })
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    showTaskMenu(event, task, board, allTasks, interaction)
  })
}
