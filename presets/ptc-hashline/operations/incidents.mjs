/**
 * Incident evidence assembly for the ptc-hashline operations skill (INC-01..06).
 *
 * One explicit session and seq range in; one redacted bundle out. The module
 * never touches the source log and never replays, cleans or repairs anything:
 * it decodes what the host recorded, pairs each PTC dispatch by subCallId,
 * classifies what it saw, and writes the evidence package the skill body names.
 *
 * Classification and severity are separate axes on purpose (INC-02): a call can
 * be a completed success, a partial success, an expected refusal, a model-input
 * error, an environment problem or a suspected implementation defect, and a
 * missing settle is evidence about the range rather than a verdict about the
 * code. 'complete'/'completed' alone is never treated as success (INC-04).
 *
 * Redaction is applied to every exported string (INC-05): tool arguments and
 * bodies never leave this module, and the first lines, paths and statements that
 * do leave it pass through {@link redactText}. The original log is untouched.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/incidents
 */
import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { replayRoute } from './context.mjs'
import { clip, firstLineOf, textOfBlocks } from './text.mjs'

/** Report identity written into every bundle. */
export const INCIDENT_TOOL = 'ptc-hashline-operations-incident'
/** Report schema version. */
export const INCIDENT_VERSION = 1
/** Feature slug used for auto-registered triage issues unless overridden. */
export const DEFAULT_FEATURE = 'ptc-hashline-operations-skills'
/** Triage status the issue tracker uses for a not-yet-evaluated report. */
export const TRIAGE_STATUS = 'needs-triage'

/** The gate's refusal marker, distinct from the watchdog's own notices. */
const GATE_MARK = '[intent-gate]'
/** Cancellation wording a host reports for an aborted call. */
const CANCELLED_RE = /\b(?:abort(?:ed)?|cancell?ed)\b/iu
/** Wording that only a partially landed call produces (ADR-0004). */
const PARTIAL_MARKERS = [
  /Sections already written/u,
  /Sections not written/u,
  /but the move did not complete/u,
  /移动未完成/u,
  /目标已创建/u,
  /but the hashline snapshot bookkeeping did not complete/u,
]
/** Kinds that need follow-up and therefore a needs-triage issue (INC-06). */
const ACTIONABLE = new Set(['suspected-implementation-defect', 'partial-success', 'user-reported-mismatch'])

/** What each actionable kind may mean, stated as a hypothesis, never a verdict. */
const HYPOTHESES = {
  'suspected-implementation-defect': 'The call failed in a way that matches no expected refusal, model-input error or environmental cause. The recorded text suggests a defect in the tool or engine rather than in the model-s input; reproduce from the evidence package before changing code.',
  'partial-success': 'The call reported a partial success: part of its effect landed on disk. Verify both endpoints (or the already-written sections) before retrying; this repository does not promise an automatic rollback.',
  'user-reported-mismatch': 'The user reports that a call recorded as successful produced a wrong result. The log cannot see silent corruption: compare the file bytes, a diff or a test result independently before assuming the tool is wrong.',
}

/**
 * Mask credentials, tokens and the user home in one exported string.
 *
 * The patterns are deliberately narrow: a token that looks like a key is
 * masked wherever it appears (an argument echoed into an error, a path segment,
 * a first line), and the home directory collapses to `~` so a path cannot leak
 * the operator's identity. Nothing else is rewritten.
 * @param {string} text the string about to be exported
 * @param {{home?: string}} [options] home directory override (tests pin it)
 * @returns {string} the redacted string
 */
export function redactText(text, options = {}) {
  if (typeof text !== 'string' || text === '') return text
  let out = text
  out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, 'sk-***')
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gu, '$1 ***')
  out = out.replace(/\b(api[-_]?key|access[-_]?token|password|passwd|secret|authorization)(["']?\s*[:=]\s*["']?)([^\s"',;]{3,})/giu, '$1$2***')
  const home = typeof options.home === 'string' ? options.home : homedir()
  if (home !== '' && out.includes(home)) out = out.split(home).join('~')
  return out
}

/**
 * The first error code or error class name recorded in a call body.
 * @param {string | undefined} body decoded call text
 * @returns {string | null} the code/class, or null
 */
