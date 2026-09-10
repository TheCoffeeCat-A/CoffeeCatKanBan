import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkModuleBoundaries } from '../scripts/module-boundaries.mjs'

const inspect = (sources) => checkModuleBoundaries(new Map(Object.entries(sources)))

test('architecture accepts composition through contracts and the host adapter', () => {
  assert.deepEqual(inspect({
    'domain/model.ts': 'export interface Task { id: string }',
    'contracts.ts': 'import type { Task } from "./domain/model"; export interface Store { read(): Task }',
    'storage/repository.ts': 'import type { Store } from "../contracts"; export class Repository {}',
    'storage/obsidian-store.ts': 'import { TFile } from "obsidian"; import type { Store } from "../contracts";',
    'ui/view.ts': 'import { ItemView } from "obsidian"; import type { Store } from "../contracts";',
    'main.ts': 'import { Repository } from "./storage/repository"; import "./ui/view";',
  }), [])
})

test('architecture rejects UI dependencies on storage even for type-only imports', () => {
  const errors = inspect({
    'ui/view.ts': 'import type { Repository } from "../storage/repository";',
    'storage/repository.ts': 'export interface Repository {}',
  })
  assert.ok(errors.some((error) => error.includes('Forbidden layer dependency')))
})

test('architecture rejects reversed dependencies and dependencies between storage implementations', () => {
  const errors = inspect({
    'domain/model.ts': 'export * from "../ui/view";',
    'ui/view.ts': 'export const title = "view";',
    'storage/obsidian-store.ts': 'import "./repository";',
    'storage/repository.ts': 'export const store = 1;',
  })
  assert.equal(errors.filter((error) => error.includes('Forbidden layer dependency')).length, 2)
})

test('architecture checks inline import types and reexports instead of only import statements', () => {
  const errors = inspect({
    'ui/view.ts': 'type Store = import("../storage/repository").Store; export type { Store } from "../storage/repository";',
    'storage/repository.ts': 'export interface Store {}',
  })
  assert.equal(errors.filter((error) => error.includes('Forbidden layer dependency')).length, 2)
})

test('architecture detects cycles including type-only dependencies', () => {
  const errors = inspect({
    'domain/first.ts': 'import type { Second } from "./second"; export interface First {}',
    'domain/second.ts': 'export type { First } from "./first"; export interface Second {}',
  })
  assert.ok(errors.some((error) => error.startsWith('Circular dependency:')))
})

test('architecture keeps contracts free of runtime values and initialization', () => {
  const errors = inspect({
    'contracts.ts': 'import { Task } from "./domain/model"; export const state = {};',
    'domain/model.ts': 'export interface Task {}',
  })
  assert.equal(errors.filter((error) => error.includes('Contracts must contain only types')).length, 2)
})

test('architecture rejects host and Node imports outside their owners', () => {
  const errors = inspect({
    'domain/model.ts': 'import "obsidian"; import "node:fs";',
    'storage/repository.ts': 'import "obsidian";',
    'ui/view.ts': 'import "electron";',
  })
  assert.equal(errors.filter((error) => error.includes('External dependency is not allowed')).length, 4)
})

test('architecture rejects dynamic loading and imports outside source ownership', () => {
  const errors = inspect({
    'ui/view.ts': 'import "../../scripts/helper"; void import("../storage/repository"); require("obsidian");',
  })
  assert.equal(errors.filter((error) => error.includes('Dynamic import/require')).length, 2)
  assert.ok(errors.some((error) => error.includes('Dependency must resolve inside src')))
})

test('architecture requires new source areas and triple-slash references to be reviewed', () => {
  const errors = inspect({
    'misc/global.ts': 'export const state = {};',
    'domain/model.ts': '/// <reference path="../misc/global.ts" />\nexport interface Task {}',
  })
  assert.ok(errors.some((error) => error.includes('no declared layer')))
  assert.ok(errors.some((error) => error.includes('Triple-slash references')))
})