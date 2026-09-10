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
  setDisabled(value: boolean): this { this.disabled = value; return this }
  addOption(_id: string, _title: string): this { return this }
}

class SettingStub {
  name = ''
  readonly controls: ControlStub[] = []
  constructor(container: ElementStub) { container.settings.push(this) }
  setName(value: string): this { this.name = value; return this }
  setDesc(_value: string): this { return this }
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
  constructor(readonly app: unknown) {}
  open(): void { ModalStub.last = this; this.onOpen() }
  close(): void { this.closed = true; this.onClose() }
  onOpen(): void {}
  onClose(): void {}
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
    ? { Modal: ModalStub, ItemView: ViewStub, Setting: SettingStub, Menu: MenuStub, Notice: class {}, setIcon: () => undefined }
    : nativeRequire(name)
  new Function('module', 'exports', 'require', output)(result, result.exports, dependency)
  return result.exports[exportName]!
}

const Creation = loadModal('creation-modal.ts', 'CreationModal')
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
  await nextTurn()
  assert.equal(view.getState().boardId, board.id)
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
  assert.ok(stateSaves >= 3)
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

async function actionView() {
  const first = taskFixture('first')
  const second = { ...taskFixture('second', 'doing'), searchText: 'body-only needle' }
  const actions: { task: Task; action: TaskAction }[] = []
  const catalogue = { boards: [board], tasks: [first, second], diagnostics: [] }
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => catalogue, hasUndo: () => false,
    actOnTask: async (task: Task, action: TaskAction) => { actions.push({ task, action }) },
  }, () => undefined)
  await view.onOpen()
  await nextTurn()
  return { view, first, second, actions }
}

test('dragging a card uses its original snapshot and a target anchor without rewriting UI data', async () => {
  const { view, actions } = await actionView()
  const cards = view.contentEl.descendants().filter((element) => element.tagName === 'article')
  const handle = cards[0]!.descendants().find((element) => element.attributes.get('aria-label') === '\u62d6\u52a8\u4efb\u52a1')!
  handle.listeners.get('dragstart')!(dragEvent())
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
  const handle = cards[0]!.descendants().find((element) => element.attributes.get('aria-label') === '\u62d6\u52a8\u4efb\u52a1')!
  handle.listeners.get('dragstart')!(dragEvent())
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
  const handle = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u62d6\u52a8\u4efb\u52a1')!
  assert.equal(handle.draggable, false)
  const start = dragEvent()
  handle.listeners.get('dragstart')!(start)
  assert.equal(start.prevented, true)
  const more = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u4efb\u52a1\u64cd\u4f5c: second')!
  more.listeners.get('click')!({})
  assert.equal(MenuStub.last!.items.find((item) => item.title === '\u4e0a\u79fb')!.disabled, true)
  assert.equal(MenuStub.last!.items.find((item) => item.title === '\u4e0b\u79fb')!.disabled, true)
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
  assert.deepEqual(committed!.fields.find((field) => field.key === 'tags')!.after, { present: true, value: ['release', 'project/demo'] })
  assert.deepEqual(committed!.fields.find((field) => field.key === 'kanban_assignees')!.after, { present: true, value: ['Alice', 'Bob'] })
})

test('failed quick actions release the UI lock and double clicks do not enqueue duplicate writes', async () => {
  const task = taskFixture('first')
  let attempts = 0
  const view = new View({ app: { workspace: { requestSaveLayout: () => undefined } } }, {
    scan: async () => ({ boards: [board], tasks: [task], diagnostics: [] }), hasUndo: () => false,
    actOnTask: async () => { attempts += 1; if (attempts === 1) throw new Error('Disk unavailable') },
  }, () => undefined)
  await view.onOpen()
  await nextTurn()
  const findComplete = () => view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u5b8c\u6210: first')!
  const complete = findComplete()
  complete.listeners.get('click')!({})
  complete.listeners.get('click')!({})
  await nextTurn()
  assert.equal(attempts, 1)
  assert.equal(view.contentEl.attributes.get('aria-busy'), 'false')
  findComplete().listeners.get('click')!({})
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

test('dropping below add-task targets the column end, including an empty column', async () => {
  for (const columnId of ['doing', 'done']) {
    const { view, actions } = await actionView()
    const source = view.contentEl.descendants().find((element) => element.dataset.taskId === 'first')!
    const handle = source.descendants().find((element) => element.attributes.get('aria-label') === '\u62d6\u52a8\u4efb\u52a1')!
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
  const handle = view.contentEl.descendants().find((element) => element.attributes.get('aria-label') === '\u62d6\u52a8\u4efb\u52a1')!
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