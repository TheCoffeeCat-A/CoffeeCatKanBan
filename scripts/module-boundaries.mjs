import ts from 'typescript'
import { posix } from 'node:path'

function layer(filename) {
  if (filename === 'main.ts') return 'entry'
  if (filename === 'contracts.ts') return 'contracts'
  if (filename.startsWith('domain/')) return 'domain'
  if (filename.startsWith('storage/')) return 'storage'
  if (filename.startsWith('ui/')) return 'ui'
  return undefined
}

const allowedLayers = {
  entry: new Set(['domain', 'contracts', 'storage', 'ui']),
  contracts: new Set(['domain']),
  domain: new Set(['domain']),
  storage: new Set(['domain', 'contracts']),
  ui: new Set(['domain', 'contracts', 'ui']),
}

function typeOnly(statement) {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause
    if (!clause) return false
    if (clause.isTypeOnly) return true
    const bindings = clause.namedBindings
    return !clause.name && bindings && ts.isNamedImports(bindings)
      && bindings.elements.length > 0 && bindings.elements.every((entry) => entry.isTypeOnly)
  }
  if (ts.isExportDeclaration(statement)) {
    return statement.isTypeOnly || (statement.exportClause && ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.length > 0 && statement.exportClause.elements.every((entry) => entry.isTypeOnly))
  }
  return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEmptyStatement(statement)
}

function resolveLocal(filename, specifier, sources) {
  const target = posix.normalize(posix.join(posix.dirname(filename), specifier))
  if (target === '..' || target.startsWith('../')) return undefined
  const stem = target.replace(/\.js$/, '')
  const candidates = [target, `${stem}.ts`, `${stem}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]
  return candidates.find((candidate) => sources.has(candidate))
}

export function checkModuleBoundaries(sources) {
  const errors = []
  const graph = new Map([...sources.keys()].map((filename) => [filename, new Set()]))
  for (const [filename, content] of sources) {
    const owner = layer(filename)
    if (!owner) errors.push(`${filename}: Module has no declared layer`)
    const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true,
      filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const report = (node, message) => {
      const location = source.getLineAndCharacterOfPosition(node.getStart(source))
      errors.push(`${filename}:${location.line + 1}: ${message}`)
    }
    for (const diagnostic of source.parseDiagnostics) {
      errors.push(`${filename}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`)
    }
    if (source.referencedFiles.length || source.typeReferenceDirectives.length || source.libReferenceDirectives.length) {
      errors.push(`${filename}: Triple-slash references are not allowed in source modules`)
    }
    if (owner === 'contracts') {
      for (const statement of source.statements) {
        if (!typeOnly(statement)) report(statement, 'Contracts must contain only types and type-only imports/exports')
      }
    }
    const dependency = (node, specifier) => {
      if (!specifier.startsWith('.')) {
        const allowed = owner === 'domain' ? ['yaml', 'fractional-indexing']
          : owner === 'ui' || owner === 'entry' || filename === 'storage/obsidian-store.ts' ? ['obsidian'] : []
        if (!allowed.includes(specifier)) report(node, `External dependency is not allowed here: ${specifier}`)
        return
      }
      const target = resolveLocal(filename, specifier, sources)
      if (!target) {
        report(node, `Dependency must resolve inside src: ${specifier}`)
        return
      }
      graph.get(filename).add(target)
      if (!allowedLayers[owner]?.has(layer(target))) report(node, `Forbidden layer dependency: ${filename} -> ${target}`)
    }
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node, node.moduleSpecifier.text)
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        dependency(node, node.argument.literal.text)
      } else if (ts.isImportEqualsDeclaration(node)) {
        report(node, 'Import-equals loading is not allowed; use static imports')
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        report(node, 'Dynamic import/require loading is not allowed; use static imports')
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const visited = new Set()
  const active = new Set()
  const path = []
  const visit = (filename) => {
    if (active.has(filename)) {
      errors.push(`Circular dependency: ${[...path.slice(path.indexOf(filename)), filename].join(' -> ')}`)
      return
    }
    if (visited.has(filename)) return
    active.add(filename)
    path.push(filename)
    for (const target of graph.get(filename) ?? []) visit(target)
    path.pop()
    active.delete(filename)
    visited.add(filename)
  }
  for (const filename of graph.keys()) visit(filename)
  return errors
}