import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { setImmediate as nextTurn } from 'node:timers/promises'
import type { Board, Task } from '../src/domain/model'
import type { ColumnAction } from '../src/domain/columns'
import type { Catalogue } from '../src/domain/catalogue'
import type { TaskAction } from '../src/domain/task-actions'
import type { TaskChange } from '../src/domain/changes'
import { createNote } from '../src/domain/markdown'

class ElementStub {
  readonly children: ElementStub[] = []
  readonly settings: SettingStub[] = []
  textContent = ''
  disabled = false
  value = ''
  className = ''
  parent: ElementStub | undefined
  inputEl = this
  maxLength = 0
  type = ''
  checked = false
  draggable = false
  tagName = ''
  readonly ownerDocument = { activeElement: null as ElementStub | null }
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, (event?: unknown) => void>()

  createEl(tag: string, options: { cls?: string; text?: string; value?: string; type?: string; attr?: Record<string, string> } = {}): ElementStub {
    const child = new ElementStub()
    child.parent = this
    child.tagName = tag
    child.className = options.cls ?? ''
    child.textContent = options.text ?? ''
    child.value = options.value ?? ''
    child.type = options.type ?? ''
    for (const [key, value] of Object.entries(options.attr ?? {})) child.attributes.set(key, value)
    this.children.push(child)
    return child
  }
  createDiv(options = {}): ElementStub { return this.createEl('div', options) }
  createSpan(options = {}): ElementStub { return this.createEl('span', options) }
  addClass(name: string): void { this.className = [this.className, name].filter(Boolean).join(' ') }
  removeClass(...names: string[]): void { this.className = this.className.split(' ').filter((name) => !names.includes(name)).join(' ') }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  addEventListener(event: string, callback: (event?: unknown) => void): void { this.listeners.set(event, callback) }
  getBoundingClientRect(): { top: number; height: number } { return { top: 0, height: 100 } }
  focus(): void { this.ownerDocument.activeElement = this }
  get dataset(): { taskId?: string } {
    const taskId = this.attributes.get('data-task-id')
    return taskId === undefined ? {} : { taskId }
  }
  setText(value: string): void { this.textContent = value }
  empty(): void { this.children.length = 0; this.settings.length = 0 }
  remove(): void {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
  }
  querySelector(selector: string): ElementStub | null {
    for (const child of this.children) {
      if (child.className.split(' ').includes(selector.slice(1))) return child
      const found = child.querySelector(selector)
      if (found) return found
    }
    return null
  }
  querySelectorAll(selector: string): ElementStub[] {
    return this.descendants().filter((element) => selector === '[data-task-id]' && element.attributes.has('data-task-id'))
  }
  allSettings(): SettingStub[] {
    return [...this.settings, ...this.children.flatMap((child) => child.allSettings())]
  }
  descendants(): ElementStub[] { return this.children.flatMap((child) => [child, ...child.descendants()]) }
}

class ControlStub {
  inputEl = new ElementStub()
  value = ''
  label = ''
  disabled = false
  action: () => void = () => undefined
  change: (value: string) => void = () => undefined
  setValue(value: string): this { this.value = value; return this }
  onChange(callback: (value: string) => void): this { this.change = callback; return this }
  onClick(callback: () => void): this { this.action = callback; return this }
  setButtonText(value: string): this { this.label = value; return this }
  setTooltip(value: string): this { this.label = value; return this }
  setIcon(_value: string): this { return this }
  setCta(): this { return this }
  setWarning(): this { return this }
  setClass(_value: string): this { return this }
  setDisabled(value: boolean): this { this.disabled = value; return this }
  addOption(_id: string, _title: string): this { return this }
}

class SettingStub {
  name = ''
  readonly descEl: ElementStub
  disabled = false
  readonly controls: ControlStub[] = []
  constructor(container: ElementStub) { container.settings.push(this); this.descEl = container.createDiv() }
  setDisabled(value: boolean): this { this.disabled = value; return this }
  setName(value: string): this { this.name = value; return this }
  setDesc(value: string): this { this.descEl.setText(value); return this }
  addText(callback: (input: ControlStub) => void): this { return this.add(callback) }
  addDropdown(callback: (input: ControlStub) => void): this { return this.add(callback) }
  addToggle(callback: (input: ControlStub) => void): this { return this.add(callback) }
  addButton(callback: (input: ControlStub) => void): this { return this.add(callback) }
  addExtraButton(callback: (input: ControlStub) => void): this { return this.add(callback) }
  private add(callback: (input: ControlStub) => void): this {
    const input = new ControlStub()
    this.controls.push(input)
    callback(input)
    return this
  }
}

class ModalStub {
  static last: ModalStub | undefined
  contentEl = new ElementStub()
  titleEl = new ElementStub()
  closed = false
  constructor(readonly app: unknown) {
    const host = app as Record<string, unknown>
    host.vault ??= { getAbstractFileByPath: () => null, getMarkdownFiles: () => [], on: () => ({}) }
    host.metadataCache ??= { on: () => ({}) }
  }
  open(): void { ModalStub.last = this; this.onOpen() }
  close(): void { this.closed = true; this.onClose() }
  onOpen(): void {}
  onClose(): void {}
}

class PickerStub extends ModalStub {
  onChooseItem(_file: unknown): void {}
}

class ComponentStub {
  private events: { off?: () => void }[] = []
  load(): void {}
  registerEvent(event: { off?: () => void }): void { this.events.push(event) }
  unload(): void { for (const event of this.events) event.off?.(); this.events = [] }
}

class ReferenceFileStub {
  constructor(readonly path: string) {}
}

class ViewStub {
  readonly contentEl = new ElementStub()
  readonly app: unknown
  constructor(leaf: { app: unknown }) { this.app = leaf.app }
  async setState(_state: unknown, _result: unknown): Promise<void> {}
}

class MenuItemStub {
  title = ''
  disabled = false
  action: () => void = () => undefined
  setTitle(title: string): this { this.title = title; return this }
  setIcon(_icon: string): this { return this }
  setDisabled(value: boolean): this { this.disabled = value; return this }
  onClick(action: () => void): this { this.action = action; return this }
}

