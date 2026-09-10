import { isMap, parseDocument, stringify } from 'yaml'
import { invalid, type Properties } from './model'

export function parseNote(content: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(content)
  if (!opening) return null
  const start = opening[0].length
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(content.slice(start))
  if (!closing) invalid('Frontmatter is not closed')
  const end = start + closing.index
  const source = content.slice(start, end)
  const document = parseDocument(source, { schema: 'core', strict: true, uniqueKeys: true })
  if (document.errors.length || !isMap(document.contents)) invalid('Frontmatter must be a valid YAML mapping with unique keys')
  let properties: Properties
  try {
    properties = document.toJS({ maxAliasCount: 20 }) as Properties
  } catch {
    invalid('Frontmatter contains unsupported aliases')
  }
  return { document, properties, opening: content.slice(0, start), tail: content.slice(end),
    body: content.slice(end + closing[0].length), newline: opening[0].endsWith('\r\n') ? '\r\n' : '\n' }
}

export function propertiesOf(content: string): Properties {
  const parsed = parseNote(content)
  if (!parsed) invalid('This note has no task frontmatter')
  return parsed.properties
}

export function createNote(properties: Properties, body = ''): string {
  return `---\n${stringify(properties, { lineWidth: 0 })}---\n${body}`
}