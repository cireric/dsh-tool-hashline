import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const quote = 'Use replace mode on delegated.txt to change two to TWO.'

// These observation doubles drive query failure/ancestry boundaries through the
// real ToolRuntime and filesystem. The production query, real Sessions, spawn
// records and cold-parent path are also exercised by test:host-policy.
async function delegated(options: { catalog?: boolean; childId?: string; queryFails?: boolean; queryUnavailable?: boolean; inheritedCatalog?: boolean; lateQuote?: boolean; inheritedDescriptor?: boolean; missingDescriptor?: boolean; cycle?: boolean } = {}) {
  const harness = await createPolicyHarness({ policyModule: POLICY_MODULE })
  onTestFinished(() => harness.cleanup())
  const session = harness.session as unknown as { id: string; header: Record<string, unknown>; inheritedEventCount?: number; snapshotEvents(): { type: string; data: unknown }[] }
  const snapshot = session.snapshotEvents.bind(session)
  session.inheritedEventCount = options.inheritedDescriptor ? 1 : 0
  session.header = { ...session.header, id: session.id, createdAt: 20, origin: 'subagent', parentSession: 'parent' }
  session.snapshotEvents = () => snapshot().map((event, seq) => ({ ...event, seq }))
  harness.appendEvent('subagent/descriptor', { version: 3, provider: 'spawn', mode: 'continuable', label: 'fixture task' })
  harness.appendUserMessage(quote) // The initial model-authored delegation is NOT new human authorization.
  const events = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: quote }] } },
    ...options.catalog === false ? [] : [{ seq: 1, type: 'subagent/catalog', data: { version: 0, childId: options.childId ?? session.id, childCreatedAt: 20, mode: 'continuable', label: 'fixture task' } }],
  ]
  if (options.lateQuote) events.splice(0, events.length, { ...events[1]!, seq: 0 }, { ...events[0]!, seq: 1 })
  let released = 0
  const query = {
    async observeSession(id: string) {
      if (options.queryFails) throw new Error('fixture persistence unavailable')
      if (id === session.id) return {
        header: session.header, events: session.snapshotEvents(), inheritedEventCount: session.inheritedEventCount,
        projections: { values: { subagent: options.missingDescriptor ? null : { seq: 0, mode: 'continuable', label: 'fixture task' } } },
        [Symbol.dispose]() { released += 1 },
      }
      if (id !== 'parent') throw new Error('unexpected corpus lookup: ' + id)
      return {
        header: { id: 'parent', createdAt: 1, ...options.cycle ? { origin: 'subagent', parentSession: session.id } : {} }, events, inheritedEventCount: options.inheritedCatalog ? 2 : 0,
        projections: { values: { subagentCatalog: options.catalog === false || options.inheritedCatalog ? [] : [{ id: options.childId ?? session.id, createdAt: 20, mode: 'continuable', label: 'fixture task' }] } },
        [Symbol.dispose]() { released += 1 },
      }
    },
  }
  if (!options.queryUnavailable) harness.root.provide('sessionQuery' as never, query as never)
  const file = await writeFixture(harness.dir, 'delegated.txt', 'one\ntwo\n')
  const edit = (source: Record<string, unknown> = { quote, sessionId: 'parent' }) => harness.callTool('edit', {
    path: 'delegated.txt', old_string: 'two', new_string: 'TWO',
    fallbacks: [{ path: 'delegated.txt', reason: 'user-override', userSource: source, modes: ['replace'] }],
  })
  return { harness, file, edit, sessionId: session.id, released: () => released }
}

describe('delegated user sources use host records, never a synthetic parent property', () => {
  it('accepts a query-observed parent and releases the observation', async () => {
    const h = await delegated()
    const result = await h.edit()
    expect(result.isError ? result.error.message : '').toBe('')
    expect(await readFixture(h.file)).toBe('one\nTWO\n')
    expect(h.released()).toBeGreaterThan(0)
  })

  it('can locate the original parent quote without making the child guess an id', async () => {
    const h = await delegated()
    const result = await h.edit({ quote })
    expect(result.isError ? result.error.message : '').toBe('')
    expect(await readFixture(h.file)).toBe('one\nTWO\n')
  })

  it.each([
    ['only lineage, no catalog', { catalog: false }],
    ['catalog belongs to another task', { childId: 'different-child' }],
    ['catalog was inherited by a fork', { inheritedCatalog: true }],
    ['source arrived after delegation', { lateQuote: true }],
    ['parent query unavailable', { queryFails: true }],
    ['query service not mounted', { queryUnavailable: true }],
    ['child identity only inherited from a fork', { inheritedDescriptor: true }],
    ['host has no validated child identity', { missingDescriptor: true }],
  ] as const)('refuses %s before writing', async (_name, options) => {
    const h = await delegated(options)
    const result = await h.edit()
    expect(result.isError).toBe(true)
    expect(result.isError ? result.error.message : '').toContain('EDIT_POLICY_USER_SOURCE')
    expect(h.harness.writes).toHaveLength(0)
    expect(await readFixture(h.file)).toBe('one\ntwo\n')
  })

  it('rejects cyclic ancestry without scanning unrelated sessions', async () => {
    const h = await delegated({ cycle: true })
    const result = await h.edit({ quote, sessionId: 'unrelated-ancestor' })
    expect(result.isError ? result.error.message : '').toContain('cycle')
    expect(h.harness.writes).toHaveLength(0)
    expect(h.released()).toBeGreaterThan(0)
  })

  it('honors an exact parent seq and range', async () => {
    const h = await delegated()
    const result = await h.edit({ quote, sessionId: 'parent', eventSeq: 0, start: 0, end: quote.length })
    expect(result.isError ? result.error.message : '').toBe('')
    expect(await readFixture(h.file)).toBe('one\nTWO\n')
  })

  it('does not credit the initial delegated prompt as a direct user override', async () => {
    const h = await delegated({ catalog: false })
    const result = await h.edit({ quote, sessionId: h.sessionId })
    expect(result.isError).toBe(true)
    expect(h.harness.writes).toHaveLength(0)
    expect(await readFixture(h.file)).toBe('one\ntwo\n')
  })

  it.each([
    { quote, sessionId: 'parent', eventSeq: 1 },
    { quote, sessionId: 'parent', start: 0, end: 3 },
  ])('rejects contradictory seq/range in a parent citation', async source => {
    const h = await delegated()
    const result = await h.edit(source)
    expect(result.isError).toBe(true)
    expect(h.harness.writes).toHaveLength(0)
    expect(h.released()).toBeGreaterThan(0)
  })
})