class MenuStub {
  static last: MenuStub | undefined
  readonly items: MenuItemStub[] = []
  addItem(configure: (item: MenuItemStub) => void): this {
    const item = new MenuItemStub()
    configure(item)
    this.items.push(item)
    return this
  }
  addSeparator(): this { return this }
  showAtMouseEvent(_event: unknown): void { MenuStub.last = this }
}

type ModalConstructor = new (...args: unknown[]) => ModalStub

function loadModal(filename: string, exportName: string): ModalConstructor {
  const output = buildSync({
    entryPoints: [resolve('src/ui', filename)], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  }).outputFiles[0]!.text
  const result = { exports: {} as Record<string, ModalConstructor> }
  const nativeRequire = createRequire(resolve('package.json'))
  const dependency = (name: string): unknown => name === 'obsidian'
    ? { Modal: ModalStub, ItemView: ViewStub, PluginSettingTab: class { containerEl = new ElementStub() }, Setting: SettingStub, Menu: MenuStub, Notice: class {}, setIcon: () => undefined,
      Component: ComponentStub, FuzzySuggestModal: PickerStub, TFile: ReferenceFileStub,
      parseLinktext: (link: string) => {
        const index = link.indexOf('#')
        return index < 0 ? { path: link, subpath: '' } : { path: link.slice(0, index), subpath: link.slice(index) }
      },
      MarkdownRenderer: { render: async (_app: unknown, body: string, container: ElementStub) => { container.setText(body) } } }
    : nativeRequire(name)
  new Function('module', 'exports', 'require', output)(result, result.exports, dependency)
  return result.exports[exportName]!
}

const Creation = loadModal('creation-modal.ts', 'CreationModal')
const Conversion = loadModal('conversion-modal.ts', 'ConversionModal')
const SettingsTab = loadModal('settings-tab.ts', 'KanbanSettingsTab') as unknown as new (...args: unknown[]) => {
  containerEl: ElementStub; display(): void; hide(): void
  getSettingDefinitions(): { name: string; render(setting: SettingStub): (() => void) }[]
}
const OperationReport = loadModal('operation-report-modal.ts', 'OperationReportModal')
const OrderRepair = loadModal('order-repair-modal.ts', 'OrderRepairModal')
const Columns = loadModal('columns-modal.ts', 'ColumnsModal')
const Properties = loadModal('task-modal.ts', 'TaskPropertyModal')
const TaskFile = loadModal('task-file-modal.ts', 'TaskFileModal')
type TestView = ViewStub & {
  onOpen(): Promise<void>
  onClose(): Promise<void>
  refresh(): void
  getState(): Record<string, unknown>
  canCreateTask(): boolean
}
const View = loadModal('prototype-view.ts', 'PrototypeView') as unknown as new (...args: unknown[]) => TestView
const board: Board = {
  id: '8db7d248-02c7-4f1e-9e21-5a7e945d9f01', path: 'Board.md', title: 'Board', taskFolder: 'Tasks',
  defaultColumn: 'todo', doneColumn: 'done',
  columns: [{ id: 'todo', title: 'Todo' }, { id: 'doing', title: 'Doing' }, { id: 'done', title: 'Done' }],
}

test('settings save failures retain drafts, block duplicates and ignore hidden controls', async () => {
  let attempts = 0
  const current = { defaultView: 'board', boardFolder: '', taskFolder: 'Tasks', showArchived: false }
  const tab = new SettingsTab({}, {}, () => current, async (settings: typeof current) => {
    attempts += 1
    if (attempts === 1) throw new Error('Save failed')
    Object.assign(current, settings)
  })
  tab.display()
  const folder = tab.containerEl.allSettings().find((entry) => entry.name === '新建看板默认目录')!.controls[0]!
  folder.change('Boards')
  const save = tab.containerEl.allSettings().flatMap((entry) => entry.controls).find((entry) => entry.label === '保存')!
  save.action()
  save.action()
  await nextTurn()
  assert.equal(attempts, 1)
  assert.equal(current.boardFolder, '')
  assert.ok(tab.containerEl.descendants().some((entry) => entry.textContent === 'Save failed'))
  save.action()
  await nextTurn()
  assert.equal(current.boardFolder, 'Boards')
  tab.hide()
  save.action()
  assert.equal(attempts, 2)
})

test('closing settings during a save does not redraw a hidden page', async () => {
  let finish!: () => void
  const tab = new SettingsTab({}, {}, () => ({ defaultView: 'board', boardFolder: '', taskFolder: 'Tasks', showArchived: false }),
    () => new Promise<void>((resolve) => { finish = resolve }))
  tab.display()
  const original = tab.containerEl.children[0]
  tab.containerEl.allSettings().flatMap((entry) => entry.controls).find((entry) => entry.label === '保存')!.action()
  tab.hide()
  finish()
  await nextTurn()
  assert.equal(tab.containerEl.children[0], original)
  assert.ok(!tab.containerEl.descendants().some((entry) => entry.textContent === '已保存'))
})

test('global defaults apply to new views and board drafts but restored state wins', async () => {
  const defaults = { defaultView: 'calendar', boardFolder: 'Boards', taskFolder: 'Work/Tasks', showArchived: true }
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks: [], diagnostics: [] }), hasUndo: () => false,
  }, () => undefined, () => defaults)
  assert.equal(view.getState().mode, 'calendar')
  assert.equal(view.getState().showArchived, true)
  await view.setState({ mode: 'data', showArchived: false }, {})
  assert.equal(view.getState().mode, 'data')
  assert.equal(view.getState().showArchived, false)
  const modal = new Creation({}, {}, () => undefined, undefined, undefined, '', defaults)
  modal.open()
  assert.equal(row(modal, '看板文件夹').controls[0]!.value, 'Boards')
  assert.equal(row(modal, '新任务文件夹').controls[0]!.value, 'Work/Tasks')
})

test('a view with one board stays on the board home until a board card is chosen', async () => {
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks: [], diagnostics: [] }), hasUndo: () => false,
  }, () => undefined)
  await view.onOpen()
  await nextTurn()
  assert.equal(view.getState().boardId, '')
  assert.ok(view.contentEl.descendants().some((element) => element.tagName === 'h1' && element.textContent === 'CoffeeCatKanBan'))
  assert.ok(view.contentEl.descendants().some((element) => element.textContent === '我的看板'))
  assert.equal(view.contentEl.descendants().some((element) => element.tagName === 'select'), false)
})

