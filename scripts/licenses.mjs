import { readFile } from 'node:fs/promises'

export async function runtimeLicenses() {
  const sections = []
  for (const name of ['yaml', 'fractional-indexing']) {
    const info = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'))
    const license = await readFile(`node_modules/${name}/LICENSE`, 'utf8')
    sections.push(`${name} ${info.version} — ${info.license}\n\n${license.trim()}`)
  }
  return sections.join('\n\n---\n\n') + '\n'
}
