import { Modal, Notice, Setting, type App } from 'obsidian'
import { prepareChange, type TaskPatch } from '../domain/changes'
import { tagValues, textValues } from '../domain/query'
import type { KanbanService, TaskDraft } from '../contracts'

export class TaskPropertyModal extends Modal {
  private patch: TaskPatch = {}
  private saving = false
  private live = false
  private discardPrompt: HTMLElement | undefined

  constructor(app: App, private readonly draft: TaskDraft, private readonly repository: Pick<KanbanService, 'commit'>,
    private readonly changed: () => void) {
    super(app)
  }

  override onOpen(): void {
    this.live = true
    this.titleEl.setText(this.draft.task.title)
    this.contentEl.addClass('cckb-modal')
    const { task, board } = this.draft
    const fields = this.contentEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    new Setting(fields).setName('标题').addText((input) => {
      input.setValue(task.title).onChange((value) => {
        if (value === task.title) delete this.patch.kanban_title
        else this.patch.kanban_title = value
      })
    })
    new Setting(fields).setName('状态').addDropdown((input) => {
      for (const column of board.columns) input.addOption(column.id, column.title)
      input.setValue(task.column).onChange((value) => {
        delete this.patch.kanban_column
        delete this.patch.kanban_previous_column
        delete this.patch.kanban_order
        if (value !== task.column) {
          this.patch.kanban_column = value
          this.patch.kanban_order = undefined
          if (value === board.doneColumn) this.patch.kanban_previous_column = task.column
        }
      })
    })
    new Setting(fields).setName('截止日期').addText((input) => {
      input.inputEl.type = 'date'
      input.setValue(task.due ?? '').onChange((value) => {
        if (value === (task.due ?? '')) delete this.patch.kanban_due
        else this.patch.kanban_due = value || undefined
      })
    })
    new Setting(fields).setName('标签').setDesc('使用逗号或换行分隔').addText((input) => {
      input.setValue(task.tags.join(', ')).onChange((value) => {
        const tags = tagValues(value)
        if (JSON.stringify(tags) === JSON.stringify(task.tags)) delete this.patch.tags
        else this.patch.tags = tags
      })
    })
    new Setting(fields).setName('负责人').setDesc('仅保存本地名称, 不发送通知').addText((input) => {
      input.setValue(task.assignees.join(', ')).onChange((value) => {
        const assignees = textValues(value)
        if (JSON.stringify(assignees) === JSON.stringify(task.assignees)) delete this.patch.kanban_assignees
        else this.patch.kanban_assignees = assignees
      })
    })
    new Setting(fields).setName('高优先级').addToggle((input) => {
      input.setValue(task.priority).onChange((value) => {
        if (value === task.priority) delete this.patch.kanban_priority
        else this.patch.kanban_priority = value
      })
    })
    new Setting(fields).setName('归档').addToggle((input) => {
      input.setValue(task.archived).onChange((value) => {
        if (value === task.archived) delete this.patch.kanban_archived
        else this.patch.kanban_archived = value
      })
    })
    const errors = this.contentEl.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
    new Setting(fields).addButton((button) => {
      button.setButtonText('打开笔记').onClick(() => {
        void this.app.workspace.openLinkText(task.path, '', 'tab').catch((reason: unknown) => {
          if (this.live) errors.setText(reason instanceof Error ? reason.message : '无法打开笔记')
        })
      })
    }).addButton((button) => {
      button.setButtonText('保存属性').setCta().onClick(() => {
        if (this.saving) return
        this.saving = true
        fields.disabled = true
        button.setDisabled(true)
        void this.save().then(() => this.close()).catch((reason: unknown) => {
          if (this.live) errors.setText(reason instanceof Error ? reason.message : '保存失败')
        }).finally(() => {
          this.saving = false
          if (this.live) { button.setDisabled(false); fields.disabled = false }
        })
      })
    })
  }

  override close(): void {
    if (this.saving && Object.keys(this.patch).length) return
    if (Object.keys(this.patch).length) {
      if (this.discardPrompt) return
      const prompt = this.contentEl.createDiv({ attr: { role: 'alert' } })
      this.discardPrompt = prompt
      prompt.createEl('p', { text: '放弃未保存的属性修改?' })
      new Setting(prompt).addButton((button) => {
        button.setButtonText('继续编辑').onClick(() => {
          prompt.remove()
          this.discardPrompt = undefined
        })
      }).addButton((button) => {
        button.setButtonText('放弃修改').onClick(() => {
          this.patch = {}
          this.close()
        })
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

  private async save(): Promise<void> {
    const change = prepareChange(this.draft.content, this.patch)
    await this.repository.commit(change)
    this.patch = {}
    this.changed()
    new Notice(change.fields.length ? '属性已保存' : '没有属性变更')
  }
}