export function errorCodeOf(body) {
  const match = /(FS_[A-Z][A-Z_]*|ToolOutputError|ToolCallError|SnapshotCommitError|MismatchError|SubagentDepthError)/u.exec(body ?? '')
  return match === null ? null : match[1]
}

/**
 * Redact every string inside a plain value.
 *
 * The baseline bundle carries session directories and resolved paths, so a
 * secret echoed into a workspace name must not survive it. The walk returns a
 * copy; the caller's object is untouched.
 * @param {unknown} value any JSON-shaped value
 * @param {{home?: string}} [options] home directory override
 * @returns {unknown} a redacted copy
 */
export function redactDeep(value, options = {}) {
  if (typeof value === 'string') return redactText(value, options)
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, options))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value)) out[key] = redactDeep(entry, options)
    return out
  }
  return value
}

/**
 * Classify one observed call into a kind and a separate severity.
 *
 * Order matters: a cancellation is a cancellation whatever its text also
 * contains; a partial success is a partial success even though it is reported
 * as an error; an error text that matches nothing known is evidence
 * insufficiency, never a guessed cause.
 * @param {{state: string, isError: boolean | null, body?: string}} event the call facts
 * @returns {{kind: string, severity: string, detail: string}} the classification
 */
export function classifyEvent(event) {
  const body = event.body ?? ''
  if (event.state === 'denied') return { kind: 'expected-refusal', severity: 'info', detail: 'The intent gate refused the call; this is the workflow working as designed.' }
  if (event.state === 'started') return { kind: 'insufficient-evidence', severity: 'unknown', detail: 'The call started and never settled inside the range; state is unknown, not success.' }
  if (event.state === 'settled-without-start') return { kind: 'insufficient-evidence', severity: 'unknown', detail: 'The call settled without a start event; the lifecycle is incomplete.' }
  if (event.isError === true) {
    if (CANCELLED_RE.test(body)) return { kind: 'cancelled', severity: 'info', detail: 'The call was cancelled; nothing may be concluded about its intended effect.' }
    if (body.includes(GATE_MARK)) return { kind: 'expected-refusal', severity: 'info', detail: 'The intent gate refused the call; this is the workflow working as designed.' }
    if (PARTIAL_MARKERS.some((marker) => marker.test(body))) return { kind: 'partial-success', severity: 'warning', detail: 'Part of the call landed on disk; verify both endpoints before retrying.' }
    if (/FS_NOT_OBSERVED/u.test(body)) return { kind: 'expected-refusal', severity: 'info', detail: 'The observation policy refused a write to a target this session never read.' }
    if (/FS_SANDBOX_DENIED/u.test(body)) return { kind: 'expected-refusal', severity: 'info', detail: 'The sandbox refused the call; this is a policy decision, not a defect.' }
    if (/FS_IO_ERROR|\bEIO\b|\bEPERM\b|\bEACCES\b|FS_PERMISSION_DENIED/u.test(body)) return { kind: 'environment-problem', severity: 'warning', detail: 'The filesystem or the process permissions defeated the call.' }
    if (/FS_NOT_FOUND|ENOENT|FS_NOT_REGULAR_FILE|FS_NOT_TEXT|FS_STALE_VERSION|MismatchError|changed during the read|changed between the text read/u.test(body)) return { kind: 'environment-problem', severity: 'warning', detail: 'The target was missing, changed or unreadable when the call ran.' }
    if (/must be a (?:finite )?positive integer|must be less than or equal|must be a non-empty string|unexpected argument|invalid argument|UNKNOWN_TOOL|ToolCallError: tool/iu.test(body)) return { kind: 'model-parameter-error', severity: 'warning', detail: 'The model-s arguments or program were rejected before any effect.' }
    if (/TypeError|ReferenceError|SyntaxError|code run failed/iu.test(body)) return { kind: 'model-parameter-error', severity: 'warning', detail: 'The model-s own program failed; the log records the failure, not a tool defect.' }
    if (/ToolOutputError/u.test(body)) return { kind: 'suspected-implementation-defect', severity: 'high', detail: 'A tool returned a value that violates its own output schema.' }
    if (/SnapshotCommitError/u.test(body)) return { kind: 'partial-success', severity: 'warning', detail: 'The disk change landed but the hashline snapshot bookkeeping did not complete.' }
    return { kind: 'insufficient-evidence', severity: 'unknown', detail: 'The error text matches no known class; the cause is not stated.' }
  }
  return { kind: 'success', severity: 'info', detail: 'The call settled without an error; success alone does not prove the result is correct.' }
}

