import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain ESM module
import { captureRequest, auditRequestEvidence, requestSurface } from '../../scripts/evaluation/request-evidence.mjs'
// @ts-expect-error plain ESM module
import { compareRequestSurfaces } from '../../scripts/evaluation/compare-requests.mjs'
// @ts-expect-error plain ESM module
import { protocolHash, protocolGaps } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { writeSessionEvidence } from '../../scripts/evaluation/session-tree.mjs'
// @ts-expect-error plain ESM module
import { sha256 } from '../../scripts/evaluation/stimuli.mjs'

const req = createRequire(import.meta.url)
const { Session } = req('@deepseek-ai/dsh-session')
const { SESSION_FORMAT_VERSION } = req('@deepseek-ai/dsh-session')
const { buildForkSeed } = req('@deepseek-ai/dsh-session/fork')
const { createSystemMessage, createUserMessage } = req('@deepseek-ai/dsh-llm')
const sdkText = 'Program-only SDK bindings:\n\n```ts\ninterface Args { path: string }\ndeclare const tools: { read(args: Args): Promise<string> };\n```'
const temporary = (run: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-request-'))
  try { run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}
function evidence(dir: string) {
  const id = 'eval-proof', cwd = join(dir, id); mkdirSync(cwd)
  const session = Session.create(id)
  session.append('system/message', { turn: 0, step: 0, message: createSystemMessage(sdkText) }, { surfaceOp: 'append' })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'change x to y' }] }), { surfaceOp: 'append' })
  const tools = [{ name: 'run_code', description: 'execute code', parameters: { type: 'object' } }]
  session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture', maxTokens: 10 }, tools } })
  const options = { provider: 'fixture', model: 'fixture', maxTokens: 10, messages: session.deriveMessages(), toolHistory: session.toolHistory(), tools, sessionId: id, signal: new AbortController().signal }
  const capture = captureRequest(options, { id, session }, 1, dir)
  const events = session.snapshotEvents()
  const source = { id, parentId: null, cwd, inherited: 0, createdAt: 1, events, receipts: [] }
  writeSessionEvidence(dir, { sessions: new Map([[id, source]]), order: events.map((e: { seq: number }) => ({ sessionId: id, seq: e.seq })) }, id, [])
  const entry = req.resolve('@deepseek-ai/dsh-session')
  const protocol = { requestEvidence: { version: 1 }, model: { provider: 'fixture', model: 'fixture', parameters: { maxTokens: 10 } }, dependencies: { packages: { '@deepseek-ai/dsh-session': { entry, entryHash: sha256(readFileSync(entry)) } } } }
  const report = { requestEvidenceVersion: 1, runs: [{ sessionId: id, graphVersion: 1 }], requests: [{ sessionId: id, provider: 'fixture', model: 'fixture', reasoningEffort: 'unknown', maxTokens: 10, capture }] }
  return { protocol, report, options, session }
}

