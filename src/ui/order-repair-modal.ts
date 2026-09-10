import { Modal, Setting, type App } from 'obsidian'
import type { KanbanService } from '../contracts'
import type { Board } from '../domain/model'
import type { OrderRepairPlan } from '../domain/order-repair'
import { OperationReportModal } from './operation-report-modal'

export class OrderRepairModal extends Modal {
  private live = false
  private saving = false
  private generation = 0
  private plan: OrderRepairPlan | undefined

  constructor(app: App, private readonly board: Board,
    private readonly service: Pick<KanbanService, 'previewOrderRepair' | 'repairOrder'>,
    private readonly available: () => boolean, private readonly changed: () => void) { super(app) }

  override onOpen(): void {
    this.live = true
    this.titleEl.setText('修复列顺序')
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    let columnId = this.board.defaultColumn
    const preview = this.contentEl.createDiv()
    const errors = this.contentEl.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
    new Setting(fields).setName('目标列').setDesc('包含筛选隐藏及已归档任务').addDropdown((input) => {
      for (const column of this.board.columns) input.addOption(column.id, column.title)
      input.setValue(columnId).onChange((value) => { columnId = value; this.plan = undefined; this.generation += 1; preview.empty() })
    })
    new Setting(fields).addButton((button) => button.setButtonText('预览修复').onClick(() => {
      if (!this.live || this.saving || !this.available()) return
      const generation = ++this.generation
      this.plan = undefined
      preview.empty()
      errors.empty()
      void this.service.previewOrderRepair(this.board.id, columnId).then((plan) => {
        if (!this.live || generation !== this.generation || !this.available()) return
        this.plan = plan
        const list = preview.createEl('ol', { cls: 'cckb-batch-task-list' })
        for (const entry of plan.entries) list.createEl('li', {
          text: `${entry.task.title} (${entry.task.path})${entry.task.archived ? ' [已归档]' : ''}: ${entry.task.order ?? '缺失'} → ${entry.order}`,
        })
        if (!plan.entries.length) preview.createEl('p', { text: '该列没有任务' })
      }).catch((reason: unknown) => {
        if (this.live && generation === this.generation) errors.setText(reason instanceof Error ? reason.message : '预览失败')
      })
    })).addButton((button) => button.setButtonText('确认修复').setCta().onClick(() => {
      if (!this.live || this.saving || !this.available() || !this.plan?.entries.length) return
      this.saving = true
      fields.disabled = true
      void this.service.repairOrder(this.plan).then((report) => {
        this.changed()
        if (this.live) new OperationReportModal(this.app, '顺序修复结果', report).open()
        this.saving = false
        this.close()
      }).catch((reason: unknown) => {
        this.plan = undefined
        if (this.live) errors.setText(reason instanceof Error ? reason.message : '修复失败')
      }).finally(() => { this.saving = false; fields.disabled = false })
    })).addButton((button) => button.setButtonText('取消').onClick(() => this.close()))
  }

  override close(): void { if (!this.saving) super.close() }
  override onClose(): void { this.live = false; this.generation += 1; this.plan = undefined; this.contentEl.empty() }
}