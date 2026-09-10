import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join, relative, sep } from 'node:path'
import { cpus, platform, release } from 'node:os'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { TaskRepository } from '../../src/storage/repository'
import type { NoteStore } from '../../src/contracts'

export async function benchmark(): Promise<unknown> {
  const temporaryRoot = resolve('.cache/tmp')
  await mkdir(temporaryRoot, { recursive: true })
  const directory = await mkdtemp(join(temporaryRoot, 'disk-benchmark-'))
  const results = []
  try {
    for (const count of [100, 1000, 5000]) {
      const folder = join(directory, String(count))
      await mkdir(folder)
      const boardId = randomUUID()
      const board = `---\nkanban_kind: board\nkanban_schema: 1\nkanban_id: ${boardId}\nkanban_columns: [todo, done]\nkanban_column_todo_title: Todo\nkanban_column_done_title: Done\nkanban_default_column: todo\nkanban_done_column: done\nkanban_new_task_folder: Tasks\n---\n`
      await writeFile(join(folder, 'Board.md'), board)
      const paths = ['Board.md', ...Array.from({ length: count }, (_, index) => `${index}.md`)]
      for (let start = 0; start < count; start += 64) await Promise.all(paths.slice(start + 1, start + 65).map((path) =>
        writeFile(join(folder, path), `---\nkanban_kind: task\nkanban_schema: 1\nkanban_id: ${randomUUID()}\nkanban_board: ${boardId}\nkanban_column: todo\n---\nSynthetic body ${path}\n`)))
      let reads = 0
      const store: NoteStore = {
        listPaths: () => paths,
        read: async (path) => { reads++; return readFile(join(folder, path), 'utf8') },
        process: async () => { throw new Error('No writes in benchmark') },
        create: async () => { throw new Error('No writes in benchmark') },
        trash: async () => { throw new Error('No deletes in benchmark') },
      }
      const repository = new TaskRepository(store, true)
      const start = performance.now()
      const first = await repository.scan()
      const cold = performance.now() - start
      assert.equal(first.tasks.length, count)
      assert.equal(first.diagnostics.length, 0)
      assert.equal(reads, count + 1)
      const warm = []
      for (let sample = 0; sample < 20; sample++) {
        const start = performance.now()
        assert.equal(await repository.scan(), first)
        warm.push(performance.now() - start)
      }
      const target = '0.md'
      await writeFile(join(folder, target), (await readFile(join(folder, target), 'utf8')) + 'Updated')
      repository.invalidate(target)
      const updateStart = performance.now()
      const updated = await repository.scan()
      const update = performance.now() - updateStart
      assert.ok(updated.tasks.find((task) => task.path === target)?.searchText?.includes('Updated'))
      assert.equal(reads, count + 2)
      warm.sort((a, b) => a - b)
      results.push({ tasks: count, coldIndexMs: +cold.toFixed(2), warmP95Ms: +warm[18]!.toFixed(2), updateMs: +update.toFixed(2), reads })
      repository.dispose()
    }
    return { platform: platform(), os: release(), cpu: cpus()[0]?.model, node: process.version,
      method: 'Synthetic Markdown on local disk, cold plugin index / 20 warm scans / one update; OS file cache not flushed. Not Obsidian host performance.', results }
  } finally {
    const inside = relative(temporaryRoot, directory)
    assert.ok(inside && inside !== '..' && !inside.startsWith(`..${sep}`))
    await rm(directory, { recursive: true, force: true })
  }
}
