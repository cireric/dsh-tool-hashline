import { describe, expect, it, onTestFinished } from 'vitest'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const source = 'function sample() {\n  return 1;\n}\n'
const mounted = async () => {
  const h = await createPolicyHarness()
  onTestFinished(() => h.cleanup())
  return h
}
const header = async (h: Awaited<ReturnType<typeof mounted>>, file: string) => {
  const r = await h.read(file)
  expect(r.isError).toBe(false)
  const value = (r as unknown as { value: { path: string; tag: string } }).value
  return '[' + value.path + '#' + value.tag + ']'
}

describe('shipped Hashline block capabilities', () => {
  it('describes unavailable block replace/cut and the explicit range alternative', async () => {
    const h = await mounted()
    const description = h.runtime.schemas(h.scopeKey).find(s => s.name === 'edit')?.description ?? ''
    expect(description).toMatch(/PUT N\*:[\s\S]*CUT N\*[\s\S]*unavailable/iu)
    expect(description).toContain('PUT N.=M:')
    expect(description).not.toContain('closing line resolved')
  })

  it.each(['js', 'ts', 'py', 'md'].flatMap(ext => ['PUT 1*:\n+replacement', 'CUT 1*'].map(op => ({ ext, op }))))('refuses $op on $ext with an unavailable-capability diagnosis before writing', async ({ ext, op }) => {
    const h = await mounted()
    const name = 'fixture.' + ext
    const file = await writeFixture(h.dir, name, source)
    const result = await h.edit(await header(h, name) + '\n' + op)
    expect(result.isError).toBe(true)
    const message = result.isError ? result.error.message : ''
    expect(message).toMatch(/not available.*no block resolver/iu)
    expect(message).toMatch(/concrete line range/iu)
    expect(message).not.toMatch(/unsupported language|parse error|blank\/closer/iu)
    expect(h.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('keeps explicit replacement and cut working', async () => {
    const h = await mounted()
    const file = await writeFixture(h.dir, 'explicit.txt', 'one\ntwo\nthree\n')
    const result = await h.edit(await header(h, 'explicit.txt') + '\nPUT 2.=2:\n+TWO\nCUT 3.=3')
    expect(result.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\nTWO\n')
  })

  it('keeps unresolved after-block insertion as an after-line insertion with a warning', async () => {
    const h = await mounted()
    const file = await writeFixture(h.dir, 'after.js', source)
    const result = await h.edit(await header(h, 'after.js') + '\nPUT >1*:\n+inserted')
    expect(result.isError).toBe(false)
    expect(result.isError ? '' : result.value).toMatch(/plain|after line/iu)
    expect(await readFixture(file)).toBe('function sample() {\ninserted\n  return 1;\n}\n')
  })

  it('refuses an unavailable block in a later section before the first section writes', async () => {
    const h = await mounted()
    const first = await writeFixture(h.dir, 'first.txt', 'one\n')
    const second = await writeFixture(h.dir, 'second.js', source)
    const result = await h.edit(await header(h, 'first.txt') + '\nPUT 1.=1:\n+ONE\n' + await header(h, 'second.js') + '\nCUT 1*')
    expect(result.isError).toBe(true)
    expect(h.writes).toHaveLength(0)
    expect(await readFixture(first)).toBe('one\n')
    expect(await readFixture(second)).toBe(source)
  })

  it('keeps unresolved after-block register paste as an after-line paste', async () => {
    const h = await mounted()
    const file = await writeFixture(h.dir, 'paste.js', 'function f() {\n  first();\n  second();\n}\n')
    const result = await h.edit(await header(h, 'paste.js') + '\nCUT 2.=2 @saved\nPUT >3* @saved')
    expect(result.isError).toBe(false)
    expect(result.isError ? '' : result.value).toMatch(/plain|after line/iu)
    expect(await readFixture(file)).toBe('function f() {\n  second();\n  first();\n}\n')
  })
})
