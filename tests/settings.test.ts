import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultSettings, readSettings, validateSettings } from '../src/domain/settings'

test('settings recover malformed data and validate directories without changing safe defaults', () => {
  assert.deepEqual(readSettings(null), defaultSettings())
  assert.deepEqual(readSettings({ defaultView: 'unknown', showArchived: 'true', boardFolder: '../escape', taskFolder: '.obsidian' }), defaultSettings())
  const settings = { defaultView: 'calendar' as const, showArchived: true, boardFolder: ' Boards ', taskFolder: ' Work/Tasks ' }
  assert.deepEqual(validateSettings(settings), { ...settings, boardFolder: 'Boards', taskFolder: 'Work/Tasks' })
  assert.throws(() => validateSettings({ ...settings, boardFolder: '../escape' }))
  assert.equal(settings.boardFolder, ' Boards ')
})