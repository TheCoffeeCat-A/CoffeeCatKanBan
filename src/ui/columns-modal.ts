import { Modal, Setting, type App } from 'obsidian'
import type { ColumnAction } from '../domain/columns'
import type { Board } from '../domain/model'
import type { KanbanService } from '../contracts'

export class ColumnsModal extends Modal {
  private busy = false
  private live = false
  private readonly titles = new Map<string, string>()
  private newTitle = ''
  private confirmDiscard: HTMLElement | undefined
  private error = ''

  constructor(app: App, private board: Board, private readonly repository: Pick<KanbanService, 'editColumns'>,
    private readonly changed: () => void) { super(app) }

  override onOpen(): void {
    this.live = true
    this.titleEl.setText('管理看板列')
    this.contentEl.addClass('cckb-modal')
    this.render()
  }

  override close(): void {
    if (this.busy) return
    if (this.hasDrafts()) {
      if (this.confirmDiscard) return
      const prompt = this.contentEl.createDiv({ attr: { role: 'alert' } })
      this.confirmDiscard = prompt
      prompt.createEl('p', { text: '放弃未保存的列标题?' })
      new Setting(prompt).addButton((button) => {
        button.setButtonText('继续编辑').onClick(() => { prompt.remove(); this.confirmDiscard = undefined })
      }).addButton((button) => {
        button.setButtonText('放弃').onClick(() => { this.titles.clear(); this.newTitle = ''; this.close() })
      })
      return
    }
    super.close()
  }

  override onClose(): void {
    this.live = false
    this.contentEl.empty()
  }

  private render(): void {
    this.contentEl.empty()
    this.confirmDiscard = undefined
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    this.board.columns.forEach((column, index) => {
      let title = this.titles.get(column.id) ?? column.title
      const role = column.id === this.board.defaultColumn ? '默认列' : column.id === this.board.doneColumn ? '完成列' : ''
      const row = new Setting(fields).setName(column.title).setDesc(role)
      row.addText((input) => {
        input.inputEl.setAttribute('aria-label', `${column.title}的新标题`)
        input.setValue(title).onChange((value) => {
          title = value
          if (value === column.title) this.titles.delete(column.id)
          else this.titles.set(column.id, value)
        })
      }).addExtraButton((button) => {
        button.setIcon('save').setTooltip('保存列标题').onClick(() => this.submit({ kind: 'rename', id: column.id, title }, fields))
      }).addExtraButton((button) => {
        button.setIcon('arrow-left').setTooltip('向前移动').setDisabled(index === 0)
          .onClick(() => this.submit({ kind: 'move', id: column.id, direction: -1 }, fields))
      }).addExtraButton((button) => {
        button.setIcon('arrow-right').setTooltip('向后移动').setDisabled(index === this.board.columns.length - 1)
          .onClick(() => this.submit({ kind: 'move', id: column.id, direction: 1 }, fields))
      }).addExtraButton((button) => {
        button.setIcon('trash-2').setTooltip('删除空列').setDisabled(Boolean(role)).onClick(() => {
          if (this.busy) return
          if (this.hasDrafts()) { this.showError('请先保存列标题'); return }
          const confirmation = new Modal(this.app)
          confirmation.titleEl.setText(`删除空列: ${column.title}?`)
          new Setting(confirmation.contentEl).addButton((cancel) => cancel.setButtonText('取消').onClick(() => confirmation.close()))
            .addButton((remove) => remove.setButtonText('删除').setWarning().onClick(() => {
              confirmation.close()
              this.submit({ kind: 'remove', id: column.id }, fields)
            }))
          confirmation.open()
        })
      })
    })
    new Setting(fields).setName('新增列').addText((input) => {
      input.inputEl.setAttribute('aria-label', '新列标题')
      input.setValue(this.newTitle).onChange((value) => { this.newTitle = value })
    }).addExtraButton((button) => {
      button.setIcon('plus').setTooltip('新增列').onClick(() => {
        this.submit({ kind: 'add', id: `column-${crypto.randomUUID()}`, title: this.newTitle }, fields)
      })
    })
    for (const kind of ['default', 'done'] as const) {
      new Setting(fields).setName(kind === 'default' ? '新任务默认列' : '完成列').addDropdown((input) => {
        const current = kind === 'default' ? this.board.defaultColumn : this.board.doneColumn
        for (const column of this.board.columns) input.addOption(column.id, column.title)
        input.setValue(current).onChange((id) => {
          input.setValue(current)
          this.submit({ kind, id }, fields)
        })
      })
    }
    this.contentEl.createDiv({ cls: 'cckb-error', text: this.error, attr: { role: 'alert' } })
  }

  private showError(message: string): void {
    this.error = message
    const output = this.contentEl.querySelector('.cckb-error')
    if (output) output.textContent = message
  }

  private hasDrafts(): boolean {
    return this.titles.size > 0 || this.newTitle.length > 0
  }

  private submit(action: ColumnAction, fields: HTMLFieldSetElement): void {
    if (this.busy || !this.live) return
    if (this.hasDrafts() && action.kind !== 'rename' && action.kind !== 'add') {
      this.showError('请先保存列标题')
      return
    }
    this.busy = true
    fields.disabled = true
    void this.repository.editColumns(this.board, action).then((board) => {
      this.board = board
      this.error = ''
      if (action.kind === 'rename') this.titles.delete(action.id)
      if (action.kind === 'add') this.newTitle = ''
      this.changed()
      if (this.live) this.render()
    }).catch((reason: unknown) => {
      if (this.live) this.showError(reason instanceof Error ? reason.message : '列更新失败')
    }).finally(() => {
      this.busy = false
      if (this.live) fields.disabled = false
    })
  }
}