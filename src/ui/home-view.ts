import { setIcon } from 'obsidian'
import type { Catalogue } from '../domain/catalogue'

// Render the board launcher with a prominent creation panel and existing board cards
// type: (HTMLElement, Catalogue, boolean, () => void, (string) => void) => void
export function renderHome(container: HTMLElement, catalogue: Catalogue, missing: boolean,
  create: () => void, open: (id: string) => void): void {
  const home = container.createDiv({ cls: 'cckb-home' })
  home.createEl('p', { cls: 'cckb-home-intro', text: '把想法整理成任务, 在看板中推进每一步' })
  if (missing) home.createEl('p', { cls: 'cckb-error', text: '所选看板不存在或存在数据冲突, 请重新选择看板' })
  const hero = home.createDiv({ cls: 'cckb-home-hero' })
  setIcon(hero.createSpan({ cls: 'cckb-home-icon' }), 'columns-3')
  hero.createEl('h2', { text: '从一个新看板开始' })
  hero.createEl('p', { text: '为工作、学习或生活建立看板, 用列组织任务, 用月历安排日期' })
  const createButton = hero.createEl('button', { cls: 'mod-cta cckb-home-create', attr: { type: 'button' } })
  setIcon(createButton.createSpan(), 'plus')
  createButton.createSpan({ text: '新建看板' })
  createButton.addEventListener('click', create)
  const heading = home.createDiv({ cls: 'cckb-home-heading' })
  heading.createEl('h2', { text: '我的看板' })
  heading.createSpan({ text: `${catalogue.boards.length} 个看板` })
  home.createEl('p', { cls: 'cckb-home-caption', text: catalogue.boards.length ? '选择一个看板, 继续你的计划' : '还没有看板, 创建后会显示在这里' })
  const grid = home.createDiv({ cls: 'cckb-home-grid' })
  const counts = new Map<string, number>()
  for (const task of catalogue.tasks) {
    if (!task.archived) counts.set(task.boardId, (counts.get(task.boardId) ?? 0) + 1)
  }
  for (const board of catalogue.boards) {
    const card = grid.createEl('button', { cls: 'cckb-home-card', attr: { type: 'button', 'aria-label': `打开看板: ${board.title}` } })
    const title = card.createSpan({ cls: 'cckb-home-card-title' })
    setIcon(title.createSpan({ cls: 'cckb-home-icon' }), 'columns-3')
    title.createSpan({ text: board.title })
    card.createSpan({ cls: 'cckb-home-card-path', text: board.path })
    card.createSpan({ cls: 'cckb-home-card-meta', text: `${counts.get(board.id) ?? 0} 个未归档任务 · ${board.columns.length} 个状态列` })
    card.addEventListener('click', () => open(board.id))
  }
}