test('creation explains child folders and shows the resolved destination for legacy boards', () => {
  const creation = new Creation({}, {}, () => undefined)
  creation.open()
  assert.equal(row(creation, '新任务文件夹').controls[0]!.value, '')
  assert.match(row(creation, '新任务文件夹').descEl.textContent, /相对于看板所在目录/)
  for (const folder of ['', 'Plans', 'Tasks', 'Plans/Custom']) {
    const modal = new Creation({}, {}, () => undefined, { ...board, path: 'Plans/Board.md', taskFolder: folder })
    modal.open()
    assert.equal(row(modal, '保存位置').descEl.textContent, folder === 'Plans/Custom' ? folder : 'Plans/Board-卡片')
  }
})

test('conversion requires preview, prevents duplicate submissions and rejects closed controls', async () => {
  let previews = 0
  let writes = 0
  let finish!: () => void
  const task = taskFixture('converted')
  const service = {
    previewConversion: async () => { previews += 1; return { task, content: createNote({ kanban_kind: 'task' }) } },
    convertNote: async () => { writes += 1; await new Promise<void>((resolve) => { finish = resolve }); return task },
  }
  let completed = 0
  const modal = new Conversion({}, 'Existing.md', [board], service, () => { completed += 1 })
  modal.open()
  const preview = button(modal, '预览')
  preview.action()
  preview.action()
  await nextTurn()
  assert.equal(previews, 1)
  assert.equal(writes, 0)
  const confirm = button(modal, '确认加入')
  confirm.action()
  confirm.action()
  modal.close()
  assert.equal(modal.closed, false)
  assert.equal(writes, 1)
  finish()
  await nextTurn()
  assert.equal(completed, 1)
  assert.equal(modal.closed, true)
  confirm.action()
  assert.equal(writes, 1)
  const cancelled = new Conversion({}, 'Existing.md', [board], service, () => undefined)
  cancelled.open()
  const stale = button(cancelled, '预览')
  button(cancelled, '取消').action()
  stale.action()
  assert.equal(previews, 1)
})

test('note linking refreshes body preview and closed pickers cannot write', async () => {
  const draft = { task: taskFixture('linked'), board, content: '---\ncustom: value\n---\nOriginal body' }
  let writes = 0
  const service = {
    commit: async () => undefined,
    linkNote: async (expected: typeof draft, path: string) => {
      writes += 1
      assert.equal(path, 'Other.md')
      return { ...expected, content: expected.content + '\n[[Other]]\n' }
    },
  }
  const modal = new Properties({}, draft, service, () => undefined)
  modal.open()
  assert.equal(modal.contentEl.querySelector('.markdown-rendered')!.textContent, 'Original body')
  button(modal, '选择笔记').action()
  ;(ModalStub.last as PickerStub).onChooseItem({ path: 'Other.md' })
  await nextTurn()
  assert.equal(writes, 1)
  assert.ok(modal.contentEl.querySelector('.markdown-rendered')!.textContent.includes('[[Other]]'))
  button(modal, '选择笔记').action()
  const picker = ModalStub.last as PickerStub
  modal.close()
  picker.onChooseItem({ path: 'Other.md' })
  assert.equal(writes, 1)
})

test('operation report shows each undo outcome and visible failure details', () => {
  const modal = new OperationReport({}, '撤销结果', { results: [
    { taskId: 'one', title: 'First', status: 'success' },
    { taskId: 'two', title: 'Second', status: 'failed', message: 'External field conflict' },
    { taskId: 'three', title: 'Third', status: 'not-executed', message: 'Stopped' },
  ] })
  modal.open()
  const texts = modal.contentEl.descendants().map((element) => element.textContent)
  assert.ok(texts.includes('成功: First'))
  assert.ok(texts.includes('失败: Second'))
  assert.ok(texts.includes('External field conflict'))
  assert.ok(texts.includes('未执行: Third'))
  button(modal, '关闭').action()
  assert.equal(modal.closed, true)
})

test('calendar date creation prefills and submits the selected day', async () => {
  let submitted: unknown
  const service = {
    scan: async () => ({ boards: [board], tasks: [], diagnostics: [] }), hasUndo: () => false,
    createTask: async (input: unknown) => { submitted = input; return taskFixture('leap-task') },
  }
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, service, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id, mode: 'calendar', calendarMonth: '2028-02' }, {})
  await nextTurn()
  const create = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '2028-02-29')!
  assert.ok(create)
  create.listeners.get('dblclick')!({})
  const modal = ModalStub.last!
  assert.equal(row(modal, '截止日期').controls[0]!.value, '2028-02-29')
  row(modal, '标题').controls[0]!.change('Leap task')
  button(modal, '创建').action()
  await nextTurn()
  assert.deepEqual(submitted, { boardId: board.id, title: 'Leap task', columnId: 'todo', due: '2028-02-29' })
  assert.equal(modal.closed, true)
})

test('sort direction persists and clear restores disabled manual direction', async () => {
  const service = { scan: async () => ({ boards: [board], tasks: [], diagnostics: [] }), hasUndo: () => false }
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, service, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id }, {})
  await nextTurn()
  const control = (label: string) => view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === label)!
  const sort = control('显示排序')
  const direction = control('排序方向')
  assert.equal(direction.disabled, true)
  sort.value = 'column'
  sort.listeners.get('change')!()
  assert.equal(direction.disabled, false)
  direction.value = 'desc'
  direction.listeners.get('change')!()
  assert.deepEqual(view.getState().query, { text: '', column: '', tag: '', priorityOnly: false, due: '', sort: 'column', direction: 'desc' })
  control('清除筛选和排序').listeners.get('click')!({})
  assert.equal(direction.disabled, true)
  assert.equal(direction.value, 'asc')
})

function row(modal: ModalStub, name: string): SettingStub {
  const setting = modal.contentEl.allSettings().find((entry) => entry.name === name)
  assert.ok(setting, `Missing setting: ${name}`)
  return setting
}

function button(modal: ModalStub, label: string): ControlStub {
  const control = modal.contentEl.allSettings().flatMap((setting) => setting.controls).find((entry) => entry.label === label)
  assert.ok(control, `Missing control: ${label}`)
  return control
}

