import { describe, expect, it } from 'vitest'
import { extractSession } from '../../scripts/extract-runtime-evidence.mjs'

/**
 * The additive tool-path block (tool-routing plan T2 wired into the evidence extractor).
 *
 * What this pins: one run of the extractor can report BOTH claims a session has to support —
 * "the reply was declared before it ran" and "the task's target used the applicable SDK path" —
 * from the same records, that the block is reduced to ids/counts (no arguments, no bodies, no
 * program source), and that an incomplete session can never yield a clean tool-path verdict.
 *
 * Everything here runs in-process: the extractor's child-process CLI cases stay in
 * tests/integration/extract-runtime-evidence.spec.ts, which this sandbox cannot execute.
 */
const SESSION = 'session-toolpath-0001'
const record = (type: string, seq: number, data: unknown) => JSON.stringify({ type, seq, time: 0, data })

const artifact = (options: { broken?: boolean } = {}) => {
  const lines = [
    // the session header carries its identity at the record's own level, not under `data`
    JSON.stringify({ type: 'session', version: 4, id: SESSION, cwd: 'C:/work', agentPreset: 'ptc-hashline' }),
    record('user/message', 1, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'update the file' }] }),
    record('assistant/message', 2, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Intent: update the file; I will read then edit it.' }] } }),
    record('tool/call', 3, { turn: 1, step: 1, callId: 'root-1', name: 'run_code', arguments: JSON.stringify({ code: 'const r = await tools.read({file_path:"src/a.ts"}); await tools.edit({input:"[src/a.ts#ABCD]\\nPUT 1.=1:\\n+x"})' }) }),
    record('tool/ptc-dispatch-start', 4, { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:1', name: 'read', arguments: { file_path: 'src/a.ts' } }),
    record('tool/ptc-dispatch', 5, { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:1', name: 'read', arguments: { file_path: 'src/a.ts' }, isError: false, content: [] }),
    record('tool/ptc-dispatch-start', 6, { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:2', name: 'edit', arguments: { input: '[src/a.ts#ABCD]' } }),
    record('tool/ptc-dispatch', 7, { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:2', name: 'edit', arguments: { input: '[src/a.ts#ABCD]' }, isError: false, content: [] }),
    record('tool/result', 8, { turn: 1, step: 1, toolCallId: 'root-1', message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] } }),
  ]
  const text = lines.join('\n') + '\n'
  return {
    buffer: Buffer.from(text, 'utf8'),
    text,
    broken: options.broken === true ? text : undefined,
  }
}

type TaskEntry = { id?: string; kind?: string; targets?: readonly string[] }
const extract = (input: { tasks?: TaskEntry[]; tornStart?: number }) => {
  const built = artifact()
  return extractSession({
    sourcePath: 'fixture.jsonl',
    sessionId: SESSION,
    extractedAt: '2026-10-28T00:00:00.000Z',
    bytes: built.buffer.length,
    buffer: built.buffer,
    text: built.text,
    format: 'jsonl.v4',
    frames: 0,
    ...input.tornStart === undefined ? {} : { tornStart: input.tornStart },
    ...input.tasks === undefined ? {} : { tasks: input.tasks },
  })
}

const noticeArtifact = () => {
  // the ledger folds in SEQ order, so every record needs its own position (a duplicated seq is
  // also the kind of hole the extractor reports)
  let seq = 1
  const gate = (text: string) => JSON.stringify({ type: 'user/message', seq: seq += 1, time: 0, data: { role: 'user', source: { kind: 'intent-gate-watchdog', form: 'notice', summary: 'x' }, content: [{ type: 'text', text }] } })
  const lines = [
    JSON.stringify({ type: 'session', version: 4, id: SESSION, cwd: 'C:/work', agentPreset: 'ptc-hashline' }),
    record('user/message', seq += 1, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'update the file' }] }),
    record('assistant/attempt', seq += 1, { turn: 1, step: 1, stream: [], usage: { inputTokens: 5, outputTokens: 7 } }),
    record('turn/end', seq += 1, { turn: 1, reason: { kind: 'error' } }),
    gate('[intent-gate] Your previous reply for this request was withheld: the first line did not start with Intent:.'),
    record('assistant/message', seq += 1, { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Intent: update the file; I will read then edit it.' }] }, stream: [] }),
    gate('[intent-gate] Your declaration for this request was accepted and published. Continue the same request.'),
    record('assistant/message', seq += 1, { turn: 2, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, stream: [], usage: { inputTokens: 9, outputTokens: 11 } }),
    record('turn/end', seq += 1, { turn: 2, reason: { kind: 'completed' } }),
  ]
  const text = lines.join('\n') + '\n'
  return { buffer: Buffer.from(text, 'utf8'), text }
}

describe('extractor: cost ledger from the same range (P4)', () => {
  it('reports the per-request ledger with unknown cost kept unknown', () => {
    const built = artifact()
    const report = extractSession({
      sourcePath: 'fixture.jsonl',
      sessionId: SESSION,
      extractedAt: '2026-10-28T00:00:00.000Z',
      bytes: built.buffer.length,
      buffer: built.buffer,
      text: built.text,
      format: 'jsonl.v4',
      frames: 0,
    })
    expect(report.accounting.totals).toMatchObject({ requests: 1, repairs: 0, attempts: 1, usageUnknown: 1 })
    expect(report.accounting.requests[0].stages.first.published).toBe(1)
  })

  it('separates the three stages on a real repair sequence', () => {
    const built = noticeArtifact()
    const report = extractSession({
      sourcePath: 'fixture.jsonl',
      sessionId: SESSION,
      extractedAt: '2026-10-28T00:00:00.000Z',
      bytes: built.buffer.length,
      buffer: built.buffer,
      text: built.text,
      format: 'jsonl.v4',
      frames: 0,
    })
    const request = report.accounting.requests[0]
    expect(request.repairs).toBe(1)
    expect(request.stages.first).toMatchObject({ attempts: 1, published: 0, inputTokens: 5, outputTokens: 7 })
    expect(request.stages.declaration).toMatchObject({ attempts: 1, published: 1, usageUnknown: 1 })
    expect(request.stages.business).toMatchObject({ attempts: 1, published: 1, inputTokens: 9, outputTokens: 11 })
    expect(request.outcomes).toEqual(['error', 'completed'])
    expect(report.accounting.totals).toMatchObject({ repairs: 1, attempts: 3, usageUnknown: 1, failedTurns: 1 })
  })
})

describe('extractor: additive tool-path judgement (T2)', () => {
  it('reports toolPath: null when no tasks are named, exactly as before', () => {
    const report = extract({})
    expect(report.toolPath).toBeNull()
    expect(report.evidence.status).toBe('complete')
  })

  it('judges a named task on the same records and keeps the block free of arguments', () => {
    const report = extract({ tasks: [{ id: 'T3', kind: 'text-update', targets: ['src/a.ts'] }] })
    expect(report.toolPath).not.toBeNull()
    const [task] = report.toolPath!.tasks
    expect(task).toMatchObject({ taskId: 'T3', kind: 'text-update', verdict: 'applied-tool-path', readTargets: 1, editTargets: 1 })
    expect(report.toolPath!.incomplete).toBe(false)
    const serialised = JSON.stringify(report.toolPath)
    expect(serialised).not.toContain('file_path')
    expect(serialised).not.toContain('PUT 1.=1')
    expect(serialised).not.toContain('tools.read')
  })

  it('never yields a clean tool-path verdict on an incomplete session', () => {
    const report = extract({ tasks: [{ id: 'T3', kind: 'text-update', targets: ['src/a.ts'] }], tornStart: 10 })
    expect(report.evidence.status).toBe('incomplete')
    expect(report.toolPath!.incomplete).toBe(true)
    expect(report.toolPath!.tasks[0].verdict).toBe('unknown')
    expect(report.toolPath!.summary[0]).toContain('unknown')
  })
})
