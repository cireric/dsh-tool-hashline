import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// @ts-ignore -- shipped ESM asset
import * as Gate from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'

describe('Intent is a conversation convention, not a generation gate', () => {
  it('streams the first chunk immediately and preserves provider failures and usage', async () => {
    const ctx = new Context()
    await ctx.plugin(Gate as never, {} as never)
    try {
      let finished = false
      const first = { type: 'text-delta', index: 0, text: 'Which scope?' }
      const usage = { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
      const failure = { type: 'finish', reason: { kind: 'error', failure: { code: 'NETWORK', message: 'offline' } } }
      const source = async function* () { yield first; yield usage; finished = true; yield failure }
      const stream = (ctx as any).waterfall('llm/stream', { sessionId: 'streaming' }, source)[Symbol.asyncIterator]()
      expect((await stream.next()).value).toBe(first)
      expect(finished).toBe(false)
      expect((await stream.next()).value).toBe(usage)
      expect((await stream.next()).value).toBe(failure)
      expect((await stream.next()).done).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })
  it.each(['Which interpretation do you mean: A or B?', 'Intent:', 'Here is the answer.'])('publishes %s without failure or an automatic turn', async text => {
    const ctx = new Context()
    await ctx.plugin(Gate as never, {} as never)
    try {
      const events = [{ seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Please investigate.' }] } }]
      const followups: unknown[] = []
      const agent = { session: { id: 'advisory', header: {}, snapshotEvents: () => events }, options: {}, inbox: { nextStep: [] }, followup: (message: unknown) => followups.push(message), steer: (message: unknown) => followups.push(message) }
      await (ctx as any).waterfall('agent/pre-step', { agent, messages: [events[0].data], turn: 1, step: 0 }, async () => ({ kind: 'enter' }))
      const chunks = [{ type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } }]
      const seen = []
      for await (const chunk of (ctx as any).waterfall('llm/stream', { sessionId: 'advisory' }, async function* () { yield* chunks })) seen.push(chunk)
      expect(seen).toEqual(chunks)
      await (ctx as any).waterfall('agent/request-error', { agent, failure: { code: 'INTENT_DECLARATION_MISSING' } }, async () => undefined)
      await (ctx as any).emit('agent/status', { agent, status: 'idle' })
      await (ctx as any).serial('agent/turn-stopping', { agent })
      expect(followups).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })
})

