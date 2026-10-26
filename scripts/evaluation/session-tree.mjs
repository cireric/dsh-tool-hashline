/** Session-scoped capture and aggregation; no IDs or inherited events are merged by accident. */
import { traceSummary } from './evidence.mjs'
import { COST_FIELDS } from './counting.mjs'
import fs from 'node:fs'
import path from 'node:path'

export function collectSessions(ctx, rootId, signal) {
  const sessions = new Map(), agents = new Map(), order = [], seen = new Set()
  const add = (id, event) => {
    const key = id + ':' + event.seq
    if (seen.has(key)) return
    seen.add(key); order.push({ sessionId: id, seq: event.seq })
  }
  const watch = session => {
    if (session.id !== rootId && !sessions.has(session.header.parentSession)) return undefined
    if (!sessions.has(session.id)) {
      const source = { id: session.id, parentId: session.id === rootId ? null : session.header.parentSession, createdAt: session.header.createdAt, cwd: session.header.cwd, inherited: session.inheritedEventCount ?? 0, events: [...session.snapshotEvents()], receipts: [] }
      sessions.set(session.id, source)
      for (const event of source.events) add(session.id, event)
    }
    return sessions.get(session.id)
  }
  const off = [
    ctx.on('session/created', watch, { global: true }),
    ctx.on('session/event', (session, event) => {
      const source = watch(session)
      if (!source) return
      if (!source.events.some(e => e.seq === event.seq)) source.events.push(event)
      add(session.id, event)
    }, { global: true }),
    ctx.on('agent/created', ({ agent }) => {
      if (!watch(agent.session)) return
      agents.set(agent.id, agent)
      if (signal?.aborted) agent.cancel({ kind: 'user' })
    }, { global: true }),
  ]
  return {
    sessions, agents, order, watch,
    cancel() { for (const agent of agents.values()) agent.cancel({ kind: 'user' }) },
    async idle() {
      // A child completion may enqueue another parent turn. Drain the whole tree.
      for (;;) {
        const count = agents.size
        await Promise.all([...agents.values()].map(a => a.whenIdle()))
        const root = agents.get(rootId)
        // Child idle precedes activation cleanup and its parent settlement notice.
        // Use the host's completion join, then wait for any newly woken parent turn.
        if (root && await ctx.get?.('subagents')?.waitForChildren(root)) continue
        await new Promise(resolve => setImmediate(resolve))
        if (count === agents.size && [...agents.values()].every(a => a.status === 'idle')) break
      }
    },
    dispose() { for (const stop of off) stop() },
  }
}

