import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calendarMonth, monthKey, parseMonthKey, shiftMonth } from '../src/domain/calendar'

test('calendar months use Monday-first six-week grids', () => {
  const month = calendarMonth('2026-09')
  assert.equal(month.title, '2026年9月')
  assert.equal(month.cells.length, 42)
  assert.deepEqual(month.cells.slice(0, 3).map((cell) => [cell.date, cell.inMonth]), [
    ['2026-08-31', false], ['2026-09-01', true], ['2026-09-02', true],
  ])
  assert.equal(month.cells.filter((cell) => cell.inMonth).length, 30)
})

test('calendar handles leap years and month shifts across years', () => {
  const leap = calendarMonth('2028-02')
  assert.equal(leap.cells.filter((cell) => cell.inMonth).length, 29)
  assert.equal(leap.cells.find((cell) => cell.date === '2028-02-29')?.inMonth, true)
  assert.equal(shiftMonth('2026-01', -1), '2025-12')
  assert.equal(shiftMonth('2026-12', 1), '2027-01')
  assert.equal(shiftMonth('2026-01', 14), '2027-03')
})

test('calendar month keys validate dates without accepting rollover values', () => {
  assert.deepEqual(parseMonthKey('2026-09'), { year: 2026, month: 9 })
  for (const value of ['', '2026-9', '2026-00', '2026-13', '0000-01', '10000-01']) {
    assert.equal(parseMonthKey(value), undefined)
  }
  assert.equal(monthKey(new Date(2026, 0, 2)), '2026-01')
  assert.throws(() => calendarMonth('2026-13'), /Invalid calendar month/)
  assert.throws(() => shiftMonth('0001-01', -1), /outside the supported range/)
})