/**
 * Validate a requested seq range. Both bounds or neither; safe non-negative
 * integers; min <= max. Exported so a programmatic caller cannot bypass it.
 * @param {number} [seqMin] lower bound
 * @param {number} [seqMax] upper bound
 * @returns {{min: number, max: number} | undefined} the validated range
 */
export function validateSeqBounds(seqMin, seqMax) {
  if ((seqMin === undefined) !== (seqMax === undefined)) throw new Error('--seq-min and --seq-max must be given together')
  if (seqMin === undefined) return undefined
  for (const [name, value] of [['--seq-min', seqMin], ['--seq-max', seqMax]]) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(name + ' must be a safe integer')
    if (value < 0) throw new Error(name + ' must not be negative')
  }
  if (seqMin > seqMax) throw new Error('--seq-min must not exceed --seq-max')
  return { min: seqMin, max: seqMax }
}

/** Build one exported event: redacted first line, classification, lifecycle state. */
function buildEvent(input) {
  const body = input.body ?? ''
  const verdict = classifyEvent({ state: input.state, isError: input.isError, body })
  return {
    seq: input.startSeq ?? input.doneSeq,
    startSeq: input.startSeq ?? null,
    doneSeq: input.doneSeq ?? null,
    via: input.via,
    name: input.name ?? 'unknown',
    turn: input.turn ?? null,
    rootCallId: input.rootCallId ?? null,
    state: input.state,
    isError: input.isError ?? null,
    errorCode: errorCodeOf(body),
    kind: verdict.kind,
    severity: verdict.severity,
    detail: verdict.detail,
    firstLine: clip(redactText(firstLineOf(body), { home: input.home }), 240),
  }
}

/**
 * Assemble one incident report from an already-decoded session artifact.
 *
 * Throws (rather than guessing) when the header is missing or names another
 * session: that is not evidence about the target.
 * @param {object} options artifact, target identity, range, user report, time
 * @returns {object} the redacted incident report
 */