test('file confirmation cancels without writes and requires an available source view', async () => {
  let writes = 0
  const draft = { task: taskFixture('sample'), board, content: '# Note' }
  const service = { copyTask: async () => { writes += 1 }, deleteTask: async () => { writes += 1 } }
  const cancelled = new TaskFile({}, draft, 'delete', service, () => undefined, () => true)
  cancelled.open()
  button(cancelled, '\u53d6\u6d88').action()
  assert.equal(cancelled.closed, true)
  const stale = new TaskFile({}, draft, 'delete', service, () => undefined, () => false)
  stale.open()
  button(stale, '\u5220\u9664\u6574\u7bc7\u7b14\u8bb0').action()
  await nextTurn()
  assert.equal(writes, 0)
  assert.ok(stale.contentEl.querySelector('.cckb-error')!.textContent)
})

test('file confirmation locks double submit, retains failures and closes only after success', async () => {
  for (const action of ['copy', 'delete']) {
    let attempts = 0
    let changes = 0
    let release!: () => void
    const execute = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('Host operation rejected')
      await new Promise<void>((resolve) => { release = resolve })
      return action === 'copy' ? taskFixture('new-copy') : undefined
    }
    const modal = new TaskFile({}, { task: taskFixture('source'), board, content: '# Body' }, action,
      { copyTask: execute, deleteTask: execute }, () => { changes += 1 }, () => true)
    modal.open()
    const submit = button(modal, action === 'copy' ? '\u786e\u8ba4\u590d\u5236' : '\u5220\u9664\u6574\u7bc7\u7b14\u8bb0')
    submit.action()
    submit.action()
    await nextTurn()
    assert.equal(attempts, 1)
    assert.equal(changes, 0)
    assert.equal(modal.closed, false)
    assert.equal(modal.contentEl.querySelector('.cckb-error')!.textContent, 'Host operation rejected')
    submit.action()
    submit.action()
    modal.close()
    assert.equal(modal.closed, false)
    assert.equal(submit.disabled, true)
    release()
    await nextTurn()
    assert.equal(changes, 1)
    assert.equal(attempts, 2)
    assert.equal(modal.closed, true)
  }
})

test('file menus open confirmation without writing and closed views reject stale actions', async () => {
  const task = taskFixture('source')
  let drafts = 0
  let copies = 0
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks: [task], diagnostics: [] }), hasUndo: () => false,
    draft: async () => { drafts += 1; return { task, board, content: '# Body' } },
    copyTask: async () => { copies += 1; return taskFixture('copy') },
  }, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id }, {})
  await nextTurn()
  const more = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u4efb\u52a1\u64cd\u4f5c: source')!
  more.listeners.get('click')!({})
  const menu = MenuStub.last!
  menu.items.find((item) => item.title === '\u590d\u5236\u4efb\u52a1')!.action()
  await nextTurn()
  const modal = ModalStub.last!
  assert.equal(drafts, 1)
  assert.equal(copies, 0)
  const submit = button(modal, '\u786e\u8ba4\u590d\u5236')
  await view.onClose()
  submit.action()
  menu.items.find((item) => item.title === '\u5220\u9664\u7b14\u8bb0\u2026')!.action()
  await nextTurn()
  assert.equal(modal.closed, true)
  assert.equal(drafts, 1)
  assert.equal(copies, 0)
})

test('creation modal preserves failure drafts, blocks double submit and waits for durable creation', async () => {
  let attempts = 0
  let created = 0
  let finish!: () => void
  const modal = new Creation({}, {
    createBoard: async (input: { title: string }) => {
      attempts += 1
      assert.equal(input.title, 'My board')
      if (attempts === 1) throw new Error('Disk unavailable')
      await new Promise<void>((resolve) => { finish = resolve })
      return board
    },
  }, () => { created += 1 })
  modal.open()
  row(modal, '\u6807\u9898').controls[0]!.change('My board')
  const create = button(modal, '\u521b\u5efa')
  create.action()
  create.action()
  await nextTurn()
  assert.equal(attempts, 1)
  assert.equal(created, 0)
  assert.equal(modal.contentEl.querySelector('.cckb-error')!.textContent, 'Disk unavailable')
  assert.equal(modal.closed, false)
  create.action()
  modal.close()
  assert.equal(modal.closed, false)
  finish()
  await nextTurn()
  assert.equal(created, 1)
  assert.equal(modal.closed, true)
})

test('column modal keeps another edited title and pending new column across individual saves', async () => {
  let current = board
  const modal = new Columns({}, current, {
    editColumns: async (_expected: Board, action: ColumnAction) => {
      assert.equal(action.kind, 'rename')
      if (action.kind !== 'rename') throw new Error('Unexpected action')
      current = { ...current, columns: current.columns.map((column) => column.id === action.id ? { ...column, title: action.title } : column) }
      return current
    },
  }, () => undefined)
  modal.open()
  row(modal, 'Todo').controls[0]!.change('Ready')
  row(modal, 'Doing').controls[0]!.change('Active')
  row(modal, '\u65b0\u589e\u5217').controls[0]!.change('Review')
  row(modal, 'Todo').controls.find((entry) => entry.label === '\u4fdd\u5b58\u5217\u6807\u9898')!.action()
  await nextTurn()
  assert.equal(row(modal, 'Ready').controls[0]!.value, 'Ready')
  assert.equal(row(modal, 'Doing').controls[0]!.value, 'Active')
  assert.equal(row(modal, '\u65b0\u589e\u5217').controls[0]!.value, 'Review')
  modal.close()
  assert.equal(modal.closed, false)
  button(modal, '\u653e\u5f03').action()
  assert.equal(modal.closed, true)
})

test('column modal refuses structural edits until pending title drafts are handled', async () => {
  let edits = 0
  const modal = new Columns({}, board, { editColumns: async () => { edits += 1; return board } }, () => undefined)
  modal.open()
  row(modal, 'Todo').controls[0]!.change('Ready')
  row(modal, 'Doing').controls.find((entry) => entry.label === '\u5411\u524d\u79fb\u52a8')!.action()
  await nextTurn()
  assert.equal(edits, 0)
  assert.ok(modal.contentEl.querySelector('.cckb-error')!.textContent)
  assert.equal(row(modal, 'Todo').controls[0]!.value, 'Todo')
})

