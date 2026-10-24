/**
 * Failure-input tests for scripts/extract-runtime-evidence.mjs.
 *
 * The tool is the only thing standing between a live session log and a report
 * claim, so every way the input can fall short of evidence is pinned here: a
 * missing carrier message, a cross-turn carrier, a torn frame, a range the log
 * does not cover, a seq gap with no bounds given, a start without a settle —
 * each must produce INCOMPLETE/GAP, never a PASS.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { extractSession, validateBounds } from '../../scripts/extract-runtime-evidence.mjs'
import type { ExtractedReport } from '../../scripts/extract-runtime-evidence.mjs'

const SCRIPT = new URL('../../scripts/extract-runtime-evidence.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')
const SESSION = 'session-test-0001'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const record = (value: Record<string, unknown>) => JSON.stringify(value)
const header = (id = SESSION) => record({ type: 'session', version: 4, id, cwd: 'C:/work', agentPreset: 'ptc' })
const seqZero = record({ type: 'permission/preset', seq: 0, data: { preset: 'workspace-write' } })
const preset = record({ type: 'agent-preset/selected', seq: 1, data: { agentPreset: 'ptc-hashline' } })
const user = record({ type: 'user/message', seq: 2, data: { role: 'user', content: [{ type: 'text', text: 'fix the bug' }], source: { kind: 'user' } } })
const assistant = (seq: number, text: string, turn = 1) => record({ type: 'assistant/message', seq, data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } })
const call = (seq: number, name: string, callId = 'c1', turn = 1) => record({ type: 'tool/call', seq, data: { turn, step: 1, callId, name, arguments: '{}' } })
const startEvent = (seq: number, name: string, rootCallId = 'c1', subCallId = 's1') => record({ type: 'tool/ptc-dispatch-start', seq, data: { rootCallId, parentCallId: rootCallId, subCallId, name } })
const settle = (seq: number, name: string, body = '', rootCallId = 'c1', subCallId = 's1') => record({ type: 'tool/ptc-dispatch', seq, data: { rootCallId, parentCallId: rootCallId, subCallId, name, isError: body.includes('[intent-gate]'), content: body === '' ? [] : [{ type: 'text', text: body }] } })
const result = (seq: number, text: string, callId = 'c1') => record({ type: 'tool/result', seq, data: { turn: 1, step: 1, toolCallId: callId, message: { role: 'tool', content: [{ type: 'text', text }] } } })

const DENIAL = '被拒的是 **edit** 调用\n[intent-gate] 这一次调用没有门行垫底 —— 本轮还没有出现过那个六桶行。'

async function writeRaw(name: string, lines: string[]): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'extract-evidence-'))
  dirs.push(dir)
  const file = path.join(dir, name)
  await writeFile(file, lines.join('\n') + '\n', 'utf8')
  return file
}

async function writeFramed(name: string, frames: string[][], torn?: (frame: Buffer) => Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'extract-evidence-'))
  dirs.push(dir)
  const file = path.join(dir, name)
  const buffers: Buffer[] = frames.map(lines => zstdCompressSync(Buffer.from(lines.join('\n') + '\n', 'utf8')))
  if (torn !== undefined) buffers[buffers.length - 1] = torn(buffers[buffers.length - 1]!)
  await writeFile(file, Buffer.concat(buffers))
  return file
}

interface RunResult { status: number; json?: ExtractedReport; stderr: string }

function run(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    return { status: 0, json: JSON.parse(stdout) as ExtractedReport, stderr: '' }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    const stdout = failure.stdout ?? ''
    return { status: failure.status ?? -1, json: stdout.trim() === '' ? undefined : JSON.parse(stdout) as ExtractedReport, stderr: failure.stderr ?? '' }
  }
}

const runFile = (file: string, extra: string[] = []) => run(['--source', file, '--session', SESSION, ...extra])

const base = (assistantText: string | undefined) => [
  header(),
  seqZero,
  preset,
  user,
  ...assistantText === undefined ? [] : [assistant(3, assistantText)],
  call(4, 'run_code'),
  startEvent(5, 'edit'),
  settle(6, 'edit'),
  result(7, 'done'),
]
const ALL = ['--seq-min', '0', '--seq-max', '7']

describe('extract-runtime-evidence: the evidence it must not manufacture', () => {
  it('reports a legal gate line on the carrier of the first behavior call', async () => {
    const source = await writeRaw('session.v4.jsonl', base('Intent: fix — repair the parser'))
    const { status, json } = runFile(source, ALL)
    expect(status).toBe(0)
    const evidence = json!.evidence
    expect(evidence.status).toBe('complete')
    expect(evidence.tally.valid).toBe(1)
    expect(evidence.states.completed).toBe(1)
    expect(evidence.perTurn).toEqual([{
      turn: 1,
      firstBehavior: { seq: 5, name: 'edit', via: 'ptc', state: 'completed' },
      carrierSeq: 3,
      carrierFirstLine: 'Intent: fix — repair the parser',
      carrierGate: 'valid',
      turnGate: 'valid',
    }])
    expect(evidence.denials).toEqual([])
  })

  it('counts one behavior call once although it emits a start AND a settle', async () => {
    const source = await writeRaw('session.v4.jsonl', base('Intent: fix — repair the parser'))
    const report = runFile(source, ALL).json!
    expect(report.evidence.behaviorCalls).toHaveLength(1)
    const [only] = report.evidence.behaviorCalls
    expect(only?.startSeq).toBe(5)
    expect(only?.doneSeq).toBe(6)
    expect(only?.state).toBe('completed')
  })

  it('reports a missing gate line instead of inventing an allow', async () => {
    const source = await writeRaw('session.v4.jsonl', base('I will start by reading the file.'))
    const { json } = runFile(source, ALL)
    expect(json!.evidence.tally.missing).toBe(1)
    expect(json!.evidence.tally.valid).toBe(0)
    // A missing line is a finding; it is NOT a synthetic deny event.
    expect(json!.evidence.denials).toEqual([])
    expect(json!.evidence.status).toBe('complete')
  })

  it('treats a missing same-turn carrier as incomplete evidence, not a passing turn', async () => {
    const source = await writeRaw('session.v4.jsonl', base(undefined))
    const { status, json } = runFile(source, ALL)
    expect(status).toBe(2)
    expect(json!.evidence.status).toBe('incomplete')
    expect(json!.evidence.tally.unassociated).toBe(1)
    expect(json!.evidence.issues.join(' ')).toContain('without a same-turn carrier assistant message')
  })

  it('never borrows an earlier turn\'s declaration for a later turn', async () => {
    // turn 1 declares; turn 2 calls run_code and dispatches edit with no turn-2 message.
    const lines = [
      header(),
      seqZero,
      preset,
      user,
      assistant(3, 'Intent: fix — repair the parser', 1),
      call(4, 'run_code', 'c1', 2),
      startEvent(5, 'edit'),
      settle(6, 'edit'),
    ]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source, ['--seq-min', '0', '--seq-max', '6'])
    expect(report.status).toBe(2)
    const [call0] = report.json!.evidence.behaviorCalls
    expect(call0?.turn).toBe(2)
    expect(call0?.carrierSeq).toBeUndefined()
    expect(call0?.carrierGate).toBe('unassociated')
    expect(report.json!.evidence.perTurn[0]).toMatchObject({ turn: 2, carrierSeq: null, carrierGate: 'unassociated', turnGate: 'unassociated' })
    expect(report.json!.evidence.issues.join(' ')).toContain('without a same-turn carrier')
  })

  it('separates the turn-level declaration from the exact carrier message', async () => {
    // A declaration earlier in the turn still satisfies the gate for later bare
    // tool messages, but those messages' own carrier gate stays 'no-text'.
    const lines = [
      header(),
      seqZero,
      preset,
      user,
      assistant(3, 'Intent: implementation — apply the change'),
      assistant(4, ''),
      call(5, 'run_code'),
      startEvent(6, 'edit'),
      settle(7, 'edit'),
    ]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source, ['--seq-min', '0', '--seq-max', '7']).json!
    const [call0] = report.evidence.behaviorCalls
    expect(call0?.carrierSeq).toBe(4)
    expect(call0?.carrierGate).toBe('no-text')
    expect(call0?.turnGate).toBe('valid')
    expect(report.evidence.status).toBe('complete')
  })

  it('associates each PTC dispatch with its own root call', async () => {
    const lines = [
      header(),
      seqZero,
      preset,
      user,
      assistant(3, 'Intent: fix — repair the parser'),
      call(4, 'run_code', 'r1'),
      startEvent(5, 'edit', 'r1', 'a'),
      settle(6, 'edit', '', 'r1', 'a'),
      assistant(7, ''),
      call(8, 'run_code', 'r2'),
      startEvent(9, 'write', 'r2', 'b'),
      settle(10, 'write', '', 'r2', 'b'),
    ]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source, ['--seq-min', '0', '--seq-max', '10']).json!
    expect(report.evidence.behaviorCalls.map(entry => [entry.name, entry.carrierSeq])).toEqual([['edit', 3], ['write', 7]])
    expect(report.evidence.states.completed).toBe(2)
  })

  it('reports a refusal that settled without a start event, and does not double count it', async () => {
    const lines = [
      header(),
      seqZero,
      preset,
      user,
      assistant(3, 'I forgot the line.'),
      call(4, 'run_code'),
      settle(5, 'edit', DENIAL),
    ]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source, ['--seq-min', '0', '--seq-max', '5']).json!
    expect(report.evidence.behaviorCalls).toHaveLength(1)
    expect(report.evidence.behaviorCalls[0]?.state).toBe('denied')
    expect(report.evidence.states.denied).toBe(1)
    expect(report.evidence.denials).toHaveLength(1)
    expect(report.evidence.denials[0]?.reasonFirstLine.startsWith('被拒的是')).toBe(true)
    expect(report.evidence.status).toBe('complete')
  })

  it('counts one refusal once even when it also surfaces in the root tool result', async () => {
    const lines = [
      header(),
      seqZero,
      preset,
      user,
      assistant(3, 'I forgot the line.'),
      call(4, 'run_code', 'c1'),
      settle(5, 'edit', DENIAL, 'c1', 's1'),
      result(6, 'code run failed (exception): ToolCallError: ' + DENIAL, 'c1'),
    ]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source, ['--seq-min', '0', '--seq-max', '6'])
    expect(report.status).toBe(0)
    expect(report.json!.evidence.denials).toHaveLength(1)
    expect(report.json!.evidence.denials[0]?.type).toBe('tool/ptc-dispatch')
    expect(report.json!.evidence.behaviorCalls).toHaveLength(1)
  })

  it('reports a start with no settle as incomplete instead of a finished call', async () => {
    // header..start only: the settle event (index 6 of base) is dropped.
    const lines = [header(), seqZero, preset, user, assistant(3, 'Intent: fix — repair the parser'), call(4, 'run_code'), startEvent(5, 'edit'), result(7, 'done')]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source, ALL)
    expect(report.status).toBe(2)
    expect(report.json!.evidence.behaviorCalls[0]?.state).toBe('started')
    expect(report.json!.evidence.issues.join(' ')).toContain('no settle inside the range')
  })

  it('flags a seq gap even when the caller passes no bounds', async () => {
    const lines = [header(), seqZero, preset, assistant(8, 'Intent: fix — x'), call(9, 'run_code')]
    const source = await writeRaw('session.v4.jsonl', lines)
    const report = runFile(source)
    expect(report.status).toBe(2)
    expect(report.json!.range.effective).toEqual({ min: 0, max: 9 })
    expect(report.json!.evidence.issues.join(' ')).toContain('missing seq values')
  })

  it('refuses a range the snapshot does not cover instead of claiming the whole session', async () => {
    const source = await writeRaw('session.v4.jsonl', base('Intent: fix — repair the parser'))
    const { status, json } = runFile(source, ['--seq-min', '0', '--seq-max', '99'])
    expect(status).toBe(2)
    expect(json!.evidence.status).toBe('incomplete')
    expect(json!.range.covered).toBe(false)
    expect(json!.evidence.issues.join(' ')).toContain('exceeds the last available seq')
  })

  it('refuses inverted and negative and non-integer bounds', async () => {
    const source = await writeRaw('session.v4.jsonl', base('Intent: fix — repair the parser'))
    for (const bounds of [['--seq-min', '3', '--seq-max', '0'], ['--seq-min', '-1', '--seq-max', '7'], ['--seq-min', '0.5', '--seq-max', '7']]) {
      const report = runFile(source, bounds)
      expect(report.status, bounds.join(' ')).toBe(3)
      expect(report.stderr).toMatch(/must not exceed|must not be negative|safe integer/u)
    }
  })

  it('validates bounds in the exported function too, not only in the CLI', () => {
    expect(() => validateBounds(3, 0)).toThrow(/must not exceed/u)
    expect(() => validateBounds(-1, 4)).toThrow(/must not be negative/u)
    expect(() => validateBounds(0, 1.5)).toThrow(/safe integer/u)
    expect(() => validateBounds(undefined, 4)).toThrow(/given together/u)
    expect(validateBounds(0, 4)).toEqual({ min: 0, max: 4 })
  })

  it('refuses the same defects when called directly with in-memory text', async () => {
    const buffer = Buffer.from(base('Intent: fix — repair the parser').join('\n') + '\n', 'utf8')
    const call_ = (seqMin?: number, seqMax?: number) => extractSession({
      sourcePath: 'memory',
      sessionId: SESSION,
      seqMin,
      seqMax,
      extractedAt: '2026-10-23T00:00:00.000Z',
      bytes: buffer.length,
      buffer,
      text: buffer.toString('utf8'),
      format: 'jsonl.v4',
      frames: 0,
    })
    expect(() => call_(3, 0)).toThrow(/must not exceed/u)
    // No bounds: the effective range is checked for gaps like any other range.
    const gapped = Buffer.from([header(), seqZero, assistant(8, 'Intent: fix — x')].join('\n') + '\n', 'utf8')
    const report = extractSession({ sourcePath: 'memory', sessionId: SESSION, extractedAt: 't', bytes: gapped.length, buffer: gapped, text: gapped.toString('utf8'), format: 'jsonl.v4', frames: 0 })
    expect(report.evidence.status).toBe('incomplete')
    expect(report.evidence.issues.join(' ')).toContain('missing seq values')
  })

  it('decodes every complete zstd frame and reports a torn final frame', async () => {
    const source = await writeFramed('session.v4.jsonl.zstd', [
      [header(), seqZero, preset, user],
      [assistant(3, 'Intent: investigation — inspect'), call(4, 'run_code')],
      [startEvent(5, 'edit'), settle(6, 'edit')],
    ], frame => frame.subarray(0, frame.length - 6))
    const { status, json } = runFile(source, ['--seq-min', '0', '--seq-max', '6'])
    expect(status).toBe(2)
    expect(json!.source.format).toBe('jsonl.v4.zstd')
    // Both complete frames were decoded; the torn one is reported, not half-read.
    expect(json!.source.frames).toBe(2)
    expect(json!.evidence.issues.join(' ')).toContain('torn-final-frame')
    expect(json!.evidence.status).toBe('incomplete')
  })

  it('refuses a source whose header names a different session', async () => {
    const source = await writeRaw('session.v4.jsonl', [header('session-other'), preset])
    const { status, stderr } = runFile(source)
    expect(status).toBe(3)
    expect(stderr).toContain('does not match --session')
  })

  it('reports an unparsable record instead of dropping it', async () => {
    const source = await writeRaw('session.v4.jsonl', [...base('Intent: fix — repair the parser'), '{not json'])
    const report = runFile(source, ALL)
    expect(report.status).toBe(2)
    expect(report.json!.evidence.status).toBe('incomplete')
    expect(report.json!.evidence.issues.join(' ')).toContain('unparsable record')
  })

  it('redacts arguments, tool bodies and credentials, and still fingerprints the input', async () => {
    const lines = [
      header(),
      seqZero,
      preset,
      user,
      assistant(3, 'Intent: implementation — apply the change'),
      record({ type: 'tool/call', seq: 4, data: { turn: 1, step: 1, callId: 'c1', name: 'run_code', arguments: '{"apiKey":"sk-secret-value","authorization":"Bearer sk-secret-value"}' } }),
      startEvent(5, 'edit'),
      settle(6, 'edit'),
      record({ type: 'tool/result', seq: 7, data: { turn: 1, step: 1, toolCallId: 'c1', message: { role: 'tool', content: [{ type: 'text', text: 'sk-secret-value in a tool body' }] } } }),
    ]
    const source = await writeRaw('session.v4.jsonl', lines)
    const stdout = execFileSync(process.execPath, [SCRIPT, '--source', source, '--session', SESSION, '--seq-min', '0', '--seq-max', '7'], { encoding: 'utf8' })
    expect(stdout).not.toContain('sk-secret-value')
    const report = JSON.parse(stdout) as ExtractedReport
    const bytes = await readFile(source)
    expect(report.source.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})

/**
 * R4: the cost of a gap report depends on how many records the log HAS, never on
 * how wide the requested range is.
 *
 * The old implementation stepped `for (seq = min; seq <= max; seq += 1)`, so
 * `--seq-max 1e12` walked a trillion integers and had to be killed. The bound
 * below is deliberately generous — the clamp is "it finishes at all", and the
 * exact milliseconds are not a performance contract.
 */