export function buildIncident(options) {
  const artifact = options.artifact
  const records = artifact.records ?? []
  const home = options.home
  const headerRecord = records.find((record) => record?.type === 'session')
  if (headerRecord === undefined) throw new Error('the source has no session header record; refusing to guess the session')
  if (headerRecord.id !== options.targetSessionId) {
    throw new Error('the source header session id ' + JSON.stringify(headerRecord.id) + ' does not match the analyzed session ' + JSON.stringify(options.targetSessionId))
  }
  const requested = validateSeqBounds(options.seqMin, options.seqMax)
  const issues = []
  if (artifact.tornStart !== undefined) issues.push('torn-final-frame at byte ' + artifact.tornStart)
  for (const failure of artifact.failures ?? []) issues.push('unparsable record at line ' + failure.line + ': ' + failure.message)

  const sequenced = records.filter((record) => typeof record?.seq === 'number').sort((left, right) => left.seq - right.seq)
  const availableFirst = sequenced[0]?.seq
  const availableLast = sequenced[sequenced.length - 1]?.seq
  const duplicated = []
  for (let index = 1; index < sequenced.length; index += 1) {
    if (sequenced[index].seq === sequenced[index - 1].seq) duplicated.push(sequenced[index].seq)
  }
  if (duplicated.length > 0) issues.push('duplicate seq values: ' + clip(duplicated.join(','), 200))
  if (availableFirst === undefined) issues.push('no sequenced records; an empty log cannot support any absence claim')

  const effective = requested ?? (availableFirst === undefined ? undefined : { min: availableFirst, max: availableLast })
  const inScope = effective === undefined ? [] : sequenced.filter((record) => record.seq >= effective.min && record.seq <= effective.max)
  if (requested !== undefined && availableFirst !== undefined) {
    if (requested.min < availableFirst) issues.push('requested seq-min ' + requested.min + ' precedes the first available seq ' + availableFirst)
    if (requested.max > availableLast) issues.push('requested seq-max ' + requested.max + ' exceeds the last available seq ' + availableLast + ' (log is a snapshot, not a completed session)')
  }
  if (effective !== undefined && inScope.length === 0) issues.push('no records inside the effective range ' + effective.min + '..' + effective.max)
  if (effective !== undefined && inScope.length > 0) {
    const present = new Set(inScope.map((record) => record.seq))
    const gaps = []
    for (let seq = effective.min; seq <= effective.max; seq += 1) if (!present.has(seq)) gaps.push(seq)
    if (gaps.length > 0) issues.push('missing seq values inside the effective range: ' + clip(gaps.join(','), 200))
  }

  let events = []
  const callsById = new Map()
  for (const record of inScope) {
    if (record.type === 'tool/call' && typeof record.data?.callId === 'string') callsById.set(record.data.callId, record)
  }
  const resultsByCallId = new Map()
  for (const record of inScope) {
    if (record.type !== 'tool/result') continue
    const callId = record.data?.toolCallId ?? record.data?.message?.source?.callId
    if (typeof callId === 'string') resultsByCallId.set(callId, record)
  }
  for (const record of inScope) {
    if (record.type !== 'tool/call') continue
    const resultRecord = resultsByCallId.get(record.data?.callId)
    const body = resultRecord === undefined ? '' : textOfBlocks(resultRecord.data?.message?.content)
    const isError = resultRecord === undefined ? null
      : resultRecord.data?.isError === true || resultRecord.data?.message?.isError === true
    events.push(buildEvent({
      startSeq: record.seq,
      doneSeq: resultRecord?.seq,
      via: 'direct',
      name: record.data?.name,
      turn: record.data?.turn,
      rootCallId: record.data?.callId,
      state: resultRecord === undefined ? 'started' : 'completed',
      isError,
      body,
      home,
    }))
  }

  const dispatches = new Map()
  let unidentified = 0
  for (const record of inScope) {
    if (record.type !== 'tool/ptc-dispatch-start' && record.type !== 'tool/ptc-dispatch') continue
    const key = typeof record.data?.subCallId === 'string' ? record.data.subCallId : 'unidentified:' + (unidentified += 1)
    const entry = dispatches.get(key) ?? { key, name: record.data?.name, rootCallId: record.data?.rootCallId, startSeq: undefined, doneSeq: undefined, isError: null, body: '' }
    if (record.type === 'tool/ptc-dispatch-start') {
      entry.startSeq = record.seq
      entry.name = record.data?.name ?? entry.name
      entry.rootCallId = entry.rootCallId ?? record.data?.rootCallId
    } else {
      entry.doneSeq = record.seq
      entry.name = record.data?.name ?? entry.name
      entry.rootCallId = entry.rootCallId ?? record.data?.rootCallId
      entry.isError = record.data?.isError === true
      entry.body = textOfBlocks(record.data?.content)
    }
    dispatches.set(key, entry)
  }
  for (const entry of dispatches.values()) {
    // The gate's refusal arrives as a settle-only dispatch; it is a lifecycle
    // state of its own, not a vanished call (INC-04).
    const state = entry.startSeq !== undefined && entry.doneSeq !== undefined ? 'completed'
      : entry.startSeq !== undefined ? 'started'
        : entry.body.includes(GATE_MARK) ? 'denied' : 'settled-without-start'
    const root = entry.rootCallId === undefined ? undefined : callsById.get(entry.rootCallId)
    events.push(buildEvent({
      startSeq: entry.startSeq,
      doneSeq: entry.doneSeq,
      via: 'ptc',
      name: entry.name,
      turn: root?.data?.turn,
      rootCallId: entry.rootCallId ?? null,
      state,
      isError: entry.isError,
      body: entry.body,
      home,
    }))
  }
  events.sort((left, right) => (left.startSeq ?? left.doneSeq ?? 0) - (right.startSeq ?? right.doneSeq ?? 0))
  // One refusal, one record (the old extractor's dedup rule, REG-01): when the
  // inner dispatch was denied, a wrapper run_code result that merely echoes the
  // same refusal is dropped. A wrapper that settled cleanly stays, because the
  // program really did continue after catching the refusal (INC-01).
  const deniedRoots = new Set(events.filter((event) => event.state === 'denied' && event.rootCallId !== null).map((event) => event.rootCallId))
  events = events.filter((event) => !(event.via === 'direct' && event.kind === 'expected-refusal' && event.rootCallId !== null && deniedRoots.has(event.rootCallId)))

  const unfinished = events.filter((event) => event.state === 'started')
  if (unfinished.length > 0) issues.push('calls with a start and no settle inside the range: ' + unfinished.map((event) => event.name + '@' + event.startSeq).join(','))
  const settledWithoutStart = events.filter((event) => event.state === 'settled-without-start')
  if (settledWithoutStart.length > 0) issues.push('calls that settled without a start event: ' + settledWithoutStart.map((event) => event.name + '@' + event.doneSeq).join(','))
  const unclassified = events.filter((event) => event.kind === 'insufficient-evidence' && event.state === 'completed')
  if (unclassified.length > 0) issues.push('error text matched no known class: ' + unclassified.map((event) => event.name + '@' + event.seq).join(','))

  let userReport = null
  if (typeof options.userReport === 'string' && options.userReport.trim() !== '') {
    const inner = events.filter((event) => event.state === 'completed' && event.isError === false && event.via === 'ptc').map((event) => event.seq)
    const direct = events.filter((event) => event.state === 'completed' && event.isError === false && event.via === 'direct').map((event) => event.seq)
    // The user means the call whose result looked wrong; the PTC inner dispatch
    // is that call, and the outer run_code wrapper is only kept when there is no
    // inner one to name (INC-03).
    const related = inner.length > 0 ? inner : direct
    userReport = {
      kind: 'user-reported-mismatch',
      severity: 'high',
      statement: redactText(options.userReport, { home }),
      independentEvidence: typeof options.userEvidence === 'string' && options.userEvidence.trim() !== '' ? redactText(options.userEvidence, { home }) : null,
      relatedEventSeqs: related,
      verification: 'independent-evidence-required',
      note: 'A successful tool result does not prove the bytes are right: the log cannot detect silent corruption. Check the file bytes, a diff or a test result independently; the related events keep isError=false on purpose.',
    }
    if (related.length === 0) issues.push('the user report names a mismatch but the range holds no successful call to associate it with')
  }

  const counts = { events: events.length, states: { completed: 0, started: 0, denied: 0, 'settled-without-start': 0 }, kinds: {}, severities: {} }
  for (const event of events) {
    counts.states[event.state] += 1
    counts.kinds[event.kind] = (counts.kinds[event.kind] ?? 0) + 1
    counts.severities[event.severity] = (counts.severities[event.severity] ?? 0) + 1
  }

  const lastUser = [...inScope].reverse().find((record) => record.type === 'user/message' && record.data?.source?.kind === 'user')
  const conversation = {
    lastUserMessage: lastUser === undefined ? null : { seq: lastUser.seq, firstLine: clip(redactText(firstLineOf(textOfBlocks(lastUser.data?.content)), { home }), 240) },
  }

  return {
    tool: INCIDENT_TOOL,
    version: INCIDENT_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    invocation: {
      eligible: options.invocation?.eligible === true,
      preset: options.invocation?.evidence?.effectivePreset ?? null,
      reason: options.invocation?.reason ?? null,
      source: typeof options.invocation?.evidence?.source === 'string' ? redactText(options.invocation.evidence.source, { home }) : null,
    },
    target: {
      sessionId: options.targetSessionId,
      cwd: redactText(String(options.targetCwd ?? ''), { home }),
      directory: redactText(String(artifact.directory ?? ''), { home }),
      source: {
        path: redactText(String(artifact.path ?? ''), { home }),
        bytes: typeof artifact.bytes === 'number' ? artifact.bytes : null,
        sha256: artifact.buffer === undefined ? null : createHash('sha256').update(artifact.buffer).digest('hex'),
        format: artifact.format ?? null,
        frames: typeof artifact.frames === 'number' ? artifact.frames : null,
        tornStart: artifact.tornStart ?? null,
      },
    },
    conversation,
    route: replayRoute(records),
    range: {
      requested: requested ?? null,
      effective: effective ?? null,
      available: { first: availableFirst ?? null, last: availableLast ?? null },
      recordsInRange: inScope.length,
      covered: issues.length === 0,
    },
    integrity: {
      status: issues.length === 0 ? 'complete' : 'incomplete',
      issues,
      note: 'A complete status covers the requested range only; it is not a claim that the session was healthy.',
    },
    counts,
    events,
    userReport,
    redaction: {
      applied: true,
      note: 'Tokens, credentials and the home directory are masked in every exported string; the source log is never modified.',
    },
  }
}

