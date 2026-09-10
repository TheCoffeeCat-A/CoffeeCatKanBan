import { Component, FuzzySuggestModal, MarkdownRenderer, Setting, TFile, parseLinktext, type App } from 'obsidian'
import type { TaskDraft } from '../contracts'
import { parseNote } from '../domain/markdown'

class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly sourcePath: string, private readonly selected: (file: TFile) => void) {
    super(app)
  }
  getItems(): TFile[] { return this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.sourcePath) }
  getItemText(file: TFile): string { return file.path }
  onChooseItem(file: TFile): void { this.selected(file) }
}

export function renderNoteContent(app: App, container: HTMLElement, draft: TaskDraft,
  available: () => boolean, link: (path: string) => void): () => void {
  const component = new Component()
  component.load()
  let live = true
  const section = container.createDiv({ cls: 'cckb-note-content' })
  new Setting(section).setName('关联笔记').setDesc('向正文末尾追加链接, 不属于属性撤销').addButton((button) => {
    button.setButtonText('选择笔记').onClick(() => {
      if (live && available()) new NotePicker(app, draft.task.path, (file) => {
        if (live && available()) link(file.path)
      }).open()
    })
  })
  const errors = section.createDiv({ cls: 'cckb-error', attr: { role: 'alert' } })
  const preview = section.createDiv({ cls: 'markdown-rendered' })
  void MarkdownRenderer.render(app, parseNote(draft.content)?.body ?? '', preview, draft.task.path, component).catch((reason: unknown) => {
    if (live) errors.setText(reason instanceof Error ? reason.message : '正文预览失败')
  })
  section.createEl('h3', { text: '笔记链接与附件' })
  const list = section.createDiv({ cls: 'cckb-note-references' })
  let generation = 0
  const renderReferences = (): void => {
  if (!live) return
  const currentGeneration = ++generation
  list.empty()
  const file = app.vault.getAbstractFileByPath(draft.task.path)
  if (!(file instanceof TFile)) {
    list.createEl('p', { text: '源笔记已移动或删除, 请重新打开任务' })
    return
  }
  const cache = app.metadataCache.getFileCache(file)
  if (!cache) list.createEl('p', { text: '链接缓存尚未就绪' })
  else {
    const seen = new Set<string>()
    const references = [...(cache.links ?? []), ...(cache.embeds ?? [])]
    for (const reference of references) {
      const parsed = parseLinktext(reference.link)
      const target = parsed.path ? app.metadataCache.getFirstLinkpathDest(parsed.path, draft.task.path) : file
      const key = target ? target.path + parsed.subpath : reference.link
      if (seen.has(key)) continue
      seen.add(key)
      const row = list.createDiv()
      if (!target) row.createSpan({ text: `失效链接: ${reference.link}` })
      else {
        const button = row.createEl('button', { text: target.path + parsed.subpath, attr: { type: 'button' } })
        button.addEventListener('click', () => {
          if (!live || generation !== currentGeneration) return
          void app.workspace.openLinkText(reference.link, draft.task.path, 'tab').catch((reason: unknown) => {
            if (live && generation === currentGeneration) errors.setText(reason instanceof Error ? reason.message : '无法打开链接')
          })
        })
      }
    }
    if (!references.length) list.createEl('p', { text: '当前宿主缓存中没有正文链接' })
  }
  }
  component.registerEvent(app.metadataCache.on('changed', renderReferences))
  component.registerEvent(app.metadataCache.on('resolved', renderReferences))
  component.registerEvent(app.vault.on('rename', renderReferences))
  component.registerEvent(app.vault.on('delete', renderReferences))
  renderReferences()
  return () => { live = false; component.unload(); section.remove() }
}