export function writeSessionEvidence(directory, collector, rootId, batches) {
  const sources = [...collector.sessions.values()]
  const graph = { rootId, order: collector.order, sources: sources.map((source, i) => {
    const artifact = source.id === rootId ? rootId : rootId + '-child-' + i
    const { events, receipts, ...meta } = source
    fs.writeFileSync(path.join(directory, artifact + '.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n', { flag: 'wx' })
    fs.writeFileSync(path.join(directory, artifact + '.receipts.json'), JSON.stringify(receipts), { flag: 'wx' })
    return { ...meta, artifact }
  }) }
  fs.writeFileSync(path.join(directory, rootId + '.batches.json'), JSON.stringify(batches), { flag: 'wx' })
  fs.writeFileSync(path.join(directory, rootId + '.graph.json'), JSON.stringify(graph), { flag: 'wx' })
  return { graph, sources }
}

export function readSessionEvidence(directory, rootId) {
  const graph = JSON.parse(fs.readFileSync(path.join(directory, rootId + '.graph.json'), 'utf8'))
  if (graph.rootId !== rootId || path.resolve(graph.sources.find(s => s.id === rootId)?.cwd ?? '') !== path.resolve(directory, rootId)) throw new Error('session graph root identity mismatch')
  const sources = graph.sources.map(source => {
    if (!/^[A-Za-z0-9_-]+$/u.test(source.artifact)) throw new Error('unsafe source artifact')
    const events = fs.readFileSync(path.join(directory, source.artifact + '.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    const receipts = JSON.parse(fs.readFileSync(path.join(directory, source.artifact + '.receipts.json'), 'utf8'))
    return { ...source, events, receipts }
  })
  return { graph, sources }
}

export function treeTraceSummary(graph, sources, options = {}) {
  const gaps = [], byId = new Map(sources.map(s => [s.id, s]))
  if (byId.size !== sources.length || !byId.has(graph.rootId)) gaps.push('duplicate or missing session')
  const positions = new Map()
  for (const [index, item] of (graph.order ?? []).entries()) {
    const key = item.sessionId + ':' + item.seq
    if (positions.has(key)) gaps.push('duplicate capture position')
    positions.set(key, index)
  }
  const traces = sources.map(source => {
    if (!Number.isSafeInteger(source.inherited) || source.inherited < 0 || source.inherited > source.events.length) gaps.push('invalid inherited prefix: ' + source.id)
    if (source.id !== graph.rootId) {
      const parent = byId.get(source.parentId)
      if (!parent || !parent.events.slice(parent.inherited).some(e => e.type === 'subagent/catalog' && e.data?.childId === source.id && e.data.childCreatedAt === source.createdAt)) gaps.push('missing parent catalog: ' + source.id)
      let cursor = source, ancestry = new Set()
      while (cursor && cursor.id !== graph.rootId && !ancestry.has(cursor.id)) { ancestry.add(cursor.id); cursor = byId.get(cursor.parentId) }
      if (cursor?.id !== graph.rootId) gaps.push('disconnected/cyclic session: ' + source.id)
    }
    for (const catalog of source.events.slice(source.inherited).filter(e => e.type === 'subagent/catalog')) {
      const child = byId.get(catalog.data?.childId)
      if (!child || child.parentId !== source.id || child.createdAt !== catalog.data.childCreatedAt) gaps.push('catalog child not captured: ' + source.id)
    }
    let prior = -1
    for (let i = 0; i < source.events.length; i++) {
      const event = source.events[i], at = positions.get(source.id + ':' + event.seq)
      if (event.seq !== i || at === undefined || at <= prior) gaps.push('missing or reordered capture: ' + source.id)
      prior = at ?? prior
    }
    const trace = traceSummary(source.events.slice(source.inherited), { ...options, receipts: source.receipts, seqStart: source.inherited, delegationCovered: true })
    for (const call of trace.calls) {
      call.sessionId = source.id
      call.startOrder = positions.get(source.id + ':' + call.startSeq)
      call.endOrder = positions.get(source.id + ':' + call.endSeq)
    }
    for (const call of trace.calls.filter(c => ['subagent', 'subagent_fork'].includes(c.name) && c.isError === false)) {
      const children = sources.filter(s => s.parentId === source.id)
      if (!children.length) gaps.push('successful delegation without captured child: ' + source.id)
    }
    gaps.push(...trace.gaps.map(g => source.id + ': ' + g))
    return { id: source.id, trace }
  })
  if (positions.size !== sources.reduce((n, s) => n + s.events.length, 0)) gaps.push('capture order contains foreign events')
  const calls = traces.flatMap(t => t.trace.calls).sort((a, b) => (a.startOrder ?? Infinity) - (b.startOrder ?? Infinity))
  const sum = field => traces.every(t => Number.isFinite(t.trace.costs[field])) ? traces.reduce((n, t) => n + t.trace.costs[field], 0) : 'unknown'
  const modes = [...new Set(traces.filter(t => t.trace.editCalls).map(t => t.trace.mode))]
  const turnOutcome = traces.some(t => t.trace.turnOutcome === 'error') ? 'error' : traces.some(t => t.trace.turnOutcome === 'aborted') ? 'aborted' : traces.every(t => t.trace.turnOutcome === 'completed') ? 'completed' : 'unknown'
  return {
    status: gaps.length ? 'GAP' : 'PASS', scope: 'session-tree', gaps, calls, turnOutcome,
    sessions: traces.map(t => ({ id: t.id, status: t.trace.status, costs: t.trace.costs })),
    costs: Object.fromEntries([...COST_FIELDS, 'totalTokens', 'uncachedInputTokens'].map(f => [f, gaps.length ? 'unknown' : sum(f)])),
    editCalls: traces.reduce((n, t) => n + t.trace.editCalls, 0), failures: traces.reduce((n, t) => n + t.trace.failures, 0),
    internalRetries: traces.every(t => Number.isFinite(t.trace.internalRetries)) ? traces.reduce((n, t) => n + t.trace.internalRetries, 0) : 'unknown',
    recovered: traces.some(t => t.trace.recovered), retries: 'unknown', firstCandidateCorrect: 'unknown',
    firstAttempt: gaps.length ? 'unknown' : traces.find(t => t.id === calls.find(c => c.name === 'edit')?.sessionId)?.trace.firstAttempt ?? 'not-attempted',
    mode: gaps.length || modes.includes('unknown') ? 'unknown' : modes.length > 1 ? 'mixed' : modes[0] ?? 'not-attempted',
  }
}