/**
 * The evidence directory for one incident bundle.
 * @param {string} evidenceDirectory the configured evidence root
 * @param {string} sessionId the analyzed session
 * @param {string | Date} [at] bundle timestamp (tests pin it)
 * @returns {string} the bundle directory
 */
export function incidentDirectory(evidenceDirectory, sessionId, at) {
  const when = at instanceof Date ? at : new Date(at ?? Date.now())
  if (Number.isNaN(when.getTime())) throw new Error('the incident timestamp must be a valid date')
  const pad = (value) => String(value).padStart(2, '0')
  const stamp = String(when.getUTCFullYear()) + pad(when.getUTCMonth() + 1) + pad(when.getUTCDate()) + '-' + pad(when.getUTCHours()) + pad(when.getUTCMinutes()) + pad(when.getUTCSeconds())
  const slug = String(sessionId).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 48) || 'session'
  return join(evidenceDirectory, 'incidents', stamp + '-' + slug)
}

/**
 * Render the human-readable summary of one incident bundle.
 * @param {object} incident the assembled report
 * @returns {string} markdown
 */
export function renderSummaryMarkdown(incident) {
  const lines = []
  const range = incident.range.effective === null ? 'none' : incident.range.effective.min + '..' + incident.range.effective.max
  const requested = incident.range.requested === null ? 'whole visible log' : incident.range.requested.min + '..' + incident.range.requested.max
  lines.push('# Incident summary — ' + incident.target.sessionId)
  lines.push('')
  lines.push('- Generated: ' + incident.generatedAt)
  lines.push('- Evidence status: **' + incident.integrity.status + '**' + (incident.integrity.status === 'complete' ? ' (the requested range is covered; this is not a health claim)' : ''))
  lines.push('- Requested range: ' + requested + '; effective range: ' + range + ' (' + incident.range.recordsInRange + ' records)')
  lines.push('- Invocation: ' + (incident.invocation.eligible ? 'eligible' : 'NOT eligible') + (incident.invocation.preset === null ? '' : ' (preset ' + incident.invocation.preset + ')'))
  lines.push('- Target: ' + incident.target.sessionId + ' at ' + incident.target.cwd)
  lines.push('- Source: ' + incident.target.source.path + ' (sha256 ' + incident.target.source.sha256 + ', ' + incident.target.source.format + (incident.target.source.tornStart === null ? '' : ', torn frame at byte ' + incident.target.source.tornStart) + ')')
  lines.push('- Baseline: see baseline.json beside this file')
  lines.push('')
  lines.push('## Counts')
  lines.push('')
  lines.push('- Calls: ' + incident.counts.events)
  lines.push('- Lifecycle: ' + Object.entries(incident.counts.states).map(([key, value]) => key + ' ' + value).join(', '))
  lines.push('- Kinds: ' + (Object.entries(incident.counts.kinds).map(([key, value]) => key + ' ' + value).join(', ') || 'none'))
  lines.push('- Severities: ' + (Object.entries(incident.counts.severities).map(([key, value]) => key + ' ' + value).join(', ') || 'none'))
  lines.push('')
  if (incident.events.length > 0) {
    lines.push('## Calls')
    lines.push('')
    lines.push('| seq | name | via | state | kind | severity | first line |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const event of incident.events) {
      lines.push('| ' + (event.startSeq ?? event.doneSeq ?? '?') + ' | ' + event.name + ' | ' + event.via + ' | ' + event.state + ' | ' + event.kind + ' | ' + event.severity + ' | ' + (event.firstLine || '') + ' |')
    }
    lines.push('')
  }
  const expected = incident.events.filter((event) => event.kind === 'expected-refusal')
  const cancelled = incident.events.filter((event) => event.kind === 'cancelled')
  if (expected.length > 0 || cancelled.length > 0) {
    lines.push('## Summary-only outcomes')
    lines.push('')
    for (const event of [...expected, ...cancelled]) lines.push('- ' + event.kind + ': ' + event.name + ' at seq ' + (event.startSeq ?? event.doneSeq) + ' — ' + event.detail)
    lines.push('')
    lines.push('These are expected outcomes (refusals by design, cancellations); they are recorded here and do not open a triage issue.')
    lines.push('')
  }
  const partial = incident.events.filter((event) => event.kind === 'partial-success')
  if (partial.length > 0) {
    lines.push('## Partial successes')
    lines.push('')
    for (const event of partial) lines.push('- ' + event.name + ' at seq ' + (event.startSeq ?? event.doneSeq) + ' — ' + event.detail + ' Verify the on-disk state before retrying.')
    lines.push('')
  }
  if (incident.userReport !== null) {
    lines.push('## User report')
    lines.push('')
    lines.push('- Statement: ' + incident.userReport.statement)
    lines.push('- Related successful calls: ' + (incident.userReport.relatedEventSeqs.length === 0 ? 'none' : incident.userReport.relatedEventSeqs.join(', ')))
    lines.push('- Independent evidence supplied by the user: ' + (incident.userReport.independentEvidence === null ? 'none recorded' : incident.userReport.independentEvidence))
    lines.push('- ' + incident.userReport.note)
    lines.push('')
  }
  if (incident.integrity.issues.length > 0) {
    lines.push('## Evidence gaps')
    lines.push('')
    for (const issue of incident.integrity.issues) lines.push('- ' + issue)
    lines.push('')
  }
  const registration = incident.issues
  if (registration !== undefined && registration.written.length > 0) {
    lines.push('## Registered triage issues')
    lines.push('')
    for (const written of registration.written) lines.push('- ' + written.path + ' (' + written.status + ', ' + written.kind + ')')
    lines.push('')
  }
  lines.push('## Notes')
  lines.push('')
  lines.push('- The source log was read, never modified; nothing was replayed, cleaned or repaired.')
  lines.push('- Expected refusals and cancellations stay in this summary; only suspected anomalies open a triage issue.')
  lines.push('- The evidence directory is not a backup: keep longer-term archives under a location the user manages.')
  lines.push('')
  return lines.join('\n')
}

