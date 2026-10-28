import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
// @ts-ignore -- plain ESM asset shipped inside the preset (builtin-only imports)
import * as Gate from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'

/**
 * Request-scope, replay and repair behaviour of the request-level intent gate, driven at
 * the official seams it uses rather than through a private field:
 *   - `agent/pre-step` says which steps a real user message opened (the gate's trigger),
 *   - `llm/stream` is where an attempt is buffered, judged, then released or stopped,
 *   - `agent/request-error` is where the loop asks for recovery, i.e. where the one
 *     bounded repair is issued (ticket 02).
 *
 * What this tier proves is the SCOPE, REPLAY and BUDGET contract in isolation (who is
 * gated, what a pass-through looks like, which terminal reasons stay untouched, what the
 * caps do, and that exactly one repair is spent per user-opened request). The end-to-end
 * claim — nothing published and nothing dispatched before acceptance, and the correction
 * notice reaching the regenerated request — belongs to the installed-host acceptance in
 * scripts/test-intent-gate-host.mjs.
 */

type Chunk = Record<string, unknown>

const textChunks = (text: string, finish: Chunk = { type: 'finish', reason: { kind: 'stop' } }): Chunk[] => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  finish,
]

const programChunks = (text: string): Chunk[] => [
  ...textChunks(text, { type: 'finish', reason: { kind: 'tool-calls' } }).slice(0, 3),
  { type: 'block-start', index: 1, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'run_code', argumentsDelta: '{"code":"1"}' },
  { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call-1', name: 'run_code', arguments: '{"code":"1"}' } },
  { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
  { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: 'r', blocks: [{}, {}] } },
]

/** Mount the gate on a bare context and return the dispatch helpers it reacts to. */
async function mount(config: Record<string, unknown> = {}) {
  const ctx = new Context()
  await ctx.plugin(Gate as never, config as never)
  /** Every append the gate performed, in order (it issues none of its own any more). */
  const appended: { type: string; data: any; intent: any }[] = []
  /** Commit + notify, as the real Session does. */
  const commit = commitTo(ctx)
  /** Live session objects by id, so the stream helper can commit to the right log. */
  const sessions = new Map<string, any>()
  const agent = (sessionId: string, depth = 0) => {
    /**
     * The session's own event log — the ONLY thing the gate derives its state from
     * (ticket 06). Tests read/write it through this array, so a "reload" is just a new
     * agent object over the same events.
     */
    const events: any[] = []
    const session = {
      id: sessionId,
      header: depth === 0 ? {} : { delegationDepth: depth },
      events,
      snapshotEvents(from = 0) {
        return events.slice(from)
      },
      append(type: string, data: unknown, intent: unknown) {
        appended.push({ type, data: data as any, intent })
        events.push({ type, seq: events.length, time: 0, data: data as any })
        return appended.length
      },
    }
    /** The host's steering queue for the nearest step (ticket 05 reads it). */
    const inbox = { nextStep: [] as any[] }
    sessions.set(sessionId, session)
    return {
      session,
      options: {},
      inbox,
      /** Public agent API: the loop delivers these as the next step's claimed messages. */
      followups: [] as any[],
      injected: [] as any[],
      followup(message: any) { this.followups.push(message) },
      inject(message: any) { this.injected.push(message) },
      /** Steering is the loop's documented way for a listener to keep a turn going. */
      steer(message: any) { this.injected.push(message); this.inbox.nextStep.push(message) },
    }
  }
  return {
    ctx,
    appended,
    agent,
    /** One user-opened step, exactly as the loop proposes it. */
    async userStep(target: ReturnType<typeof agent>, turn = 1, text = 'go') {
      target.session.events.push({ type: 'user/message', seq: target.session.events.length, time: 0, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
      await (ctx as any).waterfall(
        'agent/pre-step',
        { agent: target, messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }], turn, step: 0 },
        () => Promise.resolve({ kind: 'enter', messages: [] }),
      )
    },
    /**
     * One machine-opened step: the loop splices whatever the gate queued into the inbox and
     * claims it, so a repair notice or a continuation reaches this step's request.
     */
    async machineStep(target: ReturnType<typeof agent>, turn = 1) {
      target.inbox.nextStep.push(...target.followups.splice(0))
      const claimed = target.inbox.nextStep.splice(0)
      for (const message of claimed) commit(target.session, 'user/message', message)
      const messages = claimed.length > 0
        ? claimed
        : [{ role: 'tool', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'text', text: 'ok' }] }]
      await (ctx as any).waterfall(
        'agent/pre-step',
        { agent: target, messages, turn, step: 1 },
        () => Promise.resolve({ kind: 'enter', messages: [] }),
      )
      return claimed
    },
    /** The driver's idle transition: where the gate opens the declaration-only repair. */
    async idle(target: ReturnType<typeof agent>) {
      await (ctx as any).emit('agent/status', { agent: target, status: 'idle' })
    },
    /** The tool schemas the next step would be offered (the declaration step offers none). */
    async assemble(target: ReturnType<typeof agent>, tools = [{ name: 'run_code', description: 'x', parameters: {} }]) {
      const assembly = await (ctx as any).waterfall(
        'system-prompt/assemble',
        { sections: [], contexts: [], tools: [], variables: {} },
        { agent: target, scope: target },
        () => Promise.resolve({ sections: [], contexts: [], tools, variables: {} }),
      )
      return (assembly.tools ?? []).map((tool: any) => tool.name)
    },
    /**
     * Run one attempt through the waterfall and collect what the loop would receive, then
     * commit what the loop would commit: an accepted reply and a completed turn, or the
     * failure the gate's stop causes. That log is the only state the gate has (ticket 06).
     */
    async stream(targetOrId: ReturnType<typeof agent> | string, chunks: Chunk[], extra: Record<string, unknown> = {}, control: { crashAfterCommit?: boolean } = {}) {
      const sessionId = typeof targetOrId === 'string' ? targetOrId : targetOrId.session.id
      const log = typeof targetOrId === 'string' ? (sessions.get(targetOrId) as any) : targetOrId.session
      const options = { provider: 'p', model: 'm', messages: [], sessionId, ...extra }
      const iterable = (ctx as any).waterfall('llm/stream', options, async function* () { for (const chunk of chunks) yield chunk })
      const seen: Chunk[] = []
      for await (const chunk of iterable) seen.push(chunk as Chunk)
      const stopped = isPolicyStop(seen)
      const text = textOf(seen)
      // A stream for a session this harness never created (an unmounted/other agent) has no
      // log to commit to; the gate's pass-through is all that is under test there.
      if (log !== undefined) {
        if (!stopped && text !== '') {
          commit(log, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text }] } })
        }
        // The loop's own stop boundary, before the turn boundary commits. A listener may ask
        // for one more step here, and the loop then re-reads its inbox instead of closing.
        const target = typeof targetOrId === 'string' ? undefined : targetOrId
        // The process can die between the commit and the turn's stop boundary. A case that
        // simulates that stops here: nothing queued, no turn/end, no replay of anything.
        if (control.crashAfterCommit === true) return seen
        if (target !== undefined) {
          await (ctx as any).serial('agent/turn-stopping', { agent: target, turn: 1 })
        }
        if (target === undefined || target.inbox.nextStep.length === 0) {
          commit(log, 'turn/end', { turn: 1, reason: stopped ? { kind: 'error', error: { code: (seen[0] as any).reason.failure.code, message: 'stopped' } } : { kind: 'completed' } })
        }
      }
      return seen
    },
    /** Ask the loop's recovery hook what to do, exactly as the loop does. */
    async requestError(target: ReturnType<typeof agent>, code: string, signal = new AbortController().signal) {
      return await (ctx as any).waterfall(
        'agent/request-error',
        { agent: target, turn: 1, step: 0, provider: 'p', failure: { code, message: 'x' }, retryPolicy: undefined, signal },
        () => Promise.resolve(undefined),
      )
    },
  }
}

