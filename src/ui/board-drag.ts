import type { Task } from '../domain/model'
import type { TaskAction } from '../domain/task-actions'

export class BoardDrag {
  private source: Task | undefined
  private sourceElement: HTMLElement | undefined
  private target: HTMLElement | undefined
  private active = true
  private readonly anchors = new WeakMap<HTMLElement, Task>()

  constructor(private readonly boardId: string, private readonly enabled: boolean,
    private readonly available: () => boolean, private readonly act: (task: Task, action: TaskAction) => void) {}

  bindSource(handle: HTMLElement, card: HTMLElement, task: Task): void {
    handle.draggable = this.enabled
    handle.addEventListener('dragstart', (event) => {
      if (!this.active || !this.enabled || !this.available() || task.boardId !== this.boardId || !event.dataTransfer) {
        event.preventDefault()
        return
      }
      this.clear()
      this.source = task
      this.sourceElement = card
      event.dataTransfer.setData('application/x-coffeecat-kanban-task', task.id)
      event.dataTransfer.effectAllowed = 'move'
      card.addClass('cckb-dragging')
    })
    handle.addEventListener('dragend', () => this.clear())
  }

  bindTarget(element: HTMLElement, columnId: string, anchor?: Task): void {
    if (anchor) this.anchors.set(element, anchor)
    element.addEventListener('dragover', (event) => {
      if (this.active && this.source && anchor?.id === this.source.id) {
        event.preventDefault()
        event.stopPropagation()
        this.clearTarget()
        return
      }
      if (!this.canDrop(anchor)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      this.clearTarget()
      const placement = this.placement(event, element, anchor)
      this.target = placement.element
      this.target.addClass(placement.anchor ? placement.side === 'before' ? 'cckb-drop-before' : 'cckb-drop-after' : 'cckb-drop-column')
    })
    element.addEventListener('drop', (event) => {
      if (this.active && this.source && anchor?.id === this.source.id) {
        event.preventDefault()
        event.stopPropagation()
        this.clear()
        return
      }
      if (!this.canDrop(anchor)) return
      event.preventDefault()
      event.stopPropagation()
      const source = this.source!
      const placement = this.placement(event, element, anchor)
      const action: TaskAction = { kind: 'move', columnId,
        ...(placement.anchor ? { anchor: placement.anchor, side: placement.side! } : {}) }
      this.clear()
      this.act(source, action)
    })
  }

  dispose(): void {
    this.active = false
    this.clear()
  }

  private canDrop(anchor?: Task): boolean {
    return this.active && this.enabled && this.available() && Boolean(this.source)
      && (!anchor || (anchor.boardId === this.boardId && anchor.id !== this.source!.id))
  }

  private placement(event: DragEvent, element: HTMLElement, anchor?: Task): {
    element: HTMLElement; anchor?: Task; side?: 'before' | 'after'
  } {
    if (anchor) return { element, anchor, side: this.side(event, element) }
    for (const card of element.querySelectorAll<HTMLElement>('[data-task-id]')) {
      const task = this.anchors.get(card)
      if (task && this.canDrop(task) && this.side(event, card) === 'before') {
        return { element: card, anchor: task, side: 'before' }
      }
    }
    return { element }
  }

  private side(event: DragEvent, element: HTMLElement): 'before' | 'after' {
    const bounds = element.getBoundingClientRect()
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  }

  private clearTarget(): void {
    this.target?.removeClass('cckb-drop-before', 'cckb-drop-after', 'cckb-drop-column')
    this.target = undefined
  }

  private clear(): void {
    this.clearTarget()
    this.sourceElement?.removeClass('cckb-dragging')
    this.sourceElement = undefined
    this.source = undefined
  }
}