import { ItemView, Notice, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian'
import type { Catalogue } from '../domain/catalogue'
import { monthKey, parseMonthKey } from '../domain/calendar'
import type { Board, Task } from '../domain/model'
import { defaultQuery, queryTasks, readQuery, type TaskQuery } from '../domain/query'
import type { BatchTaskAction, TaskAction } from '../domain/task-actions'
import type { TaskFileAction } from '../domain/task-files'
import type { KanbanService } from '../contracts'
import { renderBoard } from './board-view'
import { BatchActionModal } from './batch-action-modal'
import { OperationReportModal } from './operation-report-modal'
import { OrderRepairModal } from './order-repair-modal'
import { ColumnsModal } from './columns-modal'
import { iconButton } from './controls'
import { CreationModal } from './creation-modal'
import { renderCalendar } from './calendar-view'
import { renderData } from './data-view'
import { renderQueryBar } from './query-bar'
import type { TaskInteraction } from './task-menu'
import type { TaskSelection } from './task-selection'
import { TaskPropertyModal } from './task-modal'
import { TaskFileModal } from './task-file-modal'
import { defaultSettings, type KanbanSettings } from '../domain/settings'

export const PROTOTYPE_VIEW = 'coffeecat-kanban-prototype'

export class PrototypeView extends ItemView {
  private boardId = ''
  private mode: 'board' | 'data' | 'calendar' = 'board'
  private calendarMonth = monthKey()
  private showArchived = false
  private closed = true
  private generation = 0
  private catalogue: Catalogue | undefined
  private undoing = false
  private acting = false
  private query: TaskQuery = defaultQuery()
  private disposeBoard: (() => void) | undefined
  private renderGeneration = 0
  private pendingFocus: string | undefined
  private searchInput: HTMLInputElement | undefined
  private fileModal: TaskFileModal | undefined
  private readonly selectedTasks = new Map<string, Task>()

  constructor(leaf: WorkspaceLeaf, private readonly repository: KanbanService,
    private readonly changed: () => void, private readonly settings: () => KanbanSettings = defaultSettings) {
    super(leaf)
    this.mode = settings().defaultView
    this.showArchived = settings().showArchived
  }

  override getViewType(): string { return PROTOTYPE_VIEW }
  override getDisplayText(): string { return 'CoffeeCatKanBan' }
  override getIcon(): string { return 'columns-3' }

  override getState(): Record<string, unknown> {
    return { boardId: this.boardId, mode: this.mode, calendarMonth: this.calendarMonth, showArchived: this.showArchived, query: this.query }
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    if (state && typeof state === 'object' && 'boardId' in state && typeof state.boardId === 'string') {
      this.boardId = state.boardId
    }
    if (state && typeof state === 'object') {
      if ('mode' in state) this.mode = state.mode === 'data' ? 'data' : state.mode === 'calendar' ? 'calendar' : 'board'
      if ('calendarMonth' in state && typeof state.calendarMonth === 'string' && parseMonthKey(state.calendarMonth)) {
        this.calendarMonth = state.calendarMonth
      }
      if ('showArchived' in state) this.showArchived = state.showArchived === true
      if ('query' in state) this.query = readQuery(state.query)
    }
    await super.setState(state, result)
    this.refresh()
  }

  override async onOpen(): Promise<void> {
    this.closed = false
    this.contentEl.addClass('cckb-prototype')
    this.refresh()
  }

  override async onClose(): Promise<void> {
    this.closed = true
    this.fileModal?.close()
    this.fileModal = undefined
    this.generation += 1
    this.renderGeneration += 1
    this.disposeBoard?.()
    this.disposeBoard = undefined
    this.searchInput = undefined
    this.pendingFocus = undefined
    this.catalogue = undefined
    this.contentEl.empty()
  }

  refresh(force = false): void {
    if (this.closed) return
    const generation = ++this.generation
    void this.repository.scan(force).then((catalogue) => {
      if (this.closed || generation !== this.generation) return
      this.catalogue = catalogue
      if (!this.boardId && catalogue.boards.length === 1) {
        this.boardId = catalogue.boards[0]!.id
        this.saveState()
      }
      this.render(catalogue)
    }).catch((reason: unknown) => {
      if (this.closed || generation !== this.generation) return
      this.disposeBoard?.()
      this.disposeBoard = undefined
      this.catalogue = undefined
      this.renderGeneration += 1
      this.contentEl.empty()
      this.contentEl.createEl('p', { cls: 'cckb-error', text: reason instanceof Error ? reason.message : '读取失败' })
      iconButton(this.contentEl, 'refresh-cw', '重新读取', () => this.refresh(true))
    })
  }

  canCreateTask(): boolean {
    return !this.closed && Boolean(this.catalogue?.boards.some((board) => board.id === this.boardId))
  }

  createTask(columnId?: string, due?: string): void {
    const board = this.catalogue?.boards.find((entry) => entry.id === this.boardId)
    if (!board || this.closed) return
    new CreationModal(this.app, this.repository, () => {
      if (!this.closed) {
        this.query = defaultQuery()
        this.saveState()
      }
      this.changed()
    }, board, columnId, due).open()
  }

  focusSearch(): void {
    if (!this.closed) this.searchInput?.focus()
  }

  private saveState(): void {
    if (!this.closed) this.app.workspace.requestSaveLayout()
  }

  private createBoard(): void {
    new CreationModal(this.app, this.repository, (boardId) => {
      if (!this.closed) {
        this.boardId = boardId
        this.query = defaultQuery()
        this.saveState()
      }
      this.changed()
    }, undefined, undefined, '', this.settings()).open()
  }

  private openNote(path: string): void {
    void this.app.workspace.openLinkText(path, '', 'tab').catch((reason: unknown) => {
      new Notice(reason instanceof Error ? reason.message : '无法打开笔记')
    })
  }

  private openTask(task: Task): void {
    void this.repository.draft(task.id).then((draft) => {
      if (!this.closed) new TaskPropertyModal(this.app, draft, this.repository, this.changed).open()
    }).catch((reason: unknown) => new Notice(reason instanceof Error ? reason.message : '读取失败'))
  }

  // Review fresh note data before exposing a copy or deletion confirmation
  // type: (Task, TaskFileAction) => void
  private openFileTask(task: Task, action: TaskFileAction): void {
    if (this.closed || this.acting || this.undoing) return
    this.acting = true
    void this.repository.draft(task.id).then((draft) => {
      if (this.closed || this.boardId !== draft.board.id) return
      this.fileModal = new TaskFileModal(this.app, draft, action, this.repository, (copy) => {
        if (copy && !this.closed && this.boardId === copy.boardId) {
          this.query = defaultQuery()
          this.pendingFocus = copy.id
          this.saveState()
        }
        this.changed()
      }, () => !this.closed && this.boardId === draft.board.id)
      this.fileModal.open()
    }).catch((reason: unknown) => {
      if (!this.closed) new Notice(reason instanceof Error ? reason.message : '读取失败')
    }).finally(() => { this.acting = false })
  }

  private act(task: Task, action: TaskAction): void {
    if (this.closed || this.acting || this.undoing) return
    this.acting = true
    this.pendingFocus = task.id
    this.contentEl.setAttribute('aria-busy', 'true')
    void this.repository.actOnTask(task, action).then(() => {
      this.changed()
    }).catch((reason: unknown) => {
      if (!this.closed) new Notice(reason instanceof Error ? reason.message : '任务操作失败')
    }).finally(() => {
      this.acting = false
      if (!this.closed) {
        this.contentEl.setAttribute('aria-busy', 'false')
        this.refresh()
      }
    })
  }

  // Open a guarded confirmation for the visible task selection
  // type: (Board, readonly Task[], BatchTaskAction) => void
  private openBatch(board: Board, tasks: readonly Task[], action: BatchTaskAction): void {
    if (this.closed || this.acting || this.undoing || !tasks.length) return
    this.acting = true
    new BatchActionModal(this.app, board, tasks, action, this.repository, (report) => {
      this.selectedTasks.clear()
      this.acting = false
      if (this.catalogue && !this.closed) this.render(this.catalogue)
      this.changed()
      this.refresh()
      if (report.results.some((result) => result.status === 'failed')) new Notice('批量操作部分失败')
    }, () => {
      this.acting = false
    }, () => !this.closed && !this.undoing).open()
  }

  private render(catalogue: Catalogue): void {
    const active = this.contentEl.ownerDocument?.activeElement
    const searchFocused = Boolean(this.searchInput && active === this.searchInput)
    this.disposeBoard?.()
    this.disposeBoard = undefined
    this.renderGeneration += 1
    this.searchInput = undefined
    this.contentEl.empty()
    const header = this.contentEl.createDiv({ cls: 'cckb-toolbar' })
    header.createEl('h1', { text: 'CoffeeCatKanBan' })
    const select = header.createEl('select', { attr: { 'aria-label': '看板' } })
    select.createEl('option', { value: '', text: '选择看板' })
    for (const board of catalogue.boards) select.createEl('option', { value: board.id, text: board.title })
    select.value = this.boardId
    select.addEventListener('change', () => {
      this.boardId = select.value
      this.query = defaultQuery()
      this.saveState()
      this.render(catalogue)
    })
    iconButton(header, 'folder-plus', '新建看板', () => this.createBoard())
    iconButton(header, 'refresh-cw', '重新读取', () => this.refresh(true))
    const board = catalogue.boards.find((entry) => entry.id === this.boardId)
    if (board) {
      iconButton(header, 'file-text', '打开看板笔记', () => this.openNote(board.path))
      iconButton(header, 'list-ordered', '修复列顺序', () => {
        if (this.closed || this.acting || this.undoing) return
        new OrderRepairModal(this.app, board, this.repository,
          () => !this.closed && this.boardId === board.id && !this.acting && !this.undoing, this.changed).open()
      })
      iconButton(header, 'settings-2', '管理看板列', () => {
        new ColumnsModal(this.app, board, this.repository, this.changed).open()
      })
      const undo = iconButton(header, 'undo-2', '撤销最近的属性操作', () => {
        if (this.undoing || this.acting) return
        this.undoing = true
        undo.disabled = true
        void this.repository.undo(board.id).then((report) => {
          this.changed()
          if (!this.closed) new OperationReportModal(this.app, '撤销结果', report).open()
        }).catch((reason: unknown) => {
          new Notice(reason instanceof Error ? reason.message : '撤销失败')
        }).finally(() => {
          this.undoing = false
          if (!this.closed) this.refresh()
        })
      })
      undo.disabled = this.undoing || this.acting || !this.repository.hasUndo(board.id)
      const create = header.createEl('button', { cls: 'mod-cta cckb-create-task', attr: { type: 'button' } })
      setIcon(create.createSpan(), 'plus')
      create.createSpan({ text: '新建任务' })
      create.addEventListener('click', () => this.createTask())
      const allTasks = catalogue.tasks.filter((task) => task.boardId === board.id)
      const toolbar = this.contentEl.createDiv({ cls: 'cckb-view-toolbar' })
      const tabs = toolbar.createDiv({ cls: 'cckb-view-tabs', attr: { role: 'group', 'aria-label': '显示方式' } })
      for (const mode of ['board', 'data', 'calendar'] as const) {
        const button = iconButton(tabs, mode === 'board' ? 'columns-3' : mode === 'data' ? 'table-2' : 'calendar-days',
          mode === 'board' ? '看板' : mode === 'data' ? '数据表' : '月历', () => {
          this.mode = mode
          this.saveState()
          this.render(catalogue)
        })
        button.setAttribute('aria-pressed', String(this.mode === mode))
      }
      const archive = toolbar.createEl('label', { cls: 'cckb-archive-filter' })
      const checkbox = archive.createEl('input', { type: 'checkbox' })
      checkbox.checked = this.showArchived
      checkbox.addEventListener('change', () => {
        this.showArchived = checkbox.checked
        this.saveState()
        this.render(catalogue)
      })
      archive.createSpan({ text: '显示归档' })
      const summary = toolbar.createSpan({ cls: 'cckb-summary', attr: { 'aria-live': 'polite' } })
      const batchActions = toolbar.createDiv({ cls: 'cckb-batch-actions', attr: { 'aria-live': 'polite' } })
      const filters = this.contentEl.createDiv()
      this.contentEl.createEl('h2', { cls: 'cckb-board-title', text: board.title })
      const results = this.contentEl.createDiv({ cls: 'cckb-results' })
      const renderResults = (): void => {
        this.disposeBoard?.()
        this.disposeBoard = undefined
        const renderGeneration = ++this.renderGeneration
        results.empty()
        const visible = queryTasks(allTasks, board.id, this.query, this.showArchived, undefined, board.doneColumn, board.columns)
        for (const taskId of [...this.selectedTasks.keys()]) {
          if (!visible.some((task) => task.id === taskId)) this.selectedTasks.delete(taskId)
        }
        summary.setText(`${visible.length} / ${allTasks.length} 个任务 · ${allTasks.filter((task) => task.archived).length} 个归档`)
        batchActions.empty()
        if (this.selectedTasks.size) {
          batchActions.createSpan({ cls: 'cckb-batch-count', text: `已选择 ${this.selectedTasks.size} 个` })
          const selected = [...this.selectedTasks.values()]
          const addBatch = (icon: string, label: string, action: BatchTaskAction): void => {
            const button = iconButton(batchActions, icon, label, () => this.openBatch(board, selected, action))
            button.disabled = this.acting || this.undoing
          }
          const completed = selected.every((task) => task.column === board.doneColumn)
          const archived = selected.every((task) => task.archived)
          addBatch(completed ? 'rotate-ccw' : 'check-check', completed ? '批量恢复选中任务' : '批量完成选中任务',
            { kind: 'complete', completed: !completed })
          addBatch(archived ? 'archive-restore' : 'archive', archived ? '批量取消归档' : '批量归档',
            { kind: 'archive', value: !archived })
        }
        const selection: TaskSelection = {
          isSelected: (taskId) => this.selectedTasks.has(taskId),
          toggle: (task, selected) => {
            if (selected) this.selectedTasks.set(task.id, task)
            else this.selectedTasks.delete(task.id)
            renderResults()
          },
        }
        const interaction: TaskInteraction = {
          openTask: (task) => this.openTask(task), openNote: (path) => this.openNote(path),
          act: (task, action) => this.act(task, action), manualOrder: this.query.sort === 'manual',
          fileAction: (task, action) => this.openFileTask(task, action),
          available: () => !this.closed && !this.acting && !this.undoing && renderGeneration === this.renderGeneration,
        }
        if (this.mode === 'board') this.disposeBoard = renderBoard(results, board, visible, allTasks, interaction, (columnId) => this.createTask(columnId), selection)
        else if (this.mode === 'data') renderData(results, board, visible, allTasks, interaction, selection)
        else renderCalendar(results, board, visible, allTasks, interaction, this.calendarMonth, (month) => {
          this.calendarMonth = month
          this.saveState()
          renderResults()
        }, selection, (date) => this.createTask(undefined, date))
        if (this.pendingFocus && !this.acting) {
          const target = [...results.querySelectorAll<HTMLElement>('[data-task-id]')].find((element) => element.dataset.taskId === this.pendingFocus)
            target?.querySelector<HTMLButtonElement>('.cckb-task-link, .cckb-calendar-task')?.focus()
          this.pendingFocus = undefined
        }
      }
      this.searchInput = renderQueryBar(filters, board, allTasks, this.query, (query) => {
        this.query = query
        this.saveState()
        renderResults()
      })
      renderResults()
      if (searchFocused) this.searchInput.focus()
    } else {
      const empty = this.contentEl.createDiv({ cls: 'cckb-empty' })
      empty.createEl('p', { text: this.boardId ? '所选看板不存在或存在数据冲突' : '未选择看板' })
      const button = empty.createEl('button', { cls: 'mod-cta', text: '新建看板' })
      button.addEventListener('click', () => this.createBoard())
    }
    if (catalogue.diagnostics.length) {
      const details = this.contentEl.createEl('details')
      details.createEl('summary', { text: `数据问题 (${catalogue.diagnostics.length})` })
      for (const diagnostic of catalogue.diagnostics) {
        const row = details.createDiv({ cls: 'cckb-diagnostic' })
        row.createEl('span', { text: `${diagnostic.path}: ${diagnostic.message}` })
        iconButton(row, 'file-text', '打开原笔记', () => this.openNote(diagnostic.path))
      }
    }
  }
}