/**
 * Commit one session event the way the harness's fake session does, AND notify it the way the
 * real Session does — the gate hangs its continuation off 'session/event', so a silent push
 * would test a world the host never creates.
 */
const commitTo = (ctx: any) => (session: any, type: string, data: unknown) => {
  session.events.push({ type, seq: session.events.length, time: 0, data })
  ctx.emit('session/event', session, session.events[session.events.length - 1])
}

const textOf = (chunks: Chunk[]) => chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => String(chunk.text)).join('')
const isPolicyStop = (chunks: Chunk[]) => chunks.length === 1 && (chunks[0] as any).type === 'finish' && (chunks[0] as any).reason?.kind === 'error'
const codeOf = (chunks: Chunk[]) => (chunks.at(-1) as any)?.reason?.failure?.code

describe('request-level intent gate: what is gated', () => {
  it('replays an accepted attempt verbatim, including usage and replay metadata', async () => {
    const h = await mount()
    const declarations = programChunks('Intent: ship the fixture edit; I will read then edit.')
    await h.userStep(h.agent('session-a'))
    const seen = await h.stream('session-a', declarations)
    expect(seen).toEqual(declarations)
    expect((seen.at(-1) as any).replayState).toEqual({ response: 'r', blocks: [{}, {}] })
    expect(seen.some(chunk => chunk.type === 'usage')).toBe(true)
    await h.ctx.fiber.dispose()
  })

  it('stops an undeclared pure answer: no text, no tool call, only a policy finish', async () => {
    const h = await mount()
    await h.userStep(h.agent('session-b'))
    const seen = await h.stream('session-b', textChunks('Sure, I deleted the branch.'))
    expect(textOf(seen)).toBe('')
    expect(isPolicyStop(seen)).toBe(true)
    expect(codeOf(seen)).toBe('INTENT_DECLARATION_MISSING')
    expect(String((seen[0] as any).reason.failure.message)).toMatch(/intent-gate/u)
    await h.ctx.fiber.dispose()
  })

  it('stops an undeclared program and keeps the rejected generation\'s usage traceable', async () => {
    const h = await mount()
    await h.userStep(h.agent('session-c'))
    const seen = await h.stream('session-c', programChunks('I will just do it.'))
    expect(seen.map(chunk => chunk.type)).toEqual(['usage', 'finish'])
    expect(codeOf(seen)).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('rejects an empty declaration body', async () => {
    const h = await mount()
    await h.userStep(h.agent('session-d'))
    expect(codeOf(await h.stream('session-d', textChunks('Intent:   ')))).toBe('INTENT_DECLARATION_EMPTY')
    await h.ctx.fiber.dispose()
  })

  it('does not ask a tool continuation of the same request to declare again', async () => {
    const h = await mount()
    const target = h.agent('session-e')
    await h.userStep(target, 1)
    expect(textOf(await h.stream('session-e', textChunks('Intent: read then edit; I will start with the read.')))).toContain('Intent:')
    await h.machineStep(target, 1)
    const continuation = textChunks('Reading the second file next.')
    expect(await h.stream('session-e', continuation)).toEqual(continuation)
    await h.ctx.fiber.dispose()
  })

  it('keeps sessions independent', async () => {
    const h = await mount()
    await h.userStep(h.agent('session-g'))
    const other = textChunks('an unrelated session says nothing about intent')
    expect(await h.stream('session-h', other)).toEqual(other)
    expect(isPolicyStop(await h.stream('session-g', textChunks('undeclared')))).toBe(true)
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: what is out of scope', () => {
  it('never gates a delegated child (IG-B-13)', async () => {
    const h = await mount()
    await h.userStep(h.agent('child-1', 1))
    const child = textChunks('child reply with no declaration')
    expect(await h.stream('child-1', child)).toEqual(child)
    await h.ctx.fiber.dispose()
  })

  it('never gates an auxiliary model call and leaves the obligation intact', async () => {
    const h = await mount()
    await h.userStep(h.agent('session-i'))
    const summary = textChunks('compaction summary text')
    expect(await h.stream('session-i', summary, { purpose: 'compaction' })).toEqual(summary)
    const title = textChunks('a session title')
    expect(await h.stream('session-i', title, { purpose: 'session-title' })).toEqual(title)
    const handBuilt = textChunks('one-shot answer')
    expect(await h.stream('session-i', handBuilt, { system: 'you are a helper' })).toEqual(handBuilt)
    expect(isPolicyStop(await h.stream('session-i', textChunks('undeclared reply')))).toBe(true)
    await h.ctx.fiber.dispose()
  })

  it('replays real terminal reasons untouched (IG-B-10)', async () => {
    const h = await mount()
    const aborted: Chunk[] = [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'partial' }, { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } } }]
    const errored: Chunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'socket hang up', code: 'NETWORK' } } }]
    const truncated: Chunk[] = [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: 'a long answer with no marker' }, { type: 'finish', reason: { kind: 'max-tokens' } }]
    for (const [sessionId, attempt] of [['a1', aborted], ['a2', errored], ['a3', truncated]] as const) {
      await h.userStep(h.agent(sessionId))
      expect(await h.stream(sessionId, attempt as unknown as Chunk[])).toEqual(attempt)
    }
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: declaration-only repair (2026-10-28 plan)', () => {
  /** The whole shape: withhold, spend the repair as a tool-free declaration step, then continue. */
  const declareOnce = async (h: Awaited<ReturnType<typeof mount>>, target: any, attempts: Chunk[], text = 'go') => {
    await h.userStep(target, 1, text)
    const withheld = await h.stream(target, attempts)
    expect(await h.requestError(target, codeOf(withheld) as string)).toBeUndefined()
    await h.idle(target)
    return withheld
  }

  it('withholds the attempt and opens a TOOL-FREE declaration step instead of retrying in place', async () => {
    const h = await mount()
    const target = h.agent('repair-a')
    expect(await h.assemble(target)).toEqual(['run_code'])
    await h.userStep(target)
    const withheld = await h.stream('repair-a', programChunks('No declaration here.'))
    expect(codeOf(withheld)).toBe('INTENT_DECLARATION_MISSING')
    expect(textOf(withheld)).toBe('')
    expect(withheld.some(chunk => chunk.type === 'tool-call-delta')).toBe(false)
    expect(String((withheld.at(-1) as any).reason.failure.message)).toMatch(/正在自动重新生成声明/u)
    // A retry inside the same step would be handed the same assembled tools, so the failure
    // stays terminal and the repair arrives as its own step.
    expect(await h.requestError(target, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    expect(h.appended).toHaveLength(0)
    await h.idle(target)
    expect(target.followups).toHaveLength(1)
    const notice = target.followups[0]
    expect(notice.source.kind).toBe('intent-gate-watchdog')
    expect(notice.source.form).toBe('notice')
    expect(notice.role).toBe('user')
    expect(String(notice.content[0].text)).toContain('Intent:')
    expect(String(notice.content[0].text)).toMatch(/DECLARATION-ONLY/u)
    expect(String(notice.content[0].text)).toMatch(/grants no new authority/u)
    // the declaration step itself: no tool schema is offered at all
    const claimed = await h.machineStep(target)
    expect(claimed).toHaveLength(1)
    expect(await h.assemble(target)).toEqual([])
    const declared = textChunks('Intent: answer the question; I will explain it in prose.')
    expect(await h.stream(target, declared)).toEqual(declared)
    // published declaration, then the SAME request continues with its tools back
    expect(target.injected).toHaveLength(1)
    expect(String(target.injected[0].content[0].text)).toContain('Do not repeat or restate the Intent: line')
    await h.machineStep(target)
    expect(await h.assemble(target)).toEqual(['run_code'])
    const business = textChunks('The fixture is small; here is the answer.')
    expect(await h.stream('repair-a', business)).toEqual(business)
    await h.ctx.fiber.dispose()
  })

  it('ends the request as a protocol pause when the declaration step fails too', async () => {
    for (const [sessionId, attempt] of [
      ['pause-a', textChunks('no marker again')],
      ['pause-b', textChunks('Intent:   ')],
      ['pause-c', programChunks('Intent: act now; I will write it.')],
    ] as const) {
      const h = await mount()
      const target = h.agent(sessionId)
      await declareOnce(h, target, textChunks('undeclared first reply'))
      await h.machineStep(target)
      const stopped = await h.stream(target, attempt as unknown as Chunk[])
      expect(codeOf(stopped), sessionId).toBe('INTENT_DECLARATION_REPAIR_EXHAUSTED')
      expect(textOf(stopped), sessionId).toBe('')
      expect(stopped.some(chunk => chunk.type === 'tool-call-delta'), sessionId).toBe(false)
      expect(String((stopped.at(-1) as any).reason.failure.message), sessionId).toMatch(/意图声明未能生成，工作尚未执行/u)
      // no third generation, and the next step is a normal one again
      expect(await h.requestError(target, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')).toBeUndefined()
      await h.idle(target)
      expect(target.followups, sessionId).toHaveLength(0)
      expect(await h.assemble(target), sessionId).toEqual(['run_code'])
      await h.ctx.fiber.dispose()
    }
  })

  it('keeps the declaration body cap separate from a provider truncation', async () => {
    const h = await mount({ maxDeclarationChars: 24 })
    const target = h.agent('cap-a')
    await declareOnce(h, target, textChunks('undeclared first reply'))
    await h.machineStep(target)
    const tooLong = await h.stream(target, textChunks('Intent: ' + 'x'.repeat(64)))
    expect(codeOf(tooLong)).toBe('INTENT_DECLARATION_REPAIR_EXHAUSTED')
    expect(String((tooLong.at(-1) as any).reason.failure.message)).toMatch(/24 字符/u)
    await h.ctx.fiber.dispose()

    // a truncated generation keeps the provider's meaning and is never called a declaration miss
    const other = await mount()
    const second = other.agent('cap-b')
    await other.userStep(second)
    const truncated: Chunk[] = [{ type: 'finish', reason: { kind: 'max-tokens' } }]
    expect(await other.stream(second, truncated)).toEqual(truncated)
    expect(await other.requestError(second, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    expect(await other.assemble(second)).toEqual(['run_code'])
    await other.ctx.fiber.dispose()
  })

  it('lets a human input that lands during the declaration win: no continuation is queued', async () => {
    const h = await mount()
    const target = h.agent('steer-decl')
    await declareOnce(h, target, textChunks('undeclared first reply'))
    await h.machineStep(target)
    // the user speaks while the declaration-only reply is being generated
    target.inbox.nextStep.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'also rename the file' }] })
    const declared = textChunks('Intent: answer the question; I will explain it in prose.')
    expect(await h.stream(target, declared)).toEqual(declared)
    expect(target.injected).toHaveLength(0)
    await h.ctx.fiber.dispose()
  })

  it('gives each new user input its own repair, and a continuation notice never spends one', async () => {
    const h = await mount()
    const target = h.agent('repair-c')
    // four notices from this producer: two repairs and two continuations
    for (const text of ['repair one', 'repair two']) {
      target.session.events.push({ type: 'user/message', seq: target.session.events.length, time: 0, data: { role: 'user', source: { kind: 'intent-gate-watchdog', form: 'notice' }, content: [{ type: 'text', text: '[intent-gate] ' + text }] } })
    }
    target.session.events.push({ type: 'turn/end', seq: target.session.events.length, time: 0, data: { turn: 1, reason: { kind: 'error', error: { code: 'x' } } } })
    // a fresh user request still has its own repair, even though the log holds notices
    await declareOnce(h, target, textChunks('undeclared one'))
    expect(target.followups).toHaveLength(1)
    const declared = textChunks('Intent: answer the first ask; I will reply in prose.')
    expect(await h.stream(target, declared)).toEqual(declared)
    expect(target.injected).toHaveLength(1)
    // the continuation notice is in the log now; it must not spend the NEXT request's repair
    await h.machineStep(target)
    target.session.events.push({ type: 'turn/end', seq: target.session.events.length, time: 0, data: { turn: 2, reason: { kind: 'completed' } } })
    await h.userStep(target, 3, 'second ask')
    const second = await h.stream('repair-c', textChunks('undeclared two'))
    expect(codeOf(second)).toBe('INTENT_DECLARATION_MISSING')
    expect(await h.requestError(target, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    await h.idle(target)
    expect(target.followups).toHaveLength(1)
    await h.ctx.fiber.dispose()
  })

  it('never repairs a mechanism stop (cap or internal error) and keeps the budget for the request', async () => {
    const h = await mount({ maxBufferedChars: 64, maxBufferMs: 60_000 })
    const target = h.agent('repair-d')
    await h.userStep(target)
    expect(codeOf(await h.stream('repair-d', textChunks('Intent: ' + 'x'.repeat(200))))).toBe('INTENT_DECLARATION_LIMIT')
    expect(await h.requestError(target, 'INTENT_DECLARATION_LIMIT')).toBeUndefined()
    await h.idle(target)
    expect(target.followups).toHaveLength(0)
    // the request's repair is still available: a normal rejection now gets its one notice
    expect(codeOf(await h.stream('repair-d', textChunks('undeclared')))).toBe('INTENT_DECLARATION_MISSING')
    expect(await h.requestError(target, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    await h.idle(target)
    expect(target.followups).toHaveLength(1)
    await h.ctx.fiber.dispose()
  })

  it('delegates a real provider failure without spending or recording a repair', async () => {
    const h = await mount()
    const target = h.agent('repair-e')
    await h.userStep(target)
    const errored: Chunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { message: 'socket hang up', code: 'NETWORK' } } }]
    expect(await h.stream('repair-e', errored)).toEqual(errored)
    expect(await h.requestError(target, 'NETWORK')).toBeUndefined()
    await h.idle(target)
    expect(target.followups).toHaveLength(0)
    // and the request keeps its repair
    expect(codeOf(await h.stream('repair-e', textChunks('undeclared')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('does not repair when the turn was already cancelled', async () => {
    const h = await mount()
    const target = h.agent('repair-f')
    await h.userStep(target)
    expect(codeOf(await h.stream('repair-f', textChunks('undeclared')))).toBe('INTENT_DECLARATION_MISSING')
    const aborted = new AbortController()
    aborted.abort()
    expect(await h.requestError(target, 'INTENT_DECLARATION_MISSING', aborted.signal)).toBeUndefined()
    await h.idle(target)
    expect(target.followups).toHaveLength(0)
    await h.ctx.fiber.dispose()
  })

  it('re-publishes and replays nothing when the process dies between the declaration commit and the continuation', async () => {
    const h = await mount()
    const target = h.agent('crash-a')
    await h.userStep(target)
    expect(codeOf(await h.stream(target, textChunks('no declaration at all')))).toBe('INTENT_DECLARATION_MISSING')
    expect(await h.requestError(target, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    await h.idle(target)
    await h.machineStep(target)
    expect(await h.assemble(target)).toEqual([]) // the repair really was tool-free
    const declared = textChunks('Intent: write the fixture; I will write it once.')
    const turnsBefore = target.session.events.filter(event => event.type === 'turn/end').length
    expect(await h.stream(target, declared, {}, { crashAfterCommit: true })).toEqual(declared)
    // The declaration is committed, but the turn never reached its stop boundary: the
    // continuation of the same request was never queued, and no turn boundary was committed.
    expect(target.injected).toHaveLength(0)
    expect(target.session.events.filter(event => event.type === 'turn/end')).toHaveLength(turnsBefore)
    const commitsBefore = target.session.events.filter(event => event.type === 'assistant/message').length
    expect(commitsBefore).toBe(1)

    // The process is gone: what is left is the session log.
    const resumed = h.agent('crash-a')
    resumed.session.events.push(...target.session.events)
    expect(resumed.session.events.filter(event => event.type === 'assistant/message')).toHaveLength(commitsBefore)
    // the declaration phase was process state, so resume is NOT tool-less and replays nothing
    expect(await h.assemble(resumed)).toEqual(['run_code'])
    expect(resumed.injected).toHaveLength(0)
    expect(resumed.followups).toHaveLength(0)

    // and the user's next request is judged normally, with its own repair budget
    await h.userStep(resumed, 2, 'restated ask')
    expect(codeOf(await h.stream(resumed, textChunks('still undeclared')))).toBe('INTENT_DECLARATION_MISSING')
    expect(await h.requestError(resumed, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    await h.idle(resumed)
    expect(resumed.followups).toHaveLength(1)
    expect(String(resumed.followups[0].content[0].text)).toMatch(/Intent:/u)
    await h.ctx.fiber.dispose()
  })

  it('lets the next real input discard a declaration phase that never got its step', async () => {
    const h = await mount()
    const target = h.agent('repair-g')
    await h.userStep(target)
    await h.stream('repair-g', textChunks('undeclared'))
    await h.requestError(target, 'INTENT_DECLARATION_MISSING')
    // the process never reaches idle: the user speaks again instead
    await h.userStep(target, 2, 'a different ask')
    expect(await h.assemble(target)).toEqual(['run_code'])
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: bounded buffering (IG-B-15)', () => {
  it('stops instead of releasing a reply past the character cap', async () => {
    const h = await mount({ maxBufferedChars: 64, maxBufferMs: 60_000 })
    await h.userStep(h.agent('session-j'))
    const seen = await h.stream('session-j', textChunks('Intent: ' + 'x'.repeat(200)))
    expect(textOf(seen)).toBe('')
    expect(codeOf(seen)).toBe('INTENT_DECLARATION_LIMIT')
    expect(String((seen.at(-1) as any).reason.failure.message)).toMatch(/上限/u)
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: conversational input exceptions (ticket 03)', () => {
  const declared = textChunks('Intent: answer the question; I will reply in prose.')

  it('exempts a bare acknowledgement, so a plain "you are welcome" is published', async () => {
    const h = await mount()
    const target = h.agent('conv-a')
    await h.userStep(target, 1, '谢谢！')
    const reply = textChunks('不客气，需要时再叫我。')
    expect(await h.stream('conv-a', reply)).toEqual(reply)
    await h.ctx.fiber.dispose()
  })

  it('never exempts the same words carrying a new constraint', async () => {
    const h = await mount()
    const target = h.agent('conv-b')
    await h.userStep(target, 1, '收到，但把 a.txt 的第二行改成 B')
    expect(codeOf(await h.stream('conv-b', textChunks('改好了。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('exempts a bare continuation once an accepted understanding exists', async () => {
    const h = await mount()
    const target = h.agent('conv-c')
    await h.userStep(target, 1, 'Explain the fixture.')
    expect(await h.stream('conv-c', declared)).toEqual(declared)
    await h.userStep(target, 2, '继续')
    const reply = textChunks('接着上一段说完。')
    expect(await h.stream('conv-c', reply)).toEqual(reply)
    await h.ctx.fiber.dispose()
  })

  it('does not exempt a continuation with no understanding to carry', async () => {
    const h = await mount()
    const target = h.agent('conv-d')
    await h.userStep(target, 1, '继续')
    expect(codeOf(await h.stream('conv-d', textChunks('好的，我继续。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('does not exempt a continuation after a stopped request', async () => {
    const h = await mount()
    const target = h.agent('conv-e')
    await h.userStep(target, 1, 'Explain the fixture.')
    expect(await h.stream('conv-e', declared)).toEqual(declared)
    // exhaust the repair of the next request
    await h.userStep(target, 2, 'Now rewrite it.')
    await h.stream('conv-e', textChunks('no marker'))
    await h.requestError(target, 'INTENT_DECLARATION_MISSING')
    expect(codeOf(await h.stream('conv-e', textChunks('still no marker')))).toBe('INTENT_DECLARATION_REPAIR_EXHAUSTED')
    // the user's bare continuation is a NEW request and owes a declaration
    await h.userStep(target, 3, '继续')
    expect(codeOf(await h.stream('conv-e', textChunks('好的，我继续。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('never exempts a reply that would call a tool', async () => {
    const h = await mount()
    const target = h.agent('conv-f')
    await h.userStep(target, 1, '谢谢')
    expect(codeOf(await h.stream('conv-f', programChunks('好的，我把文件写一下。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('never exempts a mechanism stop', async () => {
    const h = await mount({ maxBufferedChars: 64, maxBufferMs: 60_000 })
    const target = h.agent('conv-g')
    await h.userStep(target, 1, '谢谢')
    expect(codeOf(await h.stream('conv-g', textChunks('不客气。' + 'x'.repeat(200))))).toBe('INTENT_DECLARATION_LIMIT')
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: clarification waiting (ticket 04)', () => {
  /** Emit the host's own question events, exactly as the session log records them. */
  /** The ask and its settle are ordinary log events; the gate derives the wait from them. */
  const ask = (_h: unknown, target: any, name = 'ask_user_question', callId = 'q1') => {
    target.session.events.push({ type: 'tool/call', seq: target.session.events.length, time: 0, data: { turn: 1, step: 0, callId, name, arguments: '{}' } })
  }
  const settle = (_h: unknown, target: any, pending = false) => {
    target.session.events.push({
      type: 'tool/ptc-dispatch',
      seq: target.session.events.length,
      time: 0,
      data: { rootCallId: 'root-1', subCallId: 's1', name: 'ask_user_question', isError: false, content: [{ type: 'text', text: pending ? '{"pending":true,"callId":"s1"}' : '{"answers":[]}' }] },
    })
  }
  const declared = textChunks('Intent: answer the question; I will reply in prose.')
  /** One user step whose only message is the host's question answer. */
  const answerStep = async (h: Awaited<ReturnType<typeof mount>>, target: any, text: string, turn = 2) => {
    target.session.events.push({ type: 'user/message', seq: target.session.events.length, time: 0, data: { role: 'user', source: { kind: 'user-question-reply', callId: 'q1', outcome: 'answered' }, content: [{ type: 'text', text }] } })
    await (h.ctx as any).waterfall(
      'agent/pre-step',
      { agent: target, messages: [{ role: 'user', source: { kind: 'user-question-reply', callId: 'q1', outcome: 'answered' }, content: [{ type: 'text', text }] }], turn, step: 0 },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
  }

  it('stops treating a bare continuation as exempt while a question is open', async () => {
    const h = await mount()
    const target = h.agent('wait-a')
    await h.userStep(target, 1, 'Explain the fixture.')
    expect(await h.stream('wait-a', declared)).toEqual(declared)
    ask(h, target)
    await h.userStep(target, 2, '继续')
    expect(codeOf(await h.stream('wait-a', textChunks('我接着上一段说完。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('refuses to act while the question is open, and allows the same reply once answered', async () => {
    const h = await mount()
    const target = h.agent('wait-b')
    await h.userStep(target, 1, 'Do the thing.')
    ask(h, target)
    // still open: a program is refused
    const refused = await h.stream('wait-b', programChunks('Intent: do the thing now; I will write the file.'))
    expect(codeOf(refused)).toBe('INTENT_DECLARATION_AWAITING_ANSWER')
    // the answer settles the question: the same reply is accepted afterwards
    settle(h, target)
    const program = programChunks('Intent: do the thing now; I will write the file.')
    expect(await h.stream('wait-b', program)).toEqual(program)
    await h.ctx.fiber.dispose()
  })

  it('keeps the wait open when the host reports the question still answerable', async () => {
    const h = await mount()
    const target = h.agent('wait-c')
    await h.userStep(target, 1, 'Do the thing.')
    ask(h, target)
    settle(h, target, true)
    expect(codeOf(await h.stream('wait-c', programChunks('Intent: act now; I will write it.')))).toBe('INTENT_DECLARATION_AWAITING_ANSWER')
    await h.ctx.fiber.dispose()
  })

  it('treats the host answer as human input that owes a declaration, never as social', async () => {
    const h = await mount()
    const target = h.agent('wait-d')
    await h.userStep(target, 1, 'Explain the fixture.')
    expect(await h.stream('wait-d', declared)).toEqual(declared)
    ask(h, target)
    // the answer's text is literally "继续" (an option label); it is still an answer
    await answerStep(h, target, '继续')
    expect(codeOf(await h.stream('wait-d', textChunks('好的。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('lets a new independent request through in the same session', async () => {
    const h = await mount()
    const target = h.agent('wait-e')
    ask(h, target)
    await h.userStep(target, 2, 'Different question: summarise the README.')
    const reply = textChunks('Intent: summarise the README; I will read it and answer.')
    expect(await h.stream('wait-e', reply)).toEqual(reply)
    await h.ctx.fiber.dispose()
  })

  it('keeps the wait per session, and a new user input ends it for gating purposes', async () => {
    const h = await mount()
    const asked = h.agent('wait-f')
    const other = h.agent('wait-g')
    ask(h, asked)
    const reply = programChunks('Intent: write the fixture; I will write it once.')
    // another session is untouched by this one's open question
    await h.userStep(other, 1, 'Write the fixture.')
    expect(await h.stream('wait-g', reply)).toEqual(reply)
    // the asking session's own machine step (same request, still no answer) may not act
    await h.machineStep(asked, 1)
    expect(codeOf(await h.stream('wait-f', reply))).toBe('INTENT_DECLARATION_AWAITING_ANSWER')
    // once the user speaks, the wait no longer blocks this session's new request
    await h.userStep(asked, 2, 'Write the fixture.')
    expect(await h.stream('wait-f', reply)).toEqual(reply)
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: steering before dispatch (ticket 05)', () => {
  const steer = (target: any, text = 'also rename the file') => {
    target.inbox.nextStep.push({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
  }
  const consume = (target: any) => { target.inbox.nextStep.length = 0 }

  it('withholds the calls of a reply that the user has already changed', async () => {
    const h = await mount()
    const target = h.agent('steer-a')
    await h.userStep(target, 1, 'Do the thing.')
    steer(target)
    const refused = await h.stream('steer-a', programChunks('Intent: do the thing; I will write it.'))
    // the words survive, the calls do not, and the reply ends as a plain stop
    expect(textOf(refused)).toBe('Intent: do the thing; I will write it.')
    expect(refused.some(chunk => chunk.type === 'tool-call-delta')).toBe(false)
    expect(refused.some(chunk => chunk.type === 'block-end' && (chunk as any).block?.type === 'tool-call')).toBe(false)
    expect((refused.at(-1) as any).reason.kind).toBe('stop')
    expect(h.appended).toHaveLength(0) // no repair notice: this is not a wording problem
    consume(target)
    const program = programChunks('Intent: do the thing, then rename it; I will do both in order.')
    expect(await h.stream('steer-a', program)).toEqual(program)
    await h.ctx.fiber.dispose()
  })

  it('lets a pure answer through: a stale reply with no action is harmless', async () => {
    const h = await mount()
    const target = h.agent('steer-b')
    await h.userStep(target, 1, 'Explain the fixture.')
    steer(target)
    const answer = textChunks('Intent: explain the fixture; I will answer in prose.')
    expect(await h.stream('steer-b', answer)).toEqual(answer)
    await h.ctx.fiber.dispose()
  })

  it('denies the next inner dispatch of an already-running program', async () => {
    const h = await mount()
    const target = h.agent('steer-c')
    const allow = () => Promise.resolve({ kind: 'allow' })
    const execute = () => (h.ctx as any).waterfall('tools/pre-execute', { name: 'write', agent: target }, allow)
    expect(await execute()).toEqual({ kind: 'allow' })
    steer(target)
    const denied = await execute()
    expect(denied.kind).toBe('deny')
    expect(String(denied.reason)).toMatch(/已经执行的部分保留/u)
    await h.ctx.fiber.dispose()
  })

  it('leaves a delegated child alone', async () => {
    const h = await mount()
    const child = h.agent('steer-child', 1)
    steer(child)
    const allow = () => Promise.resolve({ kind: 'allow' })
    expect(await (h.ctx as any).waterfall('tools/pre-execute', { name: 'write', agent: child }, allow)).toEqual({ kind: 'allow' })
    await h.ctx.fiber.dispose()
  })
})

describe('request-level intent gate: state from the formal log (ticket 06)', () => {
  /** Everything the gate knows comes from these events; a resume is a new object over them. */
  const resume = (h: Awaited<ReturnType<typeof mount>>, previous: any, sessionId = previous.session.id) => {
    const next = h.agent(sessionId)
    next.session.events.push(...previous.session.events)
    for (const [index, event] of next.session.events.entries()) event.seq = index
    return next
  }

  it('keeps the open question across a reload, so a bare continuation still owes one', async () => {
    const h = await mount()
    const before = h.agent('resume-a')
    await h.userStep(before, 1, 'Explain the fixture.')
    expect(await h.stream(before, textChunks('Intent: explain the fixture; I will answer in prose.'))).toHaveLength(4)
    before.session.events.push({ type: 'tool/call', seq: before.session.events.length, time: 0, data: { turn: 1, step: 0, callId: 'q9', name: 'ask_user_question', arguments: '{}' } })
    // the wait is open when the process goes away; the reload sees only the log
    const after = resume(h, before)
    await h.userStep(after, 2, '继续')
    expect(codeOf(await h.stream(after, textChunks('我接着上一段说完。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('keeps a spent repair and a stopped request across a reload', async () => {
    const h = await mount()
    const before = h.agent('resume-b')
    await h.userStep(before, 1, 'Do the thing.')
    expect(codeOf(await h.stream(before, programChunks('no declaration here')))).toBe('INTENT_DECLARATION_MISSING')
    expect(await h.requestError(before, 'INTENT_DECLARATION_MISSING')).toBeUndefined()
    await h.idle(before)
    expect(await h.machineStep(before)).toHaveLength(1) // the repair notice is claimed into the log
    expect(codeOf(await h.stream(before, programChunks('still none')))).toBe('INTENT_DECLARATION_REPAIR_EXHAUSTED')
    expect(await h.requestError(before, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')).toBeUndefined()
    // exactly ONE correction notice is in the record: that is what a spent budget is derived from
    expect(before.session.events.filter((event: any) => event.type === 'user/message' && event.data?.source?.kind === 'intent-gate-watchdog')).toHaveLength(1)
    const after = resume(h, before)
    await h.userStep(after, 2, '继续')
    // the continuation carries no authority: the previous request was stopped, and the log says so
    expect(codeOf(await h.stream(after, textChunks('我接着做完。')))).toBe('INTENT_DECLARATION_MISSING')
    await h.ctx.fiber.dispose()
  })

  it('reports an untrusted record instead of passing the request through', async () => {
    const h = await mount()
    const target = h.agent('resume-c')
    await h.userStep(target, 1, 'Do the thing.')
    target.session.events.push({ type: 'assistant/message', seq: target.session.events.length, time: 0, data: { message: { role: 'assistant', content: 'not-an-array' } } })
    const refused = await h.stream(target, textChunks('Intent: do the thing; I will write it.'))
    expect(codeOf(refused)).toBe('INTENT_STATE_UNTRUSTED')
    expect(textOf(refused)).toBe('')
    expect(await h.requestError(target, 'INTENT_STATE_UNTRUSTED')).toBeUndefined() // never a repair
    // the next input is handled by the normal entry points, from conservative defaults
    await h.userStep(target, 2, 'Restated: write the fixture.')
    const accepted = textChunks('Intent: write the fixture; I will write it once.')
    expect(await h.stream(target, accepted)).toEqual(accepted)
    await h.ctx.fiber.dispose()
  })

  it('replays nothing on resume: no dispatch, no write, no extra repair', async () => {
    const h = await mount()
    const before = h.agent('resume-d')
    await h.userStep(before, 1, 'Explain the fixture.')
    await h.stream(before, programChunks('Intent: read the fixture; I will read it.'))
    const after = resume(h, before)
    await h.userStep(after, 2, 'Again please.')
    const reply = textChunks('Intent: explain the fixture again; I will answer in prose.')
    expect(await h.stream(after, reply)).toEqual(reply)
    expect(h.appended).toHaveLength(0)
    await h.ctx.fiber.dispose()
  })
})
