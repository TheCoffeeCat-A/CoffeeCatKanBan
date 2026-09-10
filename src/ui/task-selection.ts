import type { Task } from '../domain/model'

export interface TaskSelection {
  readonly isSelected: (taskId: string) => boolean
  readonly toggle: (task: Task, selected: boolean) => void
}

export function selectionCheckbox(container: HTMLElement, task: Task, selection: TaskSelection): HTMLInputElement {
  const checkbox = container.createEl('input', {
    cls: 'cckb-task-select', type: 'checkbox',
    attr: { 'aria-label': `选择任务: ${task.title}`, title: `选择任务: ${task.title}` },
  })
  checkbox.checked = selection.isSelected(task.id)
  checkbox.addEventListener('change', () => selection.toggle(task, checkbox.checked))
  return checkbox
}
