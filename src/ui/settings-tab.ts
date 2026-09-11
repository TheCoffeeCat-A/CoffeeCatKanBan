import { PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionRender } from 'obsidian'
import { validateSettings, type KanbanSettings } from '../domain/settings'

interface FormSession {
  draft: KanbanSettings
  rows: Setting[]
  status?: HTMLElement
}

type RenderDefinition = Omit<SettingDefinitionRender, 'render'> & {
  render: (setting: Setting) => void | (() => void)
}

export class KanbanSettingsTab extends PluginSettingTab {
  private saving = false
  private session: FormSession | undefined
  private pendingDraft: KanbanSettings | undefined

  constructor(app: App, plugin: Plugin, private readonly current: () => KanbanSettings,
    private readonly save: (settings: KanbanSettings) => Promise<void>) { super(app, plugin) }

  override getSettingDefinitions(): RenderDefinition[] {
    // Search indexing must create no DOM and reset no drafts.
    let session: FormSession | undefined
    const row = (name: string, configure: (setting: Setting, form: FormSession) => void): RenderDefinition => ({
      name,
      render: (setting) => {
        if (!session || !session.rows.length) { session = { draft: { ...(this.pendingDraft ?? this.current()) }, rows: [] }; this.session = session }
        session.rows.push(setting)
        setting.setDisabled(this.saving)
        configure(setting, session)
        return () => {
          if (!session) return
          session.rows = session.rows.filter((entry) => entry !== setting)
          if (!session.rows.length && this.session === session) this.session = undefined
        }
      },
    })
    const editable = (form: FormSession): boolean => this.session === form && !this.saving
    return [
      row('默认视图', (setting, form) => { setting.addDropdown((input) => {
        input.addOption('board', '看板').addOption('data', '数据表').addOption('calendar', '月历')
          .setValue(form.draft.defaultView).onChange((value) => {
            if (editable(form) && (value === 'board' || value === 'data' || value === 'calendar')) form.draft.defaultView = value
          })
      }) }),
      row('新建看板默认目录', (setting, form) => { setting.addText((input) => input.setValue(form.draft.boardFolder).onChange((value) => {
        if (editable(form)) form.draft.boardFolder = value
      })) }),
      row('新看板的默认任务目录', (setting, form) => { setting.setDesc('相对于看板所在目录, 留空为每个看板创建 "看板文件名-卡片" 子文件夹').addText((input) => input.setValue(form.draft.taskFolder).onChange((value) => {
        if (editable(form)) form.draft.taskFolder = value
      })) }),
      row('默认显示归档', (setting, form) => { setting.addToggle((input) => input.setValue(form.draft.showArchived).onChange((value) => {
        if (editable(form)) form.draft.showArchived = value
      })) }),
      row('保存默认设置', (setting, form) => {
        form.status = setting.descEl
        form.status.setAttribute('role', 'status')
        setting.addButton((button) => button.setButtonText('保存').setCta().onClick(() => {
          if (editable(form)) void this.saveForm(form)
        }))
      }),
    ]
  }

  // Required fallback for the declared minimum Obsidian version (1.10.0).
  override display(): void { this.renderLegacy() }

  private renderLegacy(): void {
    this.session = undefined
    this.containerEl.empty()
    for (const definition of this.getSettingDefinitions()) {
      const setting = new Setting(this.containerEl).setName(definition.name)
      definition.render(setting)
    }
  }

  private async saveForm(form: FormSession): Promise<void> {
    let settings: KanbanSettings
    try { settings = validateSettings(form.draft) }
    catch (reason) { form.status?.setText(reason instanceof Error ? reason.message : '设置无效'); return }
    this.saving = true
    this.pendingDraft = settings
    for (const row of form.rows) row.setDisabled(true)
    try {
      await this.save(settings)
      if (this.session === form) form.status?.setText('已保存')
    } catch (reason) {
      if (this.session === form) form.status?.setText(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      this.saving = false
      this.pendingDraft = undefined
      for (const row of this.session?.rows ?? []) row.setDisabled(false)
    }
  }

  override hide(): void { this.session = undefined }
}
