export interface CalendarCell {
  readonly date: string
  readonly day: number
  readonly inMonth: boolean
}

export interface CalendarMonth {
  readonly key: string
  readonly title: string
  readonly cells: readonly CalendarCell[]
}

function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

function localDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  return date
}

function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function monthKey(date = new Date()): string {
  return formatMonth(date.getFullYear(), date.getMonth() + 1)
}

export function parseMonthKey(value: string): { readonly year: number; readonly month: number } | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 1 || year > 9999 || month < 1 || month > 12) return undefined
  return { year, month }
}

export function shiftMonth(value: string, offset: number): string {
  const current = parseMonthKey(value)
  if (!current || !Number.isInteger(offset)) throw new RangeError('Invalid calendar month')
  const index = current.year * 12 + current.month - 1 + offset
  const year = Math.floor(index / 12)
  const month = index - year * 12 + 1
  if (year < 1 || year > 9999) throw new RangeError('Calendar month is outside the supported range')
  return formatMonth(year, month)
}

export function calendarMonth(value: string): CalendarMonth {
  const current = parseMonthKey(value)
  if (!current) throw new RangeError('Invalid calendar month')
  const first = localDate(current.year, current.month, 1)
  const leading = (first.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = localDate(current.year, current.month, index - leading + 1)
    return Object.freeze({
      date: dateKey(date), day: date.getDate(),
      inMonth: date.getFullYear() === current.year && date.getMonth() === current.month - 1,
    })
  })
  return Object.freeze({ key: value, title: `${current.year}年${current.month}月`, cells: Object.freeze(cells) })
}
