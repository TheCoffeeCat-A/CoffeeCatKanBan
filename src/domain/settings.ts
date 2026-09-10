import { validateFolder } from './model'

export interface KanbanSettings {
  defaultView: 'board' | 'data' | 'calendar'
  boardFolder: string
  taskFolder: string
  showArchived: boolean
}

export function defaultSettings(): KanbanSettings {
  return { defaultView: 'board', boardFolder: '', taskFolder: 'Tasks', showArchived: false }
}

export function readSettings(value: unknown): KanbanSettings {
  const result = defaultSettings()
  if (!value || typeof value !== 'object') return result
  if ('defaultView' in value && (value.defaultView === 'board' || value.defaultView === 'data' || value.defaultView === 'calendar')) result.defaultView = value.defaultView
  if ('showArchived' in value && typeof value.showArchived === 'boolean') result.showArchived = value.showArchived
  for (const key of ['boardFolder', 'taskFolder'] as const) {
    if (key in value) {
      const folder = (value as Record<string, unknown>)[key]
      if (typeof folder === 'string') {
        try { result[key] = validateFolder(folder.trim()) } catch { continue }
      }
    }
  }
  return result
}

export function validateSettings(value: KanbanSettings): KanbanSettings {
  return { ...readSettings(value), boardFolder: validateFolder(value.boardFolder.trim()), taskFolder: validateFolder(value.taskFolder.trim()) }
}