describe('assembled request evidence and independent Session replay', () => {
  it('captures full request payload without AbortSignal and replays messages, schemas, history and parameters', () => temporary(dir => {
    const { protocol, report } = evidence(dir), data = JSON.parse(readFileSync(join(dir, report.requests[0]!.capture.artifact), 'utf8'))
    expect(data.request).not.toHaveProperty('signal')
    expect(data.request.messages[0].content[0].text).toBe(sdkText)
    const audit = auditRequestEvidence(protocol, report, dir)
    expect(audit.problems).toEqual([])
    expect(audit.summary).toMatchObject({ status: 'PASS', requests: 1, replayed: 1, providerWire: 'unknown' })
    expect(JSON.stringify(report)).not.toContain('interface Args')
  }))
  it('rejects unsupported option fields and unavailable sessions before creating payloads', () => temporary(dir => {
    const { options, session } = evidence(dir)
    expect(() => captureRequest({ ...options, apiKey: 'must-not-be-copied' }, { id: 'eval-proof', session }, 2, dir)).toThrow('OPTIONS_UNSUPPORTED')
    expect(() => captureRequest(options, undefined, 2, dir)).toThrow('CAPTURE_UNAVAILABLE')
    expect(() => captureRequest(options, { id: 'eval-proof', session }, 1, dir)).toThrow()
  }))
  it('replays seeded child requests using their declared lineage and inherited prefix', () => temporary(dir => {
    const { protocol, report, session, options } = evidence(dir)
    const inherited = session.snapshotEvents().length, childId = 'seeded-child'
    const child = Session.create(childId, buildForkSeed(session.snapshotEvents(), inherited - 1), { version: SESSION_FORMAT_VERSION, id: childId, createdAt: 1, cwd: join(dir, 'eval-proof'), parentSession: 'eval-proof', isSeeded: true }, inherited)
    child.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue in child' }] }), { surfaceOp: 'append' })
    const capture = captureRequest({ ...options, messages: child.deriveMessages(), toolHistory: child.toolHistory(), sessionId: childId }, { id: childId, session: child }, 2, dir)
    const graphFile = join(dir, 'eval-proof.graph.json'), graph = JSON.parse(readFileSync(graphFile, 'utf8'))
    graph.sources.push({ id: childId, parentId: 'eval-proof', createdAt: 1, cwd: join(dir, 'eval-proof'), inherited, artifact: childId })
    writeFileSync(graphFile, JSON.stringify(graph))
    writeFileSync(join(dir, childId + '.jsonl'), child.snapshotEvents().map((e: object) => JSON.stringify(e)).join('\n') + '\n')
    writeFileSync(join(dir, childId + '.receipts.json'), '[]')
    report.requests.push({ ...report.requests[0]!, sessionId: childId, capture })
    const audit = auditRequestEvidence(protocol, report, dir)
    expect(audit.problems).toEqual([])
    expect(audit.summary).toMatchObject({ status: 'PASS', requests: 2, replayed: 2 })
  }))
  it.each(['messages', 'tools', 'history', 'prefix', 'owner', 'ordinal', 'config', 'summary', 'digest', 'path'])('rejects %s tampering including rewritten payload digests', kind => temporary(dir => {
    const { protocol, report } = evidence(dir), ref = report.requests[0]!.capture, file = join(dir, ref.artifact), data = JSON.parse(readFileSync(file, 'utf8'))
    if (kind === 'messages') data.request.messages[0].content[0].text += ' changed'
    if (kind === 'tools') data.request.tools[0].description = 'changed'
    if (kind === 'history') data.request.toolHistory.tools = []
    if (kind === 'prefix') data.prefixHash = 'wrong'
    if (kind === 'owner') data.sessionId = 'other'
    if (kind === 'ordinal') data.ordinal = 2
    if (kind === 'config') { data.request.maxTokens = 20; report.requests[0]!.maxTokens = 20 }
    const bytes = JSON.stringify(data) + '\n'; writeFileSync(file, bytes)
    Object.assign(ref, requestSurface(data.request), { sha256: sha256(Buffer.from(bytes)) })
    if (kind === 'summary') ref.systemHash = 'wrong'
    if (kind === 'digest') ref.sha256 = 'wrong'
    if (kind === 'path') ref.artifact = '../outside.json'
    expect(auditRequestEvidence(protocol, report, dir).problems.length).toBeGreaterThan(0)
  }))
  it('keeps missing replay identity as GAP and rejects removing required evidence version', () => temporary(dir => {
    const { protocol, report } = evidence(dir)
    protocol.dependencies.packages['@deepseek-ai/dsh-session'].entryHash = 'wrong'
    expect(auditRequestEvidence(protocol, report, dir).summary).toMatchObject({ status: 'GAP', replayed: 0 })
    report.requestEvidenceVersion = 0
    expect(auditRequestEvidence(protocol, report, dir).problems).toContain('request evidence version missing/unsupported')
  }))
  it('retains legacy unknown capture without inventing a historical request', () => {
    const audit = auditRequestEvidence({}, { requests: [{ sessionId: 'old' }] }, 'unused')
    expect(audit.summary).toMatchObject({ status: 'GAP', reason: 'not-captured', replayed: 0 })
    expect(audit.problems).toEqual([])
  })
  it('does not guess SDK boundaries or equate unknown SDKs', () => {
    const request = { messages: [{ role: 'system', content: [{ type: 'text', text: '```ts\ndeclare const tools: {};\n```' }] }] }
    expect(requestSurface(request).sdk.status).toBe('unknown')
    request.messages[0]!.content[0]!.text = sdkText + '\n' + sdkText
    expect(requestSurface(request).sdk.status).toBe('unknown')
  })
  it('compares exact first requests and retains unexecuted pairs as unknown', () => {
    const protocol = { protocolHash: 'fixture', tasks: [{ id: 'a' }], samples: { repetitions: 2 }, comparison: ['stock-edit', 'hashline-default'] }
    const report = { runs: [{ taskId: 'a', repeat: 0, arm: 'stock-edit', sessionId: 'a' }, { taskId: 'a', repeat: 0, arm: 'hashline-default', sessionId: 'b' }] }
    const audit = { summary: { status: 'PASS' }, problems: [], captures: [{ sessionId: 'a', ordinal: 1, replay: 'PASS', systemHash: 'same', toolsHash: 'same', sdk: { status: 'known', hash: 'A' } }, { sessionId: 'b', ordinal: 2, replay: 'PASS', systemHash: 'same', toolsHash: 'same', sdk: { status: 'known', hash: 'B' } }] }
    const result = compareRequestSurfaces(protocol, report, audit)
    expect(result.status).toBe('GAP'); expect(result.pairs).toHaveLength(2)
    expect(result.pairs[0]).toMatchObject({ systemTextEqual: true, toolDefinitionsEqual: true, sdkEqual: false })
    expect(result.pairs[1]).toMatchObject({ sdkEqual: 'unknown', leftRequest: 'unknown' })
  })
  it.each([null, {}, { version: 2 }, { version: 1, wire: true }])('refuses unsupported requestEvidence contract %j', requestEvidence => {
    expect(protocolGaps({ requestEvidence }).some((g: string) => g.includes('requestEvidence'))).toBe(true)
  })
})