test('native board groups cards, toggles archived tasks and preserves data-view state', async () => {
  const catalogue: Catalogue = {
    boards: [board], diagnostics: [], tasks: [
      { id: 'first', path: 'First.md', boardId: board.id, title: 'First', column: 'todo', order: 'a0', archived: false, priority: false, tags: [], assignees: [] },
      { id: 'second', path: 'Second.md', boardId: board.id, title: 'Second', column: 'doing', order: 'a0', archived: true, priority: true, tags: ['tag'], assignees: ['Owner'] },
    ],
  }
  let stateSaves = 0
  const view = new View({ app: { workspace: { requestSaveLayout: () => { stateSaves += 1 } } } }, {
    scan: async () => catalogue, hasUndo: () => false,
  }, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id }, {})
  await nextTurn()
  assert.equal(view.getState().boardId, board.id)
  assert.ok(view.contentEl.descendants().some((element) => element.tagName === 'h1' && element.textContent === board.title))
  assert.equal(view.canCreateTask(), true)
  const elements = view.contentEl.descendants()
  assert.equal(elements.filter((entry) => entry.attributes.has('data-column-id')).length, 3)
  assert.equal(elements.filter((entry) => entry.attributes.has('data-task-id')).length, 1)
  const archived = elements.find((entry) => entry.type === 'checkbox')!
  archived.checked = true
  archived.listeners.get('change')!()
  assert.equal(view.contentEl.descendants().filter((entry) => entry.attributes.has('data-task-id')).length, 2)
  assert.equal(view.getState().showArchived, true)
  const table = view.contentEl.descendants().find((entry) => entry.attributes.get('aria-label') === '\u6570\u636e\u8868')!
  table.listeners.get('click')!()
  assert.equal(view.getState().mode, 'data')
  assert.equal(view.contentEl.descendants().filter((entry) => entry.tagName === 'table').length, 1)
  assert.deepEqual(view.contentEl.descendants().filter((entry) => entry.tagName === 'th').map((entry) => entry.textContent),
    ['任务', '状态', '截止日期', '优先级', '标签', '负责人', '归档', '操作'])
  assert.ok(stateSaves >= 2)
})

test('batch actions use only visible selections and clear them after confirmation', async () => {
  const first = taskFixture('first')
  const second = { ...taskFixture('second', 'doing'), archived: true }
  const selected: { boardId: string; tasks: readonly Task[]; action: TaskAction }[] = []
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks: [first, second], diagnostics: [] }), hasUndo: () => false,
    batchActOnTasks: async (boardId: string, tasks: readonly Task[], action: TaskAction) => {
      selected.push({ boardId, tasks, action })
      return { results: tasks.map((task) => ({ taskId: task.id, title: task.title, status: 'success' as const })) }
    },
  }, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id }, {})
  await nextTurn()
  const firstSelect = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '选择任务: first')!
  firstSelect.checked = true
  firstSelect.listeners.get('change')!()
  assert.equal(view.contentEl.descendants().filter((element) => element.attributes.get('aria-label')?.startsWith('选择任务:')).length, 1)
  const batch = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '批量完成选中任务')!
  batch.listeners.get('click')!({})
  const modal = ModalStub.last!
  assert.equal(modal.titleEl.textContent, '标记完成')
  assert.ok(modal.contentEl.descendants().some((element) => element.textContent === 'first'))
  button(modal, '标记完成').action()
  await nextTurn()
  assert.equal(selected.length, 1)
  assert.equal(selected[0]!.boardId, board.id)
  assert.deepEqual(selected[0]!.tasks.map((task) => task.id), ['first'])
  assert.deepEqual(selected[0]!.action, { kind: 'complete', completed: true })
  assert.equal(view.contentEl.descendants().filter((element) => element.attributes.get('aria-label') === '选择任务: first')
    .some((element) => element.checked), false)
  assert.equal(button(modal, '关闭').disabled, false)
  button(modal, '关闭').action()
  assert.equal(modal.closed, true)
  await view.onClose()
})

test('calendar view keeps dated and undated tasks visible and persists month navigation', async () => {
  const tasks: Task[] = [
    { ...taskFixture('in-month'), due: '2026-09-10', priority: true },
    { ...taskFixture('next-month'), due: '2026-10-01' },
    taskFixture('undated'),
  ]
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks, diagnostics: [] }), hasUndo: () => false,
    draft: async (id: string) => ({ task: tasks.find((task) => task.id === id)!, board, content: '# Body' }),
  }, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id, mode: 'calendar', calendarMonth: '2026-09' }, {})
  await nextTurn()
  assert.equal(view.getState().mode, 'calendar')
  assert.equal(view.getState().calendarMonth, '2026-09')
  assert.equal(view.contentEl.descendants().filter((entry) => entry.attributes.get('role') === 'gridcell').length, 42)
  assert.equal(view.contentEl.descendants().filter((entry) => entry.attributes.get('aria-label') === 'in-month').length, 1)
    const taskButton = view.contentEl.descendants().find((entry) => entry.attributes.get('aria-label') === 'in-month')!
    taskButton.listeners.get('click')!()
  assert.equal(view.contentEl.descendants().filter((entry) => entry.attributes.get('aria-label') === 'next-month').length, 1)
  assert.equal(view.contentEl.descendants().filter((entry) => entry.attributes.get('aria-label') === 'undated').length, 1)
  const next = view.contentEl.descendants().find((entry) => entry.attributes.get('aria-label') === '下一个月')!
  next.listeners.get('click')!({})
  assert.equal(view.getState().calendarMonth, '2026-10')
  const grid = view.contentEl.descendants().find((entry) => entry.attributes.get('role') === 'grid')!
  assert.equal(grid.descendants().filter((entry) => entry.attributes.get('aria-label') === 'in-month').length, 0)
  assert.equal(grid.descendants().filter((entry) => entry.attributes.get('aria-label') === 'next-month').length, 1)
  await view.onClose()
})

test('a closed native view ignores an outstanding asynchronous catalogue result', async () => {
  let finish!: (catalogue: Catalogue) => void
  const pending = new Promise<Catalogue>((resolve) => { finish = resolve })
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: () => pending, hasUndo: () => false,
  }, () => undefined)
  await view.onOpen()
  await view.onClose()
  finish({ boards: [board], tasks: [], diagnostics: [] })
  await nextTurn()
  assert.equal(view.contentEl.children.length, 0)
  assert.equal(view.canCreateTask(), false)
})

