import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// @ts-ignore -- shipped ESM asset
import * as Gate from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'

async function mount() {
  const ctx = new Context()
  await ctx.plugin(Gate as never, {} as never)
  onTestFinished(() => ctx.fiber.dispose())
  const events: any[] = []
  const agent = { session: { id: 'a', header: {}, snapshotEvents: (from = 0) => events.slice(from) }, options: {}, inbox: { nextStep: [] as any[] } }
  const add = (type: string, data: any) => events.push({ seq: events.length, type, data })
  const user = (text: string, source: any = { kind: 'user' }) => add('user/message', { source, content: [{ type: 'text', text }] })
  const ask = (id = 'q1') => add('tool/call', { name: 'ask_user_question', callId: id })
  const answer = (id = 'q1') => add('tool/result', { message: { toolCallId: id } })
  const inner = (type: string, pending = false) => add(type, { name: 'ask_user_question', subCallId: 'q1', rootCallId: 'root-1', content: [{ type: 'text', text: JSON.stringify({ pending }) }] })
  const exec = (fields: any = {}, decision: any = { kind: 'allow' }) => (ctx as any).waterfall('tools/pre-execute', { agent, name: 'write', arguments: {}, ...fields }, async () => decision)
  return { ctx, agent, events, add, user, ask, answer, inner, exec }
}

describe('execution guards independent of Intent formatting', () => {
  it('allows authorized work without a declaration', async () => {
    const h = await mount(); h.user('Fix it.')
    expect((await h.exec()).kind).toBe('allow')
  })
  it('keeps an unanswered question blocked until its own answer', async () => {
    const h = await mount(); h.user('Choose a scope.'); h.ask()
    expect((await h.exec()).kind).toBe('deny')
    h.answer('other')
    expect((await h.exec()).kind).toBe('deny')
    h.answer()
    expect((await h.exec()).kind).toBe('allow')
  })
  it('allows clarification itself while a question is open', async () => {
    const h = await mount(); h.ask()
    expect((await h.exec({ name: 'ask_user_question' })).kind).toBe('allow')
  })
  it('does not treat a bare continue or a stale answer as resolving a choice', async () => {
    const h = await mount(); h.user('Choose.'); h.ask(); h.user('继续')
    h.user('A', { kind: 'user-question-reply', callId: 'other' })
    expect((await h.exec()).kind).toBe('deny')
    h.user('A', { kind: 'user-question-reply', callId: 'q1' })
    expect((await h.exec()).kind).toBe('allow')
  })
  it('allows an independent request without discarding the old question', async () => {
    const h = await mount(); h.user('Choose.'); h.ask(); h.user('Read an unrelated file.')
    expect((await h.exec({ name: 'read' })).kind).toBe('allow')
    h.ask('q2'); h.answer('q1')
    expect((await h.exec()).kind).toBe('deny')
    h.answer('q2')
    expect((await h.exec()).kind).toBe('allow')
  })
  it('keeps a pending inner question blocked and requires a new program after its answer', async () => {
    const h = await mount(); h.inner('tool/ptc-dispatch-start'); h.inner('tool/ptc-dispatch', true)
    expect((await h.exec({ rootCallId: 'root-1' })).kind).toBe('deny')
    h.inner('tool/ptc-dispatch')
    expect((await h.exec({ rootCallId: 'root-1' })).kind).toBe('deny')
    expect((await h.exec({ rootCallId: 'root-2' })).kind).toBe('allow')
  })
  it('restores the wait from persisted events on a fresh plugin instance', async () => {
    const h = await mount(); h.user('Choose.'); h.ask()
    const reloaded = await mount(); reloaded.events.push(...h.events)
    expect((await reloaded.exec()).kind).toBe('deny')
    reloaded.answer()
    expect((await reloaded.exec()).kind).toBe('allow')
  })
  it('keeps sessions independent', async () => {
    const h = await mount(); h.ask()
    const other = { ...h.agent, session: { ...h.agent.session, id: 'b', snapshotEvents: () => [] } }
    expect((await h.exec({ agent: other })).kind).toBe('allow')
    expect((await h.exec()).kind).toBe('deny')
  })
  it('keeps downstream denials and exceptions', async () => {
    const h = await mount()
    expect(await h.exec({}, { kind: 'deny', reason: 'permission' })).toEqual({ kind: 'deny', reason: 'permission' })
    await expect((h.ctx as any).waterfall('tools/pre-execute', { agent: h.agent }, async () => { throw new Error('permission check failed') })).rejects.toThrow('permission check failed')
  })
  it('denies stale dispatch when user steering is waiting', async () => {
    const h = await mount(); h.agent.inbox.nextStep.push({ source: { kind: 'user' } })
    expect((await h.exec()).kind).toBe('deny')
    h.agent.inbox.nextStep.splice(0)
    expect((await h.exec()).kind).toBe('allow')
  })
  it('does not reinterpret child-agent execution', async () => {
    const h = await mount(); h.ask()
    expect((await h.exec({ agent: { ...h.agent, options: { subagentDepth: 1 } } })).kind).toBe('allow')
  })
  it('denies tools if the question record cannot be read without failing a prose reply', async () => {
    const h = await mount()
    expect((await h.exec({ agent: { ...h.agent, session: { id: 'bad', snapshotEvents() { throw new Error('unreadable') } } } })).kind).toBe('deny')
  })
})
