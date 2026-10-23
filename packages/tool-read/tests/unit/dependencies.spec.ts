import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * NFR-4 dependency guard (amended 2026-10-23, spec §6 / C-08).
 *
 * tool-read may import exactly three runtime surfaces: Node builtins, the
 * pinned hashline anchor, and the two host CONTRACT packages (defineTool and
 * FsError). Any other @deepseek-ai/* value import — in particular a host
 * implementation such as dsh-tool-fs or dsh-fs-local — fails here instead of
 * being caught by review memory.
 */
const packageDir = fileURLToPath(new URL('../../', import.meta.url))
const srcDir = path.join(packageDir, 'src')
const ALLOWED = new Set([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-fs',
  '@dsh-tool-hashline/hashline',
])
const FORBIDDEN = ['@deepseek-ai/dsh-tool-fs', '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-tool-edit', '@deepseek-ai/dsh-llm']

const filesIn = (dir: string, extension: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name)
        return entry.isDirectory() ? filesIn(full, extension) : entry.name.endsWith(extension) ? [full] : []
      })
    : []

/** Value (non-type) module specifiers imported or re-exported by one file. */
function valueSpecifiers(text: string, fileName: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) {
      if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.isTypeOnly !== true && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [first] = node.arguments
      if (first !== undefined && ts.isStringLiteral(first)) specifiers.push(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

const isExternal = (specifier: string): boolean => !specifier.startsWith('.') && !specifier.startsWith('node:')

function scan(dir: string, extension: string): { file: string; specifier: string }[] {
  return filesIn(dir, extension).flatMap(file =>
    valueSpecifiers(readFileSync(file, 'utf8'), file).map(specifier => ({ file: path.relative(packageDir, file), specifier })),
  )
}

describe('tool-read runtime dependency surface (NFR-4)', () => {
  it('imports only the pinned engine and the two contract packages', () => {
    const imports = scan(srcDir, '.ts')
    expect(imports.length).toBeGreaterThan(0)
    const offenders = imports.filter(entry => isExternal(entry.specifier) && !ALLOWED.has(entry.specifier))
    expect(offenders).toEqual([])
    // The contract surface is actually in use, so this guard cannot pass vacuously.
    const used = new Set(imports.map(entry => entry.specifier))
    expect(used.has('@deepseek-ai/dsh-tools')).toBe(true)
    expect(used.has('@deepseek-ai/dsh-fs')).toBe(true)
  })

  it('never imports a host implementation package', () => {
    const imports = scan(srcDir, '.ts')
    const offenders = imports.filter(entry => FORBIDDEN.some(pkg => entry.specifier === pkg || entry.specifier.startsWith(pkg + '/')))
    expect(offenders).toEqual([])
  })

  it('keeps the emitted JavaScript on the same surface when dist is built', () => {
    const dist = path.join(packageDir, 'dist')
    if (!existsSync(dist)) return
    const imports = scan(dist, '.js')
    const offenders = imports.filter(entry => isExternal(entry.specifier) && !ALLOWED.has(entry.specifier))
    expect(offenders).toEqual([])
  })
})
