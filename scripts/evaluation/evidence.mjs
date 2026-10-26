/** Offline, redacted evaluation facts. Raw arguments/content never leave this module. */
import { readFileSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { decodeArtifact, parseRecords } from '../../presets/ptc-hashline/operations/session-log.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const count = value => Number.isSafeInteger(value) && value >= 0
const errorCode = value => String(value ?? '').match(/\b(?:EDIT_POLICY_[A-Z_]+|FS_[A-Z_]+|[A-Z_]*CANCEL[A-Z_]*)\b/u)?.[0] ?? 'unknown'
const payload = args => {
  try { args = typeof args === 'string' ? JSON.parse(args) : args } catch { return 'unknown' }
  if (args?.old_string !== undefined) return 'replace'
  if (args?.edits !== undefined) return 'patch'
  if (typeof args?.input === 'string') return /^\s*\[/u.test(args.input) ? 'hashline' : 'apply_patch'
  return 'unknown'
}

export function traceSummary(records, { receipts = [], arm, complete = true, seqStart = 0, delegationCovered = false } = {}) {
  const gaps = []
  const events = records.filter(r => Number.isSafeInteger(r.seq))
  if (!events.length) gaps.push('no sequenced events')
  for (let i = 0; i < events.length; i++) {
    if (events[i].seq !== i + seqStart) { gaps.push('non-dense or duplicate/out-of-order seq'); break }
  }
  if (!complete || !records.some(r => r.type === 'turn/end')) gaps.push('no completed capture/turn boundary')
  const turnOutcome = records.findLast(r => r.type === 'turn/end')?.data?.reason?.kind ?? 'unknown'
  if (turnOutcome === 'unknown') gaps.push('turn outcome unknown')
  const calls = new Map()
  for (const event of records) {
    const d = event.data ?? {}
    const inner = event.type.startsWith('tool/ptc-dispatch')
    const start = event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start'
    const end = event.type === 'tool/result' || event.type === 'tool/ptc-dispatch'
    if (!start && !end) continue
    const id = inner ? d.subCallId : start ? d.callId : d.message?.toolCallId
    if (typeof id !== 'string') { gaps.push('missing call identity at seq ' + event.seq); continue }
    const key = (inner ? 'inner:' : 'outer:') + id
    const call = calls.get(key) ?? { id, layer: inner ? 'inner' : 'outer' }
    if (start) {
      if (call.startSeq !== undefined) gaps.push('duplicate start: ' + key)
      Object.assign(call, { name: d.name, rootCallId: d.rootCallId ?? id, startSeq: event.seq, requestedMode: d.name === 'edit' ? payload(d.arguments) : undefined })
    } else {
      if (call.endSeq !== undefined) gaps.push('duplicate settle: ' + key)
      if (inner && ((d.name && call.name && d.name !== call.name) || (d.rootCallId && call.rootCallId && d.rootCallId !== call.rootCallId))) gaps.push('mismatched settle identity: ' + key)
      if (!inner && event.sourceEventSeqs && !event.sourceEventSeqs.includes(call.startSeq)) gaps.push('mismatched result call seq: ' + key)
      call.endSeq = event.seq
      call.isError = (inner ? d.isError : d.message?.isError) === true
      call.code = errorCode(d.error?.code ?? JSON.stringify(d.content ?? d.message?.content))
    }
    calls.set(key, call)
  }
  for (const [key, call] of calls) {
    if (call.startSeq === undefined || call.endSeq === undefined || call.endSeq <= call.startSeq) gaps.push('unpaired call: ' + key)
    if (call.layer === 'inner' && !calls.has('outer:' + call.rootCallId)) gaps.push('missing outer call: ' + key)
    if (call.name === 'edit') {
      const rs = receipts.filter(r => r.callId === call.id)
      call.receipts = rs
      call.selectedMode = rs.at(-1)?.mode ?? 'unknown'
      call.actualMode = rs.find(r => r.result === 'completed')?.mode ?? (arm === 'stock-edit' && call.isError === false ? 'replace' : 'unknown')
      call.execution = rs.at(-1)?.result === 'refused' ? 'refused' : call.isError === false ? 'completed' : 'unknown'
    }
  }
  const list = [...calls.values()]
  if (!delegationCovered && list.some(c => ['subagent', 'subagent_fork'].includes(c.name))) gaps.push('child session coverage unknown; root trace only')
  const edits = list.filter(c => c.name === 'edit')
  const knownModes = edits.map(c => c.actualMode === 'hashline' ? 'hashline' : c.actualMode === 'unknown' ? 'unknown' : 'non-hashline')
  const modes = [...new Set(knownModes)]
  const attempts = records.filter(r => ['assistant/message', 'assistant/attempt'].includes(r.type))
  const total = field => attempts.length && attempts.every(r => count(r.data?.usage?.[field])) ? attempts.reduce((sum, r) => sum + r.data.usage[field], 0) : 'unknown'
  // DSH usage input is UNCACHED. Aggregate input must include cache to compare cost.
  const aggregateInput = attempts.length && attempts.every(r => count(r.data?.usage?.totalTokens) && count(r.data?.usage?.outputTokens) && r.data.usage.totalTokens >= r.data.usage.outputTokens)
    ? attempts.reduce((sum, r) => sum + r.data.usage.totalTokens - r.data.usage.outputTokens, 0) : 'unknown'
  return {
    status: gaps.length ? 'GAP' : 'PASS', scope: 'root-session', turnOutcome, gaps, calls: list,
    costs: { inputTokens: gaps.length ? 'unknown' : aggregateInput, outputTokens: gaps.length ? 'unknown' : total('outputTokens'), uncachedInputTokens: total('inputTokens'), totalTokens: gaps.length ? 'unknown' : total('totalTokens'), modelRequests: gaps.length ? 'unknown' : attempts.length, runCodeCalls: gaps.length ? 'unknown' : list.filter(c => c.name === 'run_code').length, innerToolCalls: gaps.length ? 'unknown' : list.filter(c => c.layer === 'inner').length, reads: gaps.length ? 'unknown' : list.filter(c => c.name === 'read').length, verifications: 'unknown', wallMs: 'unknown' },
    editCalls: edits.length, retries: 'unknown', internalRetries: receipts.some(r => r.retry !== undefined) ? receipts.filter(r => r.retry > 0).length : 'unknown',
    failures: edits.filter(c => c.isError).length,
    recovered: edits.some((c, i) => !c.isError && edits.slice(0, i).some(p => p.isError)),
    firstAttempt: gaps.length ? 'unknown' : edits[0]?.selectedMode === 'hashline' ? 'hashline' : edits[0]?.selectedMode && edits[0].selectedMode !== 'unknown' ? 'non-hashline' : knownModes[0] ?? 'not-attempted',
    mode: gaps.length || modes.includes('unknown') ? 'unknown' : modes.length > 1 ? 'mixed' : modes[0] ?? 'not-attempted',
    firstCandidateCorrect: 'unknown', // task-end cannot establish a pre-repair checkpoint
  }
}

export function decodeTrace(bytes, sessionId, options) {
  const decoded = decodeArtifact(bytes)
  const parsed = parseRecords(decoded.text)
  const header = parsed.records.find(r => r.type === 'session')
  if (header?.id !== sessionId) throw new Error('EVAL_SESSION_IDENTITY: wrong or missing header')
  const summary = traceSummary(parsed.records, { ...options, complete: decoded.tornStart === undefined && !parsed.failures.length })
  return { ...summary, sourceHash: digest(bytes), frames: decoded.frames, parseFailures: parsed.failures.length }
}

/** A candidate is one predeclared edit-bearing PTC program, not one inner edit. */
export function candidateSummary(trace, batches, boundary) {
  if (boundary !== 'first-edit-program') return { batches: [], candidateStatus: 'not-measured', firstCandidateCorrect: 'unknown', retries: 'unknown' }
  const roots = trace.calls.filter(c => c.name === 'run_code' && trace.calls.some(edit => edit.name === 'edit' && edit.rootCallId === c.id && edit.sessionId === c.sessionId))
  if (batches.some(b => b.boundary !== undefined)) {
    const end = call => call.endOrder ?? call.endSeq
    const start = call => call.startOrder ?? call.startSeq
    const overlaps = roots.some((r, i) => i > 0 && end(roots[i - 1]) >= start(r))
    const expected = roots.flatMap(root => {
      const edits = trace.calls.filter(c => c.name === 'edit' && c.rootCallId === root.id && c.sessionId === root.sessionId).sort((a, b) => end(a) - end(b))
      const failures = edits.filter(c => c.isError === true).map(call => ({ root, call, boundary: 'edit-failure' }))
      return edits.at(-1)?.isError === false ? [...failures, { root, call: root, boundary: 'program-end' }] : failures
    }).sort((a, b) => end(a.call) - end(b.call))
    const paired = expected.length === batches.length && expected.every((e, i) => {
      const b = batches[i]
      return b.id === e.root.sessionId + ':' + e.root.id + ':' + i && b.sessionId === e.root.sessionId && b.callId === e.root.id && b.boundaryCallId === e.call.id && b.boundary === e.boundary && b.attempt === i && b.retryOf === (i ? batches[i - 1].id : undefined) && typeof b.final?.correct === 'boolean'
    })
    if (!paired || overlaps || trace.status !== 'PASS') return { batches, candidateStatus: 'GAP', firstCandidateCorrect: 'unknown', retries: 'unknown' }
    return { batches, candidateStatus: 'PASS', firstCandidateCorrect: batches[0]?.final.correct ?? 'unknown', retries: Math.max(0, batches.length - 1) }
  }
  if (roots.some(root => {
    const edits = trace.calls.filter(c => c.name === 'edit' && c.rootCallId === root.id && c.sessionId === root.sessionId)
    return edits.some((edit, i) => edit.isError === true && edits.length > i + 1)
  })) return { batches, candidateStatus: 'GAP', firstCandidateCorrect: 'unknown', retries: 'unknown' }
  const paired = roots.length === batches.length && roots.every((r, i) => batches[i]?.callId === r.id && (!r.sessionId || batches[i]?.sessionId === r.sessionId) && batches[i]?.attempt === i && (i === 0 ? batches[i].retryOf === undefined : batches[i].retryOf === roots[i - 1].id && (!r.sessionId || batches[i].retryOfSessionId === roots[i - 1].sessionId)) && typeof batches[i]?.final?.correct === 'boolean')
  const overlaps = roots.some((r, i) => i > 0 && (roots[i - 1].endOrder ?? roots[i - 1].endSeq) >= (r.startOrder ?? r.startSeq))
  if (!paired || overlaps || trace.status !== 'PASS') return { batches, candidateStatus: 'GAP', firstCandidateCorrect: 'unknown', retries: 'unknown' }
  return { batches, candidateStatus: 'PASS', firstCandidateCorrect: batches[0]?.final.correct ?? 'unknown', retries: Math.max(0, batches.length - 1) }
}

export function treeState(directory) {
  const result = Object.create(null)
  const visit = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name), relative = prefix + name, stat = lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error('EVAL_TREE_SYMLINK: ' + relative)
      if (stat.isDirectory()) visit(file, relative + '/')
      else if (stat.isFile()) result[relative] = readFileSync(file)
      else throw new Error('EVAL_TREE_SPECIAL_FILE: ' + relative)
    }
  }
  visit(directory, '')
  return result
}

