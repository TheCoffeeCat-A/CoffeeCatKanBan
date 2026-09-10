import { Modal, Notice, Setting, type App } from 'obsidian'
import type { KanbanService, TaskDraft } from '../contracts'
import type { Task } from '../domain/model'
import type { TaskFileAction } from '../domain/task-files'

export class TaskFileModal extends Modal {
  private saving = false
  private live = false

  // Keep the reviewed file snapshot separate from editable property drafts
  // type: (App, TaskDraft, TaskFileAction, service, callback, guard) => TaskFileModal
  constructor(app: App, private readonly draft: TaskDraft, private readonly action: TaskFileAction,
    private readonly repository: Pick<KanbanService, 'copyTask' | 'deleteTask'>,
    private readonly changed: (copy?: Task) => void, private readonly available: () => boolean) {
    super(app)
  }

  // Display the exact note and consequences before any file mutation
  // type: () => void
  override onOpen(): void {
    this.live = true
    const deleting = this.action === 'delete'
    this.titleEl.setText(deleting ? '\u5220\u9664\u6574\u7bc7\u7b14\u8bb0' : '\u590d\u5236\u4efb\u52a1')
    this.contentEl.addClass('cckb-modal')
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    new Setting(fields).setName(this.draft.task.title).setDesc(this.draft.task.path)
    fields.createEl('p', { text: deleting
      ? '\u5c06\u6309 Obsidian \u56de\u6536\u8bbe\u7f6e\u5220\u9664\u8fd9\u6574\u7bc7\u7b14\u8bb0, \u4e0d\u5220\u9664\u5173\u8054\u7b14\u8bb0\u6216\u9644\u4ef6\u3002\u63d2\u4ef6\u5c5e\u6027\u64a4\u9500\u4e0d\u80fd\u6062\u590d\u6587\u4ef6'
      : '\u5728\u539f\u6587\u4ef6\u5939\u548c\u539f\u5217\u521b\u5efa\u72ec\u7acb\u526f\u672c, \u4fdd\u7559\u6b63\u6587\u3001\u4efb\u52a1\u5c5e\u6027\u548c\u6807\u7b7e, \u53d6\u6d88\u5f52\u6863\u3002\u4e0d\u590d\u5236 aliases\u3001\u5176\u4ed6\u81ea\u5b9a\u4e49\u5c5e\u6027\u6216\u9644\u4ef6\u6587\u4ef6' })
    const errors = this.contentEl.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
    new Setting(fields).addButton((button) => {
      button.setButtonText('\u53d6\u6d88').onClick(() => this.close())
    }).addButton((button) => {
      button.setButtonText(deleting ? '\u5220\u9664\u6574\u7bc7\u7b14\u8bb0' : '\u786e\u8ba4\u590d\u5236')
      if (deleting) button.setClass('mod-warning')
      else button.setCta()
      button.onClick(() => {
        if (this.saving || !this.live) return
        if (!this.available()) {
          errors.setText('\u539f\u770b\u677f\u5df2\u5173\u95ed\u6216\u5207\u6362, \u8bf7\u91cd\u65b0\u6253\u5f00\u786e\u8ba4')
          return
        }
        this.saving = true
        fields.disabled = true
        button.setDisabled(true)
        const operation = deleting ? this.repository.deleteTask(this.draft) : this.repository.copyTask(this.draft)
        void operation.then((copy) => {
          this.saving = false
          this.changed(copy || undefined)
          new Notice(deleting ? '\u7b14\u8bb0\u5df2\u6309\u5bbf\u4e3b\u56de\u6536\u8bbe\u7f6e\u5220\u9664' : '\u4efb\u52a1\u5df2\u590d\u5236')
          this.close()
        }).catch((reason: unknown) => {
          if (this.live) errors.setText(reason instanceof Error ? reason.message : '\u6587\u4ef6\u64cd\u4f5c\u5931\u8d25, \u8bf7\u91cd\u65b0\u8bfb\u53d6\u786e\u8ba4\u7ed3\u679c')
        }).finally(() => {
          this.saving = false
          if (this.live) { fields.disabled = false; button.setDisabled(false) }
        })
      })
    })
  }

  // Do not dismiss an in-flight host operation or allow a second submission
  // type: () => void
  override close(): void {
    if (!this.saving) super.close()
  }

  // Ignore late callbacks once the modal has been closed
  // type: () => void
  override onClose(): void {
    this.live = false
    this.contentEl.empty()
  }
}