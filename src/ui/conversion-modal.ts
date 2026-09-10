import { Modal, Setting, type App } from 'obsidian'
import type { ConversionDraft, KanbanService } from '../contracts'
import type { Board } from '../domain/model'
import { propertiesOf } from '../domain/markdown'

export class ConversionModal extends Modal {
  private live = false
  private busy = false
  private boardId: string
  private columnId: string
  private preview: ConversionDraft | undefined

  constructor(app: App, private readonly path: string, private readonly boards: readonly Board[],
    private readonly service: Pick<KanbanService, 'previewConversion' | 'convertNote'>,
    private readonly converted: (boardId: string) => void) {
    super(app)
    this.boardId = boards[0]?.id ?? ''
    this.columnId = boards[0]?.defaultColumn ?? ''
  }

  override onOpen(): void {
    this.live = true
    this.titleEl.setText('将笔记加入看板')
    this.render()
  }

  private render(): void {
    this.contentEl.empty()
    this.contentEl.addClass('cckb-modal')
    new Setting(this.contentEl).setName('笔记').setDesc(this.path)
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    const board = this.boards.find((entry) => entry.id === this.boardId)
    if (!this.preview) {
      new Setting(fields).setName('看板').addDropdown((input) => {
        for (const entry of this.boards) input.addOption(entry.id, entry.title)
        input.setValue(this.boardId).onChange((value) => {
          if (this.busy || !this.live) return
          this.boardId = value
          this.columnId = this.boards.find((entry) => entry.id === value)?.defaultColumn ?? ''
          this.render()
        })
      })
      new Setting(fields).setName('状态').addDropdown((input) => {
        for (const column of board?.columns ?? []) input.addOption(column.id, column.title)
        input.setValue(this.columnId).onChange((value) => { if (!this.busy && this.live) this.columnId = value })
      })
    } else {
      new Setting(fields).setName('目标').setDesc(`${board?.title ?? ''} / ${board?.columns.find((column) => column.id === this.columnId)?.title ?? ''}`)
      const properties = propertiesOf(this.preview.content)
      const list = fields.createEl('dl')
      for (const [key, value] of Object.entries(properties)) {
        if (!key.startsWith('kanban_')) continue
        list.createEl('dt', { text: key })
        list.createEl('dd', { text: JSON.stringify(value) })
      }
      fields.createEl('p', { text: '将修改原笔记属性，保留路径与正文。此操作不进入属性撤销历史。' })
      new Setting(fields).addButton((button) => button.setButtonText('返回').onClick(() => {
        if (!this.busy && this.live) { this.preview = undefined; this.render() }
      }))
    }
    const errors = this.contentEl.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
    new Setting(fields).addButton((button) => button.setButtonText('取消').onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.preview ? '确认加入' : '预览').setCta().setDisabled(!board).onClick(() => {
        if (!this.live || this.busy || !board) return
        this.busy = true
        fields.disabled = true
        const preview = this.preview
        const operation = preview
          ? this.service.convertNote(preview).then((task) => {
            if (this.live) { this.busy = false; super.close(); this.converted(task.boardId) }
          })
          : this.service.previewConversion(this.path, this.boardId, this.columnId).then((result) => {
            if (this.live) { this.preview = result; this.render() }
          })
        void operation.catch((reason: unknown) => {
          if (this.live) errors.setText(reason instanceof Error ? reason.message : '加入看板失败')
        }).finally(() => { this.busy = false; if (this.live) fields.disabled = false })
      }))
  }

  override close(): void { if (!this.busy) super.close() }
  override onClose(): void { this.live = false; this.preview = undefined; this.contentEl.empty() }
}