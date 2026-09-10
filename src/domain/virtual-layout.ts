// Prefix heights allow variable-height lists to locate rows without scanning the DOM.
export class VirtualLayout {
  private readonly heights: number[]
  private readonly tree: number[]

  constructor(readonly count: number, estimate: number) {
    this.heights = Array.from({ length: count }, () => estimate)
    this.tree = Array.from({ length: count + 1 }, () => 0)
    for (let index = 0; index < count; index++) this.add(index, estimate)
  }

  offset(index: number): number {
    let sum = 0
    for (let cursor = Math.min(index, this.count); cursor > 0; cursor -= cursor & -cursor) sum += this.tree[cursor]!
    return sum
  }

  get total(): number { return this.offset(this.count) }

  measure(index: number, height: number): boolean {
    if (index < 0 || index >= this.count || !Number.isFinite(height) || height <= 0) return false
    const change = height - this.heights[index]!
    if (Math.abs(change) < 0.5) return false
    this.heights[index] = height
    this.add(index, change)
    return true
  }

  indexAt(offset: number): number {
    let low = 0
    let high = this.count
    while (low < high) {
      const middle = (low + high) >>> 1
      if (this.offset(middle + 1) <= offset) low = middle + 1
      else high = middle
    }
    return Math.min(low, Math.max(0, this.count - 1))
  }

  private add(index: number, change: number): void {
    for (let cursor = index + 1; cursor <= this.count; cursor += cursor & -cursor) this.tree[cursor]! += change
  }
}
