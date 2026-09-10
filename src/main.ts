import { Notice, Plugin, TFile } from 'obsidian'
import { ObsidianNoteStore } from './storage/obsidian-store'
import { TaskRepository } from './storage/repository'
import { CreationModal } from './ui/creation-modal'
import { PROTOTYPE_VIEW, PrototypeView } from './ui/prototype-view'

export default class CoffeeCatKanBanPlugin extends Plugin {
  private repository: TaskRepository | undefined
  private refreshTimer: ReturnType<typeof setTimeout> | undefined

  override async onload(): Promise<void> {
    const repository = new TaskRepository(new ObsidianNoteStore(this.app))
    this.repository = repository
    this.registerView(PROTOTYPE_VIEW, (leaf) => new PrototypeView(leaf, repository, () => this.refreshViews()))
    this.addCommand({ id: 'open-data-prototype', name: '打开数据验证视图', callback: () => { void this.openBoard(undefined, 'data') } })
    this.addCommand({ id: 'open-board', name: '打开看板', callback: () => { void this.openBoard() } })
    this.addCommand({ id: 'create-board', name: '新建看板', callback: () => {
      new CreationModal(this.app, repository, (boardId) => {
        this.refreshViews()
        void this.openBoard(boardId)
      }).open()
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
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !this.isBoardOrTask(file)) return
      menu.addItem((item) => item.setTitle('在 CoffeeCatKanBan 中打开').setIcon('columns-3').onClick(() => {
        void this.openForFile(file)
      }))
    }))
    this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()))
    this.registerEvent(this.app.vault.on('modify', () => this.scheduleRefresh()))
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()))
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()))
    this.register(() => {
      if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
      repository.dispose()
    })
  }

  override onunload(): void {
    this.repository?.dispose()
  }

  private isBoardOrTask(file: TFile): boolean {
    if (file.extension !== 'md') return false
    const kind: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.kanban_kind
    return kind === 'board' || kind === 'task'
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

  private async openBoard(boardId?: string, mode: 'board' | 'data' = 'board'): Promise<void> {
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
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      this.refreshViews()
    }, 100)
  }
}