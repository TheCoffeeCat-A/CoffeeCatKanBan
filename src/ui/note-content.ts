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
  const file = app.vault.getAbstractFileByPath(draft.task.path)
  const cache = file instanceof TFile ? app.metadataCache.getFileCache(file) : null
  section.createEl('h3', { text: '笔记链接与附件' })
  if (!cache) section.createEl('p', { text: '链接缓存尚未就绪, 请稍后重新打开任务' })
  else {
    const seen = new Set<string>()
    const references = [...(cache.links ?? []), ...(cache.embeds ?? [])]
    for (const reference of references) {
      const parsed = parseLinktext(reference.link)
      const target = app.metadataCache.getFirstLinkpathDest(parsed.path, draft.task.path)
      const key = target ? target.path + parsed.subpath : reference.link
      if (seen.has(key)) continue
      seen.add(key)
      const row = section.createDiv()
      if (!target) row.createSpan({ text: `失效链接: ${reference.link}` })
      else {
        const button = row.createEl('button', { text: target.path + parsed.subpath, attr: { type: 'button' } })
        button.addEventListener('click', () => {
          if (!live) return
          void app.workspace.openLinkText(reference.link, draft.task.path, 'tab').catch((reason: unknown) => {
            if (live) errors.setText(reason instanceof Error ? reason.message : '无法打开链接')
          })
        })
      }
    }
    if (!references.length) section.createEl('p', { text: '当前宿主缓存中没有正文链接' })
  }
  return () => { live = false; component.unload(); section.remove() }
}