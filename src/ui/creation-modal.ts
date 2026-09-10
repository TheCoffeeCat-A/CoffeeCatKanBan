import { Modal, Notice, Setting, type App } from 'obsidian'
import type { Board } from '../domain/model'
import type { KanbanService } from '../contracts'
import { defaultSettings, type KanbanSettings } from '../domain/settings'

export class CreationModal extends Modal {
  private title = ''
  private folder = ''
  private taskFolder = 'Tasks'
  private columnId = ''
  private due = ''
  private dirty = false
  private saving = false
  private live = false
  private discardPrompt: HTMLElement | undefined

  constructor(app: App, private readonly repository: Pick<KanbanService, 'createBoard' | 'createTask'>,
    private readonly created: (boardId: string, taskId?: string) => void,
    private readonly board?: Board, columnId?: string, due = '', settings: KanbanSettings = defaultSettings()) {
    super(app)
    this.folder = settings.boardFolder
    this.taskFolder = settings.taskFolder
    this.columnId = columnId ?? board?.defaultColumn ?? ''
    this.due = due
  }

  override onOpen(): void {
    this.live = true
    this.titleEl.setText(this.board ? '新建任务' : '新建看板')
    this.contentEl.addClass('cckb-modal')
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    new Setting(fields).setName('标题').addText((input) => {
      input.inputEl.maxLength = 180
      input.onChange((value) => { this.title = value; this.dirty = true })
      input.inputEl.focus()
    })
    if (this.board) {
      new Setting(fields).setName('保存位置').setDesc(this.board.taskFolder || '库根目录')
      new Setting(fields).setName('状态').addDropdown((input) => {
        for (const column of this.board!.columns) input.addOption(column.id, column.title)
        input.setValue(this.columnId).onChange((value) => { this.columnId = value; this.dirty = true })
      })
      new Setting(fields).setName('截止日期').addText((input) => {
        input.inputEl.type = 'date'
        input.setValue(this.due)
        input.onChange((value) => { this.due = value; this.dirty = true })
      })
    } else {
      new Setting(fields).setName('看板文件夹').setDesc('相对于库根目录, 留空使用根目录').addText((input) => {
        input.setValue(this.folder).onChange((value) => { this.folder = value; this.dirty = true })
      })
      new Setting(fields).setName('新任务文件夹').setDesc('相对于库根目录').addText((input) => {
        input.setValue(this.taskFolder).onChange((value) => { this.taskFolder = value; this.dirty = true })
      })
    }
    const errors = this.contentEl.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
    new Setting(fields).addButton((button) => {
      button.setButtonText('取消').onClick(() => this.close())
    }).addButton((button) => {
      button.setButtonText('创建').setCta().onClick(() => {
        if (this.saving) return
        this.saving = true
        fields.disabled = true
        errors.empty()
        void this.create().then((result) => {
          this.dirty = false
          this.saving = false
          super.close()
          this.created(result.boardId, result.taskId)
          new Notice(this.board ? '任务已创建' : '看板已创建')
        }).catch((reason: unknown) => {
          if (this.live) errors.setText(reason instanceof Error ? reason.message : '创建失败')
        }).finally(() => {
          this.saving = false
          if (this.live) fields.disabled = false
        })
      })
    })
  }

  override close(): void {
    if (this.saving) return
    if (this.dirty) {
      if (this.discardPrompt) return
      const prompt = this.contentEl.createDiv({ attr: { role: 'alert' } })
      this.discardPrompt = prompt
      prompt.createEl('p', { text: '放弃尚未创建的草稿?' })
      new Setting(prompt).addButton((button) => {
        button.setButtonText('继续编辑').onClick(() => { prompt.remove(); this.discardPrompt = undefined })
      }).addButton((button) => {
        button.setButtonText('放弃').onClick(() => { this.dirty = false; this.close() })
      })
      return
    }
    super.close()
  }

  override onClose(): void {
    this.live = false
    this.discardPrompt = undefined
    this.contentEl.empty()
  }

  private async create(): Promise<{ boardId: string; taskId?: string }> {
    if (this.board) {
      const task = await this.repository.createTask({
        boardId: this.board.id, title: this.title, columnId: this.columnId,
        ...(this.due ? { due: this.due } : {}),
      })
      return { boardId: this.board.id, taskId: task.id }
    }
    const board = await this.repository.createBoard({ title: this.title, folder: this.folder.trim(), taskFolder: this.taskFolder.trim() })
    return { boardId: board.id }
  }
}