export function verifyTree(initial, expected, actual) {
  // Unmentioned initial files must remain unchanged; expected null means deletion.
  const wanted = { ...initial, ...expected }
  const files = [...new Set([...Object.keys(wanted), ...Object.keys(actual)])].sort().map(name => {
    const before = !Object.hasOwn(initial, name) || initial[name] == null ? null : digest(Buffer.from(initial[name]))
    const after = !Object.hasOwn(actual, name) || actual[name] == null ? null : digest(actual[name])
    const expect = !Object.hasOwn(wanted, name) || wanted[name] == null ? null : digest(Buffer.from(wanted[name]))
    return { name, before, expected: expect, actual: after, changed: before !== after, correct: expect === after }
  })
  return { correct: files.every(f => f.correct), changed: files.some(f => f.changed), files }
}

export function writeExpectedDiff(initial, expected, actualDirectory, evidenceDirectory) {
  const desired = { ...initial, ...expected }
  mkdirSync(evidenceDirectory)
  const expectedDirectory = join(evidenceDirectory, 'expected')
  mkdirSync(expectedDirectory)
  for (const [name, content] of Object.entries(desired)) {
    if (content === null) continue
    const file = join(expectedDirectory, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  let diff
  try { diff = execFileSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--text', '--', expectedDirectory, actualDirectory], { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }
  catch (e) { if (e.status !== 1 || !e.stdout) return 'unknown'; diff = e.stdout }
  writeFileSync(join(evidenceDirectory, 'actual.diff'), diff)
  return digest(diff)
}
