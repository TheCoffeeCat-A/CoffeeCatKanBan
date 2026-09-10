import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian'
import { validateSettings, type KanbanSettings } from '../domain/settings'

export class KanbanSettingsTab extends PluginSettingTab {
  private saving = false
  private generation = 0
  private visible = false

  constructor(app: App, plugin: Plugin, private readonly current: () => KanbanSettings,
    private readonly save: (settings: KanbanSettings) => Promise<void>) { super(app, plugin) }

  override display(): void {
    this.visible = true
    const generation = ++this.generation
    const draft = { ...this.current() }
    this.containerEl.empty()
    const fields = this.containerEl.createEl('fieldset', { cls: 'cckb-form-fields' })
    fields.disabled = this.saving
    new Setting(fields).setName('默认视图').addDropdown((input) => {
      input.addOption('board', '看板').addOption('data', '数据表').addOption('calendar', '月历')
        .setValue(draft.defaultView).onChange((value) => { if (value === 'board' || value === 'data' || value === 'calendar') draft.defaultView = value })
    })
    new Setting(fields).setName('新建看板默认目录').addText((input) => input.setValue(draft.boardFolder).onChange((value) => { draft.boardFolder = value }))
    new Setting(fields).setName('新看板的默认任务目录').addText((input) => input.setValue(draft.taskFolder).onChange((value) => { draft.taskFolder = value }))
    new Setting(fields).setName('默认显示归档').addToggle((input) => input.setValue(draft.showArchived).onChange((value) => { draft.showArchived = value }))
    const status = this.containerEl.createDiv({ attr: { role: 'status' } })
    new Setting(fields).addButton((button) => button.setButtonText('保存').setCta().onClick(() => {
      if (this.saving || generation !== this.generation) return
      let settings: KanbanSettings
      try { settings = validateSettings(draft) } catch (reason) { status.setText(reason instanceof Error ? reason.message : '设置无效'); return }
      this.saving = true
      fields.disabled = true
      void this.save(settings).then(() => {
        if (generation === this.generation) status.setText('已保存')
      }).catch((reason: unknown) => {
        if (generation === this.generation) status.setText(reason instanceof Error ? reason.message : '保存失败')
      }).finally(() => {
        this.saving = false
        if (generation === this.generation) fields.disabled = false
        else if (this.visible) this.display()
      })
    }))
  }

  override hide(): void { this.visible = false; this.generation += 1 }
}