/**
 * Write the four bundle files for one incident.
 * @param {{directory: string, incident: object, baseline: object}} options bundle facts
 * @returns {Promise<{summary: string, incident: string, baseline: string, excerpt: string}>} the written paths
 */
export async function writeIncidentBundle(options) {
  // Render before creating the directory: a render bug must not leave an empty
  // bundle behind (ADR-0004's partial-success lesson applied to our own output).
  const summary = renderSummaryMarkdown(options.incident)
  await mkdir(options.directory, { recursive: true })
  const files = {
    summary: join(options.directory, 'summary.md'),
    incident: join(options.directory, 'incident.json'),
    baseline: join(options.directory, 'baseline.json'),
    excerpt: join(options.directory, 'excerpt.json'),
  }
  await writeFile(files.summary, summary + '\n', 'utf8')
  await writeFile(files.incident, JSON.stringify(options.incident, null, 2) + '\n', 'utf8')
  await writeFile(files.baseline, JSON.stringify(redactDeep(options.baseline), null, 2) + '\n', 'utf8')
  await writeFile(files.excerpt, JSON.stringify({
    tool: INCIDENT_TOOL,
    version: INCIDENT_VERSION,
    generatedAt: options.incident.generatedAt,
    target: { sessionId: options.incident.target.sessionId, source: options.incident.target.source },
    range: options.incident.range,
    events: options.incident.events,
    userReport: options.incident.userReport,
  }, null, 2) + '\n', 'utf8')
  return files
}