function taskFixture(id: string, column = 'todo'): Task {
  return { id, boardId: board.id, path: `${id}.md`, title: id, column, order: 'a0',
    priority: false, archived: false, tags: [], assignees: [] }
}

function dragEvent(clientY = 10) {
  return {
    clientY, prevented: false, stopped: false,
    dataTransfer: { effectAllowed: '', dropEffect: '', setData: (_type: string, _value: string) => undefined },
    preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true },
  }
}

async function actionView(additionalTasks: Task[] = []) {
  const first = taskFixture('first')
  const second = { ...taskFixture('second', 'doing'), searchText: 'body-only needle' }
  const actions: { task: Task; action: TaskAction }[] = []
  const catalogue = { boards: [board], tasks: [first, second, ...additionalTasks], diagnostics: [] }
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => catalogue, hasUndo: () => false,
    actOnTask: async (task: Task, action: TaskAction) => { actions.push({ task, action }) },
  }, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id }, {})
  await nextTurn()
  return { view, first, second, actions }
}

test('dragging a card uses its original snapshot and a target anchor without rewriting UI data', async () => {
  const { view, actions } = await actionView()
  const cards = view.contentEl.descendants().filter((element) => element.tagName === 'article')
  const source = cards[0]!
  source.listeners.get('dragstart')!(dragEvent())
  const drop = dragEvent(90)
  cards[1]!.listeners.get('drop')!(drop)
  await nextTurn()
  assert.equal(drop.stopped, true)
  assert.equal(actions.length, 1)
  assert.equal(actions[0]!.task.id, 'first')
  assert.equal(actions[0]!.action.kind, 'move')
  if (actions[0]!.action.kind === 'move') {
    assert.equal(actions[0]!.action.columnId, 'doing')
    assert.equal(actions[0]!.action.anchor!.id, 'second')
    assert.equal(actions[0]!.action.side, 'after')
  }
})

test('dropping onto the source is a no-op and external drag payloads cannot move tasks', async () => {
  const { view, actions } = await actionView()
  const cards = view.contentEl.descendants().filter((element) => element.tagName === 'article')
  cards[1]!.listeners.get('drop')!(dragEvent())
  assert.equal(actions.length, 0)
  const source = cards[0]!
  source.listeners.get('dragstart')!(dragEvent())
  const drop = dragEvent()
  cards[0]!.listeners.get('drop')!(drop)
  assert.equal(drop.stopped, true)
  assert.equal(actions.length, 0)
})

test('search filters only result elements and non-manual sorts disable drag and reorder menus', async () => {
  const { view, actions } = await actionView()
  const search = view.contentEl.descendants().find((element) => element.type === 'search')!
  search.value = 'body-only needle'
  search.listeners.get('input')!()
  assert.ok(view.contentEl.descendants().includes(search))
  assert.deepEqual(view.contentEl.descendants().filter((element) => element.tagName === 'article').map((element) => element.dataset.taskId), ['second'])
  assert.equal(actions.length, 0)
  const sort = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u663e\u793a\u6392\u5e8f')!
  sort.value = 'due'
  sort.listeners.get('change')!()
  const handle = view.contentEl.descendants().find((element) => element.dataset.taskId === 'second')!
  assert.equal(handle.draggable, false)
  const start = dragEvent()
  handle.listeners.get('dragstart')!(start)
  assert.equal(start.prevented, true)
  const more = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u4efb\u52a1\u64cd\u4f5c: second')!
  more.listeners.get('click')!({})
  assert.equal(MenuStub.last!.items.find((item) => item.title === '\u4e0a\u79fb')!.disabled, true)
  assert.equal(MenuStub.last!.items.find((item) => item.title === '\u4e0b\u79fb')!.disabled, true)
})

test('status buttons start default tasks and complete in-progress tasks', async () => {
  const { view, actions } = await actionView()
  const start = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u5f00\u59cb: first')!
  start.listeners.get('click')!({})
  await nextTurn()
  const complete = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u5b8c\u6210: second')!
  complete.listeners.get('click')!({})
  await nextTurn()
  assert.deepEqual(actions.map(({ task, action }) => [task.id, action]), [
    ['first', { kind: 'move', columnId: 'doing' }],
    ['second', { kind: 'complete', completed: true }],
  ])
  await view.onClose()
})

test('menu and keyboard actions share the task action service and stale menus stop after view close', async () => {
  const { view, actions } = await actionView()
  const firstCard = view.contentEl.descendants().find((element) => element.dataset.taskId === 'first')!
  const more = firstCard.descendants().find((element) => element.attributes.get('aria-label') === '\u4efb\u52a1\u64cd\u4f5c: first')!
  more.listeners.get('click')!({})
  const stale = MenuStub.last!
  stale.items.find((item) => item.title === '\u5f52\u6863\u4efb\u52a1')!.action()
  await nextTurn()
  assert.equal(actions[0]!.action.kind, 'archive')
  const title = view.contentEl.descendants().find((element) => element.dataset.taskId === 'first')!.querySelector('.cckb-task-link')!
  const key = { key: 'ArrowDown', altKey: true, preventDefault: () => undefined, stopPropagation: () => undefined }
  title.listeners.get('keydown')!(key)
  await nextTurn()
  assert.equal(actions[1]!.action.kind, 'reorder')
  await view.onClose()
  stale.items.find((item) => item.title === '\u5b8c\u6210\u4efb\u52a1')!.action()
  assert.equal(actions.length, 2)
})

test('task property form normalizes tags and assignees and keeps drafts after failed saves', async () => {
  const task = taskFixture('bccfc80c-46f1-41f3-bbd5-1a643b9ad254')
  const content = createNote({ kanban_kind: 'task', kanban_schema: 1, kanban_id: task.id, kanban_board: board.id,
    kanban_column: 'todo', kanban_order: 'a0', kanban_title: task.title, tags: [], kanban_assignees: [] })
  let attempts = 0
  let committed: TaskChange | undefined
  const modal = new Properties({}, { task, board, content }, {
    commit: async (change: TaskChange) => {
      attempts += 1
      if (attempts === 1) throw new Error('Save rejected')
      committed = change
    },
  }, () => undefined)
  modal.open()
  row(modal, '\u7c7b\u578b').controls[0]!.change('Feature')
  row(modal, '\u6807\u7b7e').controls[0]!.change('#release,release,project/demo')
  row(modal, '\u8d1f\u8d23\u4eba').controls[0]!.change('Alice, Bob, Alice')
  const save = button(modal, '\u4fdd\u5b58\u5c5e\u6027')
  save.action()
  save.action()
  await nextTurn()
  assert.equal(attempts, 1)
  assert.equal(modal.closed, false)
  assert.equal(modal.contentEl.querySelector('.cckb-error')!.textContent, 'Save rejected')
  save.action()
  await nextTurn()
  assert.equal(modal.closed, true)
  assert.deepEqual(committed!.fields.find((field) => field.key === 'kanban_type')!.after, { present: true, value: 'Feature' })
  assert.deepEqual(committed!.fields.find((field) => field.key === 'tags')!.after, { present: true, value: ['release', 'project/demo'] })
  assert.deepEqual(committed!.fields.find((field) => field.key === 'kanban_assignees')!.after, { present: true, value: ['Alice', 'Bob'] })
})

test('status actions move tasks forward and failed actions release the UI lock', async () => {
  const task = taskFixture('first')
  let attempts = 0
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks: [task], diagnostics: [] }), hasUndo: () => false,
    actOnTask: async () => { attempts += 1; if (attempts === 1) throw new Error('Disk unavailable') },
  }, () => undefined)
  await view.onOpen()
  await view.setState({ boardId: board.id }, {})
  await nextTurn()
  const findStart = () => view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u5f00\u59cb: first')!
  const start = findStart()
  start.listeners.get('click')!({})
  start.listeners.get('click')!({})
  await nextTurn()
  assert.equal(attempts, 1)
  assert.equal(view.contentEl.attributes.get('aria-busy'), 'false')
  findStart().listeners.get('click')!({})
  await nextTurn()
  assert.equal(attempts, 2)
})

test('query state round-trips in a new view without issuing task actions', async () => {
  const { view } = await actionView()
  const search = view.contentEl.descendants().find((element) => element.type === 'search')!
  search.value = 'needle'
  search.listeners.get('input')!()
  const state = view.getState()
  const next = await actionView()
  await next.view.setState(state, {})
  await nextTurn()
  assert.deepEqual(next.view.getState().query, state.query)
  assert.deepEqual(next.view.contentEl.descendants().filter((element) => element.tagName === 'article').map((element) => element.dataset.taskId), ['second'])
  assert.equal(next.actions.length, 0)
})

test('dropping between cards targets the gap instead of the column top in the same or another column', async () => {
  for (const columnId of ['todo', 'doing']) {
    const upper = { ...taskFixture('upper', columnId), order: 'a1' }
    const lower = { ...taskFixture('lower', columnId), order: 'a2' }
    const { view, actions } = await actionView([upper, lower])
    const elements = view.contentEl.descendants()
    const source = elements.find((element) => element.dataset.taskId === 'first')!
    const handle = source
    const column = elements.find((element) => element.attributes.get('data-column-id') === columnId)!
    const upperCard = elements.find((element) => element.dataset.taskId === upper.id)!
    const lowerCard = elements.find((element) => element.dataset.taskId === lower.id)!
    upperCard.getBoundingClientRect = () => ({ top: 160, height: 160 })
    lowerCard.getBoundingClientRect = () => ({ top: 344, height: 100 })
    handle.listeners.get('dragstart')!(dragEvent())
    upperCard.listeners.get('dragover')!(dragEvent(300))
    assert.ok(upperCard.className.includes('cckb-drop-after'))
    const hover = dragEvent(332)
    column.listeners.get('dragover')!(hover)
    assert.equal(hover.prevented, true)
    assert.equal(hover.stopped, true)
    assert.equal(hover.dataTransfer.dropEffect, 'move')
    assert.ok(lowerCard.className.includes('cckb-drop-before'))
    assert.ok(!upperCard.className.includes('cckb-drop-after'))
    assert.ok(!column.className.includes('cckb-drop-column'))
    column.listeners.get('drop')!(dragEvent(332))
    await nextTurn()
    assert.equal(actions.length, 1)
    assert.equal(actions[0]!.task.id, 'first')
    assert.deepEqual(actions[0]!.action, { kind: 'move', columnId, anchor: lower, side: 'before' })
    assert.ok(!lowerCard.className.includes('cckb-drop-before'))
    assert.ok(!source.className.includes('cckb-dragging'))
    await view.onClose()
  }
})

test('dropping below add-task targets the column end, including an empty column', async () => {
  for (const columnId of ['doing', 'done']) {
    const { view, actions } = await actionView()
    const source = view.contentEl.descendants().find((element) => element.dataset.taskId === 'first')!
    const handle = source
    const column = view.contentEl.descendants().find((element) => element.attributes.get('data-column-id') === columnId)!
    assert.ok(column.querySelector('.cckb-add-task'))
    handle.listeners.get('dragstart')!(dragEvent())
    const hover = dragEvent(700)
    column.listeners.get('dragover')!(hover)
    assert.equal(hover.prevented, true)
    assert.equal(hover.dataTransfer.dropEffect, 'move')
    assert.ok(column.className.includes('cckb-drop-column'))
    const drop = dragEvent(700)
    column.listeners.get('drop')!(drop)
    await nextTurn()
    assert.equal(drop.stopped, true)
    assert.equal(actions.length, 1)
    assert.equal(actions[0]!.task.id, 'first')
    assert.deepEqual(actions[0]!.action, { kind: 'move', columnId })
    await view.onClose()
  }
})

test('expanded column targets still reject dragging in non-manual sort mode', async () => {
  const { view, actions } = await actionView()
  const sort = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u663e\u793a\u6392\u5e8f')!
  sort.value = 'title'
  sort.listeners.get('change')!()
  const handle = view.contentEl.descendants().find((element) => element.dataset.taskId === 'first')!
  const column = view.contentEl.descendants().find((element) => element.attributes.get('data-column-id') === 'done')!
  handle.listeners.get('dragstart')!(dragEvent())
  const hover = dragEvent(700)
  column.listeners.get('dragover')!(hover)
  column.listeners.get('drop')!(dragEvent(700))
  await nextTurn()
  assert.equal(hover.prevented, false)
  assert.equal(actions.length, 0)
  await view.onClose()
})

