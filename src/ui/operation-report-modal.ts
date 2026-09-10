import { Modal, Setting, type App } from 'obsidian'
import type { TaskOperationReport } from '../domain/task-actions'

export class OperationReportModal extends Modal {
  constructor(app: App, private readonly heading: string, private readonly report: TaskOperationReport) {
    super(app)
  }

  override onOpen(): void {
    this.titleEl.setText(this.heading)
    this.contentEl.addClass('cckb-modal')
    const labels = { success: '成功', skipped: '跳过', failed: '失败', 'not-executed': '未执行' }
    const list = this.contentEl.createEl('ul', { cls: 'cckb-batch-task-list' })
    for (const result of this.report.results) {
      const item = list.createEl('li', { text: `${labels[result.status]}: ${result.title}` })
      if (result.message) item.createEl('p', { text: result.message })
    }
    new Setting(this.contentEl).addButton((button) => button.setButtonText('关闭').onClick(() => this.close()))
  }

  override onClose(): void {
    this.contentEl.empty()
  }
}