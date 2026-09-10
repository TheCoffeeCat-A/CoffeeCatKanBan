import { Modal, Notice, Setting, type App, type ButtonComponent } from 'obsidian'
import type { KanbanService } from '../contracts'
import type { Board, Task } from '../domain/model'
import type { BatchTaskAction, TaskOperationReport, TaskOperationResult } from '../domain/task-actions'

export class BatchActionModal extends Modal {
  private saving = false
  private finished = false
  private live = false
  private controller: AbortController | undefined

  constructor(app: App, private readonly board: Board, private readonly tasks: readonly Task[],
    private readonly action: BatchTaskAction, private readonly repository: Pick<KanbanService, 'batchActOnTasks'>,
    private readonly completed: (report: TaskOperationReport) => void, private readonly onClosed: () => void,
    private readonly available: () => boolean) {
    super(app)
  }

  override onOpen(): void {
    this.live = true
    this.titleEl.setText(this.actionTitle())
    this.contentEl.addClass('cckb-modal')
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    new Setting(fields).setName(`已选择 ${this.tasks.length} 个任务`).setDesc(this.board.title)
    const list = fields.createEl('ul', { cls: 'cckb-batch-task-list' })
    for (const task of this.tasks) list.createEl('li', { text: task.title })
    const errors = this.contentEl.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
    const report = this.contentEl.createDiv({ cls: 'cckb-batch-report', attr: { 'aria-live': 'polite' } })
    let close: ButtonComponent | undefined
    const buttons = new Setting(fields)
    buttons.addButton((button) => { close = button.setButtonText('取消').onClick(() => this.close()) })
    buttons.addButton((button) => {
      button.setButtonText(this.actionTitle()).setCta().onClick(() => {
        if (this.saving || this.finished || !this.live || !this.available()) return
        this.saving = true
        this.controller = new AbortController()
        fields.disabled = true
        button.setDisabled(true)
        void this.repository.batchActOnTasks(this.board.id, this.tasks, this.action, this.controller.signal).then((result) => {
          this.renderReport(report, result)
          this.completed(result)
          this.finished = true
          fields.disabled = false
          close?.setButtonText('关闭')
          button.setButtonText('已完成')
          button.setDisabled(true)
        }).catch((reason: unknown) => {
          if (this.live) errors.setText(reason instanceof Error ? reason.message : '批量操作失败')
        }).finally(() => {
          this.saving = false
          this.controller = undefined
          if (this.live && !this.finished) {
            fields.disabled = false
            button.setDisabled(false)
          }
        })
      })
    })
  }

  override close(): void {
    if (this.saving) {
      this.controller?.abort()
      return
    }
    super.close()
  }

  override onClose(): void {
    this.live = false
    this.controller?.abort()
    this.contentEl.empty()
    this.onClosed()
  }

  private actionTitle(): string {
    if (this.action.kind === 'complete') return this.action.completed ? '标记完成' : '恢复未完成'
    return this.action.value ? '归档选中' : '取消归档'
  }

  private renderReport(container: HTMLElement, report: TaskOperationReport): void {
    container.empty()
    const counts = new Map<TaskOperationResult['status'], number>()
    for (const result of report.results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1)
    container.createEl('p', { text: [...counts.entries()].map(([status, count]) => `${this.statusTitle(status)} ${count}`).join(' · ') })
    const list = container.createEl('ul')
    for (const result of report.results) {
      const item = list.createEl('li', { text: `${this.statusTitle(result.status)}: ${result.title}` })
      if (result.message) item.setAttribute('title', result.message)
    }
    if (report.results.some((result) => result.status === 'failed')) {
      new Notice('批量操作部分失败, 请查看结果')
    }
  }

  private statusTitle(status: TaskOperationResult['status']): string {
    return status === 'success' ? '成功' : status === 'skipped' ? '跳过' : status === 'failed' ? '失败' : '未执行'
  }
}