/**
 * The findings that need a triage issue: suspected defects, partial successes
 * and a user-reported mismatch (never an expected refusal or a cancellation).
 * @param {object} incident the assembled report
 * @returns {object[]} one finding per actionable item
 */
export function collectFindings(incident) {
  const findings = incident.events.filter((event) => ACTIONABLE.has(event.kind)).map((event) => ({ ...event }))
  if (incident.userReport !== null) {
    findings.push({
      kind: 'user-reported-mismatch',
      severity: 'high',
      name: 'user-report',
      via: 'user',
      state: 'reported',
      startSeq: incident.userReport.relatedEventSeqs[0] ?? null,
      doneSeq: incident.userReport.relatedEventSeqs[incident.userReport.relatedEventSeqs.length - 1] ?? null,
      firstLine: incident.userReport.statement,
      errorCode: null,
    })
  }
  return findings
}

function seqRangeOf(finding) {
  if (finding.startSeq === null || finding.startSeq === undefined) return 'n/a'
  return String(finding.startSeq) + (finding.doneSeq === null || finding.doneSeq === undefined ? '' : '..' + String(finding.doneSeq))
}

function titleForFinding(finding) {
  return finding.kind + ': ' + finding.name + ' (seq ' + seqRangeOf(finding) + ')'
}

