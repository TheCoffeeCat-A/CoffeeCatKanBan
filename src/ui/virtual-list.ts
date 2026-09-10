import { VirtualLayout } from '../domain/virtual-layout'

export interface VirtualListOptions {
  viewport?: HTMLElement
  rowTag?: 'div' | 'tr'
  estimate?: number
  label: string
  initialIndex?: number | undefined
  scrollTop?: number | undefined
  onScroll?: (top: number) => void
}

// Small lists retain their native layout. Large lists keep only viewport rows,
// plus any focused/dragged row, connected to the document.
export function renderVirtualList<T>(container: HTMLElement, items: readonly T[],
  render: (row: HTMLElement, item: T, index: number) => void, options: VirtualListOptions): () => void {
  const win = container.ownerDocument?.defaultView
  const virtual = items.length > 80 && win && typeof ResizeObserver !== 'undefined'
  const rowTag = options.rowTag ?? 'div'
  const renderRow = (row: HTMLElement, index: number): void => {
    try { render(row, items[index]!, index) }
    catch {
      row.empty()
      const error = rowTag === 'tr' ? row.createEl('td', { attr: { colspan: '8' } }) : row
      error.createEl('p', { cls: 'cckb-error', text: `第 ${index + 1} 项显示失败，请重新读取` })
    }
  }
  if (!virtual) {
    for (let index = 0; index < items.length; index++) renderRow(container.createEl(rowTag), index)
    return () => undefined
  }

  const viewport = options.viewport ?? container.createDiv()
  // A separate viewport is used for tables; lists own an inner positioned layer.
  const content = options.viewport ? container : viewport.createDiv()
  viewport.addClass('cckb-virtual-viewport')
  viewport.setAttribute('tabindex', '0')
  viewport.setAttribute('aria-label', options.label)
  content.addClass('cckb-virtual-content')
  if (rowTag !== 'tr') content.setAttribute('role', 'list')
  const layout = new VirtualLayout(items.length, options.estimate ?? 160)
  const mounted = new Map<number, HTMLElement>()
  const indices = new WeakMap<Element, number>()
  let active = true
  let frame: number | undefined
  let forcedIndex: number | undefined = options.initialIndex
  let stickToEnd = false
  let initialScroll: number | undefined = options.scrollTop ?? 0
  const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex="0"]'

  const top = (): number => Math.max(0, viewport.scrollTop - (content.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop))
  const schedule = (): void => {
    if (active && frame === undefined) frame = win.requestAnimationFrame(() => { frame = undefined; update() })
  }
  const observer = new ResizeObserver((entries) => {
    if (!active) return
    const anchor = layout.indexAt(top())
    const before = layout.offset(anchor)
    // Newly mounted rows can overflow the old estimate before this callback.
    // Compare with the last committed content height, not that transient overflow.
    const atEnd = top() + viewport.clientHeight >= Number.parseFloat(content.style.height) - 2
    let changed = false
    for (const entry of entries) {
      const index = indices.get(entry.target)
      if (index !== undefined) changed = layout.measure(index, entry.target.getBoundingClientRect().height) || changed
    }
    if (changed) {
      stickToEnd = atEnd
      viewport.scrollTop += layout.offset(anchor) - before
      schedule()
    }
  })
  const mount = (index: number): HTMLElement => {
    const existing = mounted.get(index)
    if (existing) return existing
    const row = content.createEl(rowTag, { cls: 'cckb-virtual-row' })
    if (rowTag !== 'tr') {
      row.setAttribute('role', 'listitem')
      row.setAttribute('aria-posinset', String(index + 1))
      row.setAttribute('aria-setsize', String(items.length))
    } else row.setAttribute('aria-rowindex', String(index + 2))
    indices.set(row, index)
    mounted.set(index, row)
    renderRow(row, index)
    const next = [...mounted].filter(([other]) => other > index).sort(([a], [b]) => a - b)[0]?.[1]
    if (next) content.insertBefore(row, next)
    observer.observe(row)
    return row
  }
  const update = (): void => {
    if (!active) return
    content.style.height = `${layout.total}px`
    const endRequested = stickToEnd
    stickToEnd = false
    if (endRequested) viewport.scrollTop = viewport.scrollHeight
    if (initialScroll !== undefined) {
      viewport.scrollTop = initialScroll
      initialScroll = undefined
    }
    if (forcedIndex !== undefined) {
      viewport.scrollTop = layout.offset(forcedIndex)
      forcedIndex = undefined
    }
    const first = Math.max(0, layout.indexAt(Math.max(0, top() - 300)) - 1)
    const last = Math.min(items.length - 1, layout.indexAt(top() + (viewport.clientHeight || 600) + 300) + 1)
    for (const [index, row] of mounted) {
      if ((index < first || index > last) && !row.contains(container.ownerDocument.activeElement) && !row.querySelector('.cckb-dragging')) {
        observer.unobserve(row)
        row.remove()
        mounted.delete(index)
      }
    }
    for (let index = first; index <= last; index++) mount(index)
    // DOM order matches reading/tab order, including pinned rows outside the viewport.
    for (const [index, row] of mounted) {
      row.style.top = `${layout.offset(index)}px`
    }
    if (endRequested) viewport.scrollTop = viewport.scrollHeight
  }
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return
    const focused = container.ownerDocument.activeElement
    const entry = [...mounted].find(([, row]) => row.contains(focused))
    if (!entry) return
    const [index, row] = entry
    const controls = [...row.querySelectorAll<HTMLElement>(focusable)]
    if (focused !== controls[event.shiftKey ? 0 : controls.length - 1]) return
    const next = index + (event.shiftKey ? -1 : 1)
    if (next < 0 || next >= items.length) return
    event.preventDefault()
    const targetRow = mount(next)
    forcedIndex = next
    update()
    const targets = [...targetRow.querySelectorAll<HTMLElement>(focusable)]
    targets[event.shiftKey ? targets.length - 1 : 0]?.focus()
  }
  const scroll = (): void => { options.onScroll?.(viewport.scrollTop); schedule() }
  viewport.addEventListener('scroll', scroll, { passive: true })
  viewport.addEventListener('keydown', keydown)
  viewport.addEventListener('focusout', schedule)
  viewport.addEventListener('dragend', schedule)
  const viewportObserver = new ResizeObserver(schedule)
  viewportObserver.observe(viewport)
  update()
  return () => {
    active = false
    if (frame !== undefined) win.cancelAnimationFrame(frame)
    observer.disconnect()
    viewportObserver.disconnect()
    viewport.removeEventListener('scroll', scroll)
    viewport.removeEventListener('keydown', keydown)
    viewport.removeEventListener('focusout', schedule)
    viewport.removeEventListener('dragend', schedule)
    mounted.clear()
  }
}
