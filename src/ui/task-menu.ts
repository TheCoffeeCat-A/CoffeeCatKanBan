import { Menu } from 'obsidian'
import { compareTasks, type Board, type Task } from '../domain/model'
import type { TaskAction } from '../domain/task-actions'
import type { TaskFileAction } from '../domain/task-files'

export interface TaskInteraction {
  readonly openTask: (task: Task) => void
  readonly openNote: (path: string) => void
  readonly act: (task: Task, action: TaskAction) => void
  readonly fileAction: (task: Task, action: TaskFileAction) => void
  readonly available: () => boolean
  readonly manualOrder: boolean
}

export function showTaskMenu(event: MouseEvent, task: Task, board: Board, allTasks: readonly Task[], interaction: TaskInteraction): void {
  if (!interaction.available()) return
  const menu = new Menu()
  const command = (title: string, icon: string, action: TaskAction, disabled = false): void => {
    menu.addItem((item) => item.setTitle(title).setIcon(icon).setDisabled(disabled).onClick(() => {
      if (interaction.available()) interaction.act(task, action)
    }))
  }
  menu.addItem((item) => item.setTitle('编辑任务').setIcon('pencil').onClick(() => {
    if (interaction.available()) interaction.openTask(task)
  }))
  menu.addItem((item) => item.setTitle('打开原笔记').setIcon('file-text').onClick(() => interaction.openNote(task.path)))
  command(task.column === board.doneColumn ? '恢复任务' : '完成任务', 'check',
    { kind: 'complete', completed: task.column !== board.doneColumn })
  command(task.priority ? '取消高优先级' : '设为高优先级', 'flag', { kind: 'priority', value: !task.priority })
  command(task.archived ? '取消归档' : '归档任务', 'archive', { kind: 'archive', value: !task.archived })
  menu.addSeparator()
  for (const column of board.columns) {
    command(`移至${column.title}`, 'arrow-right', { kind: 'move', columnId: column.id }, column.id === task.column)
  }
  const column = allTasks.filter((entry) => entry.boardId === board.id && entry.column === task.column).sort(compareTasks)
  const position = column.findIndex((entry) => entry.id === task.id)
  menu.addSeparator()
  command('上移', 'arrow-up', { kind: 'reorder', direction: -1 }, !interaction.manualOrder || position <= 0)
  command('下移', 'arrow-down', { kind: 'reorder', direction: 1 }, !interaction.manualOrder || position < 0 || position >= column.length - 1)
  menu.addSeparator()
  for (const action of ['copy', 'delete'] as const) {
    menu.addItem((item) => item.setTitle(action === 'copy' ? '复制任务' : '删除笔记…')
      .setIcon(action === 'copy' ? 'copy' : 'trash-2').onClick(() => {
        if (interaction.available()) interaction.fileAction(task, action)
      }))
  }
  menu.showAtMouseEvent(event)
}