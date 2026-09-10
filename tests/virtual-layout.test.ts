import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VirtualLayout } from '../src/domain/virtual-layout'
import { buildCatalogue, buildCatalogueAsync } from '../src/domain/catalogue'

test('variable heights preserve boundaries and locate all 5000 rows after resize', () => {
  const layout = new VirtualLayout(5000, 100)
  assert.equal(layout.total, 500000)
  layout.measure(0, 400)
  layout.measure(2500, 25)
  assert.equal(layout.total, 500225)
  for (const index of [0, 1, 2499, 2500, 2501, 4999]) {
    assert.equal(layout.indexAt(layout.offset(index)), index)
    assert.equal(layout.indexAt(layout.offset(index + 1) - 0.1), index)
  }
  assert.equal(layout.indexAt(-100), 0)
  assert.equal(layout.indexAt(Infinity), 4999)
  assert.equal(layout.measure(1, NaN), false)
  assert.equal(layout.measure(1, 0), false)
  assert.equal(new VirtualLayout(0, 100).total, 0)
})

test('cooperative catalogue keeps synchronous diagnostics and propagates cancellation', async () => {
  const notes = Array.from({ length: 200 }, (_, index) => ({ path: `${index}.md`, content: 'ordinary text' }))
  notes[64] = { path: 'Broken.md', content: '---\nkanban_kind: task\nkanban_schema: [\n---\nbody' }
  let turns = 0
  const result = await buildCatalogueAsync(notes, async () => { turns++ })
  assert.deepEqual(result, buildCatalogue(notes))
  assert.ok(turns >= 3)
  await assert.rejects(buildCatalogueAsync(notes, async () => { throw new Error('Cancelled') }), /Cancelled/)
})
