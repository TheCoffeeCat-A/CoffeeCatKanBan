import { MarkdownView, TFile, TFolder, type App } from 'obsidian'
import { KanbanError, validateNotePath } from '../domain/model'
import type { NoteSource } from '../domain/catalogue'
import type { NoteStore } from '../contracts'

export class ObsidianNoteStore implements NoteStore {
  constructor(private readonly app: App) {}

  listPaths(): readonly string[] {
    return this.app.vault.getMarkdownFiles().map((file) => file.path)
  }

  read(path: string): Promise<string> {
    return this.app.vault.read(this.file(path))
  }

  process(path: string, update: (content: string) => string): Promise<string> {
    return this.app.vault.process(this.file(path), update)
  }

  async convert(source: NoteSource, content: string, assertActive: () => void): Promise<string> {
    const file = await this.checkedFile(source.path, source.content, assertActive)
    return this.app.vault.process(file, (current) => {
      assertActive()
      if (current !== source.content || file.path !== source.path || this.file(source.path) !== file) {
        throw new KanbanError('CONFLICT', 'Note changed; reopen the conversion preview')
      }
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view
        if (view instanceof MarkdownView && view.file === file && view.editor.getValue() !== current) {
          throw new KanbanError('CONFLICT', 'Save the native editor changes before converting')
        }
      }
      return content
    })
  }

  async appendLink(source: NoteSource, targetPath: string, assertActive: () => void): Promise<string> {
    validateNotePath(targetPath)
    const target = this.file(targetPath)
    if (targetPath === source.path) throw new KanbanError('CONFLICT', 'Choose another note')
    const file = await this.checkedFile(source.path, source.content, assertActive)
    return this.app.vault.process(file, (current) => {
      assertActive()
      if (current !== source.content || file.path !== source.path || this.file(source.path) !== file
        || target.path !== targetPath || this.file(targetPath) !== target) {
        throw new KanbanError('CONFLICT', 'Note changed; reopen the task before linking')
      }
      for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view
        if (view instanceof MarkdownView && view.file === file && view.editor.getValue() !== current) {
          throw new KanbanError('CONFLICT', 'Save the native editor changes before linking')
        }
      }
      const link = this.app.fileManager.generateMarkdownLink(target, source.path)
      const newline = current.includes('\r\n') ? '\r\n' : '\n'
      return current + (current.endsWith('\n') ? newline : newline + newline) + link + newline
    })
  }

  async create(path: string, content: string, assertActive: () => void, source?: NoteSource): Promise<void> {
    validateNotePath(path)
    const folders = path.split('/').slice(0, -1)
    let current = ''
    for (const part of folders) {
      assertActive()
      current = current ? `${current}/${part}` : part
      const existing = this.app.vault.getAbstractFileByPath(current)
      if (existing && !(existing instanceof TFolder)) throw new KanbanError('CONFLICT', 'The destination folder is a file')
      if (!existing) {
        try {
          await this.app.vault.createFolder(current)
        } catch (reason) {
          if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw reason
        }
      }
    }
    assertActive()
    if (source) await this.checkedFile(source.path, source.content, assertActive)
    assertActive()
    if (this.app.vault.getAbstractFileByPath(path)) throw new KanbanError('CONFLICT', 'A file already exists at the destination')
    await this.app.vault.create(path, content)
  }

  // Respect the host trash preference after checking the reviewed note again
  // type: (string, string, () => void) => Promise<void>
  async trash(path: string, expectedContent: string, assertActive: () => void): Promise<void> {
    const file = await this.checkedFile(path, expectedContent, assertActive)
    assertActive()
    await this.app.fileManager.trashFile(file)
  }

  // Reject changed files and unsaved native editor content before copy or trash
  // type: (string, string, () => void) => Promise<TFile>
  private async checkedFile(path: string, expectedContent: string, assertActive: () => void): Promise<TFile> {
    validateNotePath(path)
    assertActive()
    const file = this.file(path)
    const content = await this.app.vault.read(file)
    assertActive()
    if (content !== expectedContent || file.path !== path || this.file(path) !== file) {
      throw new KanbanError('CONFLICT', 'Note changed since review; reopen the confirmation')
    }
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view
      if (view instanceof MarkdownView && view.file === file && view.editor.getValue() !== content) {
        throw new KanbanError('CONFLICT', 'Save the native editor changes before copying or deleting this note')
      }
    }
    return file
  }

  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile) || file.extension !== 'md') {
      throw new KanbanError('NOT_FOUND', 'The Markdown file was moved or deleted')
    }
    return file
  }
}