describe('extract-runtime-evidence: a huge seq bound is answered, not walked', () => {
  it('answers a 1e12 seq-max promptly with an interval-shaped gap, and exits 2', async () => {
    const source = await writeRaw('session.v4.jsonl', base('Intent: fix — repair the parser'))
    const started = Date.now()
    const child = spawnSync(process.execPath, [SCRIPT, '--source', source, '--session', SESSION, '--seq-min', '0', '--seq-max', '1000000000000'], {
      encoding: 'utf8',
      timeout: 20_000,
      killSignal: 'SIGKILL',
    })
    const elapsed = Date.now() - started

    // A timeout leaves `error` set and no output; a real answer is a real one.
    expect(child.error).toBeUndefined()
    expect(child.status).toBe(2)
    const json = JSON.parse(child.stdout) as ExtractedReport
    expect(json.evidence.status).toBe('incomplete')

    // The hole is reported as an INTERVAL, so the message cannot grow with the
    // range — which is what makes a wide bound cheap to report.
    const gapIssue = json.evidence.issues.find((issue) => issue.includes('missing seq values inside the effective range'))
    expect(gapIssue).toBeDefined()
    expect(String(gapIssue)).toContain('1000000000000')
    expect(String(gapIssue).length).toBeLessThan(260)
    // A full, dense range stays complete: the bound must not turn a good log bad.
    const dense = runFile(source, ALL)
    expect(dense.status).toBe(0)
    expect(dense.json?.evidence.status).toBe('complete')
    expect(elapsed).toBeLessThan(20_000)
  })
})

/**
 * F10: the ordinary rendering of a gap is pinned exactly.
 *
 * The bound changed the message SHAPE (enumeration -> intervals), and every other
 * assertion in this file only checks `toContain('missing seq values')`: an
 * off-by-one in the interval ends for a one-value gap would pass the whole suite.
 */
describe('extract-runtime-evidence: the gap message is an interval list, pinned exactly', () => {
  it('prints single holes as numbers and runs as from..to', async () => {
    const holed = [header(), seqZero, preset, user, assistant(3, 'Intent: fix — repair the parser'), startEvent(5, 'edit'), result(7, 'done')]
    const source = await writeRaw('session.v4.jsonl', holed)
    const inside = runFile(source, ['--seq-min', '0', '--seq-max', '7'])
    expect(inside.json?.evidence.issues).toContain('missing seq values inside the effective range: 4,6')
    // A run at the END of the range is one interval, not a list that grows with it.
    const throughTail = runFile(source, ['--seq-min', '0', '--seq-max', '9'])
    expect(throughTail.json?.evidence.issues).toContain('missing seq values inside the effective range: 4,6,8..9')
  })
})