function renderIssue(finding, incident, directory, number) {
  const seqRange = seqRangeOf(finding)
  return [
    '# ' + number + ': ' + titleForFinding(finding),
    '',
    '**What to build:** ' + HYPOTHESES[finding.kind],
    '**Blocked by:** None',
    '**Status:** ' + TRIAGE_STATUS,
    '',
    '需求依据：[权威需求规格](../../../docs/specs/2026-10-23-ptc-hashline-operations-skills.md)；本票由 incident 自动登记（INC-06），不表示已证实为代码 Bug。',
    '',
    '## 证据',
    '',
    '- 证据包：`' + join(directory, 'incident.json') + '`（目标会话 `' + incident.target.sessionId + '`，源日志 sha256 `' + incident.target.source.sha256 + '`）',
    '- 事件：`' + finding.name + '` via `' + finding.via + '`，state `' + finding.state + '`，kind `' + finding.kind + '`，severity `' + finding.severity + '`，seq `' + seqRange + '`',
    '- 首行：`' + (finding.firstLine || '(none)') + '`',
    '- 错误码：`' + (finding.errorCode ?? 'n/a') + '`',
    '',
    '## 假说',
    '',
    HYPOTHESES[finding.kind],
    '',
    '## 边界',
    '',
    '- 重复发生关联尚未实现（票据 03）：本记录只覆盖本次发生，旧证据不被覆盖。',
    '- 未重放、未清理现场、未修改实现；核验前不要假定自动回滚。',
    '',
  ].join('\n')
}

/**
 * Auto-register one needs-triage issue per actionable finding.
 *
 * The issue directory follows the tracker convention
 * (`.scratch/<feature>/issues/NN-<slug>.md`); numbering continues after the
 * highest existing ticket. An unusable maintenance repository stops the writes
 * and reports the reason instead of falling back to the business cwd (D9).
 * @param {{maintenanceRepository: string, feature: string, incident: object, directory: string}} options
 * @returns {Promise<object>} the registration result
 */
export async function registerNeedsTriageIssues(options) {
  const findings = collectFindings(options.incident)
  const repository = typeof options.maintenanceRepository === 'string' ? options.maintenanceRepository : ''
  if (repository === '') {
    return { configured: false, directory: null, written: [], skipped: findings.length === 0 ? [] : [{ reason: 'the maintenance repository is not usable, so no issue file was written; this workflow never writes into the business working directory' }] }
  }
  const directory = join(repository, '.scratch', options.feature, 'issues')
  const displayDirectory = redactText(directory)
  // No actionable finding means no issue directory at all: a clean analysis
  // must not leave a `.scratch` tree behind (INC-06).
  if (findings.length === 0) return { configured: true, directory: displayDirectory, written: [], skipped: [] }
  let entries = []
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (error?.code !== 'ENOENT') return { configured: true, directory: displayDirectory, written: [], skipped: [{ reason: 'cannot list ' + displayDirectory + ': ' + (error instanceof Error ? error.message : String(error)) }] }
  }
  await mkdir(directory, { recursive: true })
  let next = 1
  for (const name of entries) {
    const match = /^(\d+)-/u.exec(name)
    if (match !== null) next = Math.max(next, Number(match[1]) + 1)
  }
  const written = []
  for (const finding of findings) {
    const number = String(next).padStart(2, '0')
    next += 1
    const slug = (String(finding.kind) + '-' + String(finding.name)).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'incident'
    const file = join(directory, number + '-' + slug + '.md')
    await writeFile(file, renderIssue(finding, options.incident, redactText(String(options.directory ?? '')), number), 'utf8')
    written.push({ path: redactText(file), number, status: TRIAGE_STATUS, kind: finding.kind })
  }
  return { configured: true, directory: displayDirectory, written, skipped: [] }
}