test('reference cache events refresh targets without replacing drafts and unload all listeners', async () => {
  const task = taskFixture('references')
  const source = new ReferenceFileStub(task.path)
  const target = new ReferenceFileStub('Folder/同名 笔记.md')
  const attachment = new ReferenceFileStub('Attachments/image.png')
  const listeners = new Map<string, Set<() => void>>()
  const on = (name: string, callback: () => void) => {
    const callbacks = listeners.get(name) ?? new Set<() => void>()
    callbacks.add(callback)
    listeners.set(name, callbacks)
    return { off: () => callbacks.delete(callback) }
  }
  const emit = (name: string) => { for (const callback of listeners.get(name) ?? []) callback() }
  let cache: { links: { link: string }[]; embeds: { link: string }[] } | null = null
  let targetExists = true
  const opened: string[][] = []
  const app = {
    vault: { getAbstractFileByPath: () => source, getMarkdownFiles: () => [source, target], on },
    metadataCache: { on, getFileCache: () => cache,
      getFirstLinkpathDest: (path: string, sourcePath: string) => {
        assert.equal(sourcePath, task.path)
        if (path === 'image.png') return attachment
        return targetExists && ['同名 笔记', 'Folder/同名 笔记.md'].includes(path) ? target : null
      } },
    workspace: { openLinkText: async (...args: string[]) => { opened.push(args) } },
  }
  const modal = new Properties(app, { task, board, content: '---\ncustom: value\n---\nBody' }, {}, () => undefined)
  modal.open()
  const title = row(modal, '标题').controls[0]!
  title.change('Unsaved title')
  const list = modal.contentEl.querySelector('.cckb-note-references')!
  assert.ok(list.descendants().some((element) => element.textContent === '链接缓存尚未就绪'))
  cache = { links: [{ link: '同名 笔记#Heading' }, { link: 'Folder/同名 笔记.md#Heading' },
    { link: '#^block' }, { link: 'Missing' }], embeds: [{ link: 'image.png' }] }
  emit('changed')
  const buttons = list.descendants().filter((element) => element.tagName === 'button')
  assert.equal(buttons.length, 3)
  assert.ok(list.descendants().some((element) => element.textContent === '失效链接: Missing'))
  assert.equal(row(modal, '标题').controls[0], title)
  for (const button of buttons) button.listeners.get('click')!()
  await nextTurn()
  assert.deepEqual(opened, [['同名 笔记#Heading', task.path, 'tab'], ['#^block', task.path, 'tab'], ['image.png', task.path, 'tab']])
  targetExists = false
  emit('resolved')
  assert.ok(list.descendants().some((element) => element.textContent === '失效链接: 同名 笔记#Heading'))
  buttons[0]!.listeners.get('click')!()
  assert.equal(opened.length, 3)
  title.change(task.title)
  modal.close()
  assert.ok([...listeners.values()].every((callbacks) => callbacks.size === 0))
  emit('changed')
  assert.equal(modal.contentEl.children.length, 0)
})

test('order repair requires preview, rejects unavailable views and locks repeated submissions', async () => {
  let writes = 0
  let available = true
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { release = resolve })
  const task = taskFixture('repair')
  const service = {
    previewOrderRepair: async () => ({ board, columnId: 'todo', entries: [{ task, order: 'a9' }] }),
    repairOrder: async () => { writes += 1; await pending; return { results: [] } },
  }
  const modal = new OrderRepair({}, board, service, () => available, () => undefined)
  modal.open()
  button(modal, '确认修复').action()
  assert.equal(writes, 0)
  button(modal, '预览修复').action()
  await nextTurn()
  assert.ok(modal.contentEl.descendants().some((element) => element.textContent.includes(task.path)))
  available = false
  button(modal, '确认修复').action()
  assert.equal(writes, 0)
  available = true
  button(modal, '确认修复').action()
  button(modal, '确认修复').action()
  assert.equal(writes, 1)
  modal.close()
  assert.equal(modal.closed, false)
  release!()
  await nextTurn()
  assert.equal(modal.closed, true)
})

test('declarative settings are searchable without resetting drafts and disposed rows cannot save', async () => {
  const current = { defaultView: 'board', boardFolder: '', taskFolder: 'Tasks', showArchived: false }
  let writes = 0
  const tab = new SettingsTab({}, {}, () => current, async (settings: typeof current) => { writes++; Object.assign(current, settings) })
  const definitions = tab.getSettingDefinitions()
  assert.equal(tab.containerEl.children.length, 0)
  assert.equal(definitions.length, 5)
  const cleanup = definitions.map((definition) => definition.render(new SettingStub(tab.containerEl).setName(definition.name)))
  tab.containerEl.allSettings()[1]!.controls[0]!.change('Boards')
  tab.getSettingDefinitions()
  const save = tab.containerEl.allSettings()[4]!.controls[0]!
  save.action()
  await nextTurn()
  assert.equal(current.boardFolder, 'Boards')
  for (const dispose of cleanup) dispose()
  save.action()
  assert.equal(writes, 1)
})

test('reopening settings during persistence keeps submitted values and unlocks the new form', async () => {
  let finish!: () => void
  const current = { defaultView: 'board', boardFolder: '', taskFolder: 'Tasks', showArchived: false }
  const tab = new SettingsTab({}, {}, () => current, async (settings: typeof current) => {
    await new Promise<void>((resolve) => { finish = resolve })
    Object.assign(current, settings)
  })
  tab.display()
  tab.containerEl.allSettings()[1]!.controls[0]!.change('Submitted')
  tab.containerEl.allSettings()[4]!.controls[0]!.action()
  tab.hide()
  tab.display()
  assert.equal(tab.containerEl.allSettings()[1]!.controls[0]!.value, 'Submitted')
  assert.ok(tab.containerEl.allSettings().every((row) => row.disabled))
  finish()
  await nextTurn()
  assert.ok(tab.containerEl.allSettings().every((row) => !row.disabled))
  assert.equal(current.boardFolder, 'Submitted')
})
