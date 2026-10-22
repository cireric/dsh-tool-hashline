import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { computeFileHash, getSessionSnapshotStore, normalizeToLF, stripBom } from '@dsh-tool-hashline/hashline'
import type { ReadValue } from '../../src/index.ts'
import { createHarness, readFixture, valueOf, writeFixture } from './harness.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')

describe('read -> edit first success (ticket 01)', () => {
  it('mints the engine tag, exposes it in value, renders the header, and edits on the first try', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'main.ts', 'one\ntwo\nthree\n')

    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    const raw = await readFixture(file)
    const expectedTag = computeFileHash(normalizeToLF(stripBom(raw).text))

    expect(value.tagged).toBe(true)
    expect(value.tag).toBe(expectedTag)
    expect(value.tag).toMatch(/^[0-9A-F]{4}$/u)
    expect(value.path).toBe(file)
    expect(value.offset).toBe(1)
    expect(value.totalLines).toBe(3)
    expect(value.nextAction).toBeNull()

    // The snapshot the edit patcher will look up must exist under its own key.
    const store = getSessionSnapshotStore(harness.session)
    expect(store.head(path.resolve(process.cwd(), value.path))?.hash).toBe(expectedTag)

    // The stock envelope shape survives, with the header as the first content line.
    const content = textOf(result as never)
    expect(content.startsWith(`<path>${value.path}</path>\n<type>file</type>\n<content>\n[`)).toBe(true)
    expect(content).toContain(`#${value.tag}]\n1: one\n2: two\n3: three\n\n(End of file - total 3 lines)\n</content>`)

    const edited = await harness.callEdit({ input: `[${value.path}#${value.tag}]\nPUT 2.=2:\n+TWO` })
    expect(edited.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\nthree\n')
  })

  it('declares nullable tag/nextAction as oneOf so PTC SDK types stay string | null', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const schema = harness.runtime.get('read')?.output.schema as {
      properties: Record<string, { type?: unknown; oneOf?: { type: string }[] }>
      additionalProperties: boolean
    }
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.tag).toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }], description: '4-hex hashline content tag, or null when this read could not mint one.' })
    expect(schema.properties.nextAction).toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Actionable guidance when this read is not directly editable, else null.' })
  })

  it('keeps the tag stable across processes (NFR-1)', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'cross.ts', 'alpha\nbeta\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    const script = "import('@hy-sde-org/dsh-hashline').then(m => process.stdout.write(m.computeFileHash('alpha\\nbeta\\n')))"
    const fromChild = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(fromChild).toBe(value.tag)
  })

  it('reads valid text with one stat and one readText', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'cost.ts', 'a\nb\n')
    valueOf(await harness.callRead({ file_path: file }))
    expect(harness.counts).toEqual({ stat: 1, readText: 1, resolve: 1 })
  })

  it('mints a stable tag for identical content across processes and paths', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const first = await writeFixture(harness.dir, 'same-a.ts', 'alpha\nbeta\n')
    const second = await writeFixture(harness.dir, 'same-b.ts', 'alpha\nbeta\n')
    const a = valueOf<ReadValue>(await harness.callRead({ file_path: first }))
    const b = valueOf<ReadValue>(await harness.callRead({ file_path: second }))
    expect(a.tag).toBe(b.tag)
    expect(a.tag).toBe(computeFileHash('alpha\nbeta\n'))
  })
})