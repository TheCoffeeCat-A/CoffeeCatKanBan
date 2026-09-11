import { Notice, Plugin, TFile } from 'obsidian'
import { ObsidianNoteStore } from './storage/obsidian-store'
import { TaskRepository } from './storage/repository'
import { CreationModal } from './ui/creation-modal'
import { ConversionModal } from './ui/conversion-modal'
import { defaultSettings, readSettings, type KanbanSettings } from './domain/settings'
import { KanbanSettingsTab } from './ui/settings-tab'
import { PROTOTYPE_VIEW, PrototypeView } from './ui/prototype-view'

export default class CoffeeCatKanBanPlugin extends Plugin {
  private preferences = defaultSettings()
  private repository: TaskRepository | undefined
  private refreshTimer: number | undefined

  override async onload(): Promise<void> {
    try { this.preferences = readSettings(await this.loadData()) }
    catch { new Notice('读取 CoffeeCatKanBan 设置失败，使用默认设置') }
    this.addSettingTab(new KanbanSettingsTab(this.app, this, () => this.preferences, async (settings: KanbanSettings) => {
      await this.saveData(settings)
      this.preferences = settings
    }))
    const repository = new TaskRepository(new ObsidianNoteStore(this.app), true)
    this.repository = repository
    this.registerView(PROTOTYPE_VIEW, (leaf) => new PrototypeView(leaf, repository, () => this.refreshViews(), () => this.preferences))
    this.addCommand({ id: 'open-data-prototype', name: '打开数据验证视图', callback: () => { void this.openBoard(undefined, 'data') } })
    this.addCommand({ id: 'open-board', name: '打开看板', callback: () => { void this.openBoard() } })
    this.addCommand({ id: 'create-board', name: '新建看板', callback: () => {
      new CreationModal(this.app, repository, (boardId) => {
        this.refreshViews()
        void this.openBoard(boardId)
      }, undefined, undefined, '', this.preferences).open()
    } })
    this.addCommand({ id: 'create-task', name: '在当前看板新建任务', checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(PrototypeView)
      if (!view?.canCreateTask()) return false
      if (!checking) view.createTask()
      return true
    } })
    this.addCommand({ id: 'search-tasks', name: '搜索当前看板任务', checkCallback: (checking) => {
      const view = this.app.workspace.getActiveViewOfType(PrototypeView)
      if (!view?.canCreateTask()) return false
      if (!checking) view.focusSearch()
      return true
    } })
    this.addCommand({ id: 'open-current-note-board', name: '打开当前笔记所属看板', checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile()
      if (!file || !this.isBoardOrTask(file)) return false
      if (!checking) void this.openForFile(file)
      return true
    } })
    this.addRibbonIcon('columns-3', 'CoffeeCatKanBan', () => { void this.openBoard() })
    this.addCommand({ id: 'convert-current-note', name: '将当前笔记加入看板', checkCallback: (checking) => {
      const file = this.app.workspace.getActiveFile()
      if (!file || file.extension !== 'md' || this.isBoardOrTask(file)) return false
      if (!checking) void this.convertFile(file)
      return true
    } })
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return
      if (!this.isBoardOrTask(file)) {
        menu.addItem((item) => item.setTitle('加入 CoffeeCatKanBan 看板').setIcon('list-plus').onClick(() => { void this.convertFile(file) }))
        return
      }
      menu.addItem((item) => item.setTitle('在 CoffeeCatKanBan 中打开').setIcon('columns-3').onClick(() => {
        void this.openForFile(file)
      }))
    }))
    // Open task notes in their board view when they are selected in the vault
    // type: (TFile | null) => void
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!(file instanceof TFile) || !this.isTaskFile(file)) return
      void this.openForFile(file)
    }))
    this.registerEvent(this.app.vault.on('create', (file) => { repository.invalidate(file instanceof TFile ? file.path : undefined); this.scheduleRefresh() }))
    this.registerEvent(this.app.vault.on('modify', (file) => { repository.invalidate(file.path); this.scheduleRefresh() }))
    this.registerEvent(this.app.vault.on('delete', (file) => { repository.invalidate(file instanceof TFile ? file.path : undefined); this.scheduleRefresh() }))
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      repository.invalidate(file instanceof TFile ? oldPath : undefined)
      repository.invalidate(file.path)
      this.scheduleRefresh()
    }))
    this.register(() => {
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
      repository.dispose()
    })
  }

  override onunload(): void {
    this.repository?.dispose()
  }

  private async convertFile(file: TFile): Promise<void> {
    try {
      const repository = this.repository
      const catalogue = await repository?.scan()
      if (!repository || !catalogue) return
      if (!catalogue.boards.length) { new Notice('请先新建一个有效看板'); return }
      new ConversionModal(this.app, file.path, catalogue.boards, repository, (boardId) => {
        this.refreshViews()
        void this.openBoard(boardId)
      }).open()
    } catch (reason) { new Notice(reason instanceof Error ? reason.message : '无法读取笔记') }
  }

  private isBoardOrTask(file: TFile): boolean {
    if (file.extension !== 'md') return false
    const kind: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.kanban_kind
    return kind === 'board' || kind === 'task'
  }

  // Check whether a vault file is a CoffeeCatKanBan task
  // type: (TFile) => boolean
  private isTaskFile(file: TFile): boolean {
    if (file.extension !== 'md') return false
    return this.app.metadataCache.getFileCache(file)?.frontmatter?.kanban_kind === 'task'
  }

  private async openForFile(file: TFile): Promise<void> {
    try {
      const catalogue = await this.repository?.scan()
      const board = catalogue?.boards.find((entry) => entry.path === file.path)
      const task = catalogue?.tasks.find((entry) => entry.path === file.path)
      const boardId = board?.id ?? task?.boardId
      if (!boardId) { new Notice('笔记的看板属性无效或存在身份冲突'); return }
      await this.openBoard(boardId)
    } catch (reason) {
      new Notice(reason instanceof Error ? reason.message : '无法打开看板')
    }
  }

  private async openBoard(boardId?: string, mode: 'board' | 'data' | 'calendar' = this.preferences.defaultView): Promise<void> {
    try {
      const leaf = this.app.workspace.getLeaf('tab')
      await leaf.setViewState({ type: PROTOTYPE_VIEW, active: true, state: { boardId: boardId ?? '', mode } })
      await this.app.workspace.revealLeaf(leaf)
    } catch (reason) {
      new Notice(reason instanceof Error ? reason.message : '无法打开看板')
    }
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(PROTOTYPE_VIEW)) {
      if (leaf.view instanceof PrototypeView) leaf.view.refresh()
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = undefined
      this.refreshViews()
    }, 100)
  }
}
