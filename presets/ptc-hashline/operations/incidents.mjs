/**
 * Incident evidence assembly for the ptc-hashline operations skill (INC-01..07).
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
 * A repeated class of failure links the issue that already exists instead of
 * writing a second one (INC-07): the link is an APPENDED occurrence record that
 * carries its own evidence package and its own baseline, so no earlier record,
 * evidence body or Status line is rewritten. A retry that succeeded later in
 * the same range adds a recovery record and never closes the issue.
 *
 * Redaction is applied to every exported string (INC-05): tool arguments and
 * bodies never leave this module, and the first lines, paths and statements that
 * do leave it pass through {@link redactText}. The original log is untouched.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/incidents
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { replayRoute } from './context.mjs'
import { clip, firstLineOf, isUserMessage, textOfBlocks } from './text.mjs'

/** Report identity written into every bundle. */
export const INCIDENT_TOOL = 'ptc-hashline-operations-incident'
/** Report schema version. */
export const INCIDENT_VERSION = 1
/** Feature slug used for auto-registered triage issues unless overridden. */
export const DEFAULT_FEATURE = 'ptc-hashline-operations-skills'
/** Triage status the issue tracker uses for a not-yet-evaluated report. */
export const TRIAGE_STATUS = 'needs-triage'
/** Marker opening the machine-readable metadata block of one issue file. */
export const ISSUE_FORMAT = 'ptc-hashline-incident-issue'
/** Marker opening one appended occurrence record. */
export const OCCURRENCE_FORMAT = 'ptc-hashline-occurrence'
/** Marker opening one appended recovery record. */
export const RECOVERY_FORMAT = 'ptc-hashline-recovery'
/** The one statement a recovery record carries; it never closes an issue. */
export const RECOVERY_STATEMENT = '本次已恢复'
/** Occurrence and recovery headings, counted to number the next record. */
const OCCURRENCE_HEADING = /^### 发生 \d+ · /gmu
const RECOVERY_HEADING = /^### 恢复 \d+ · /gmu
/**
 * The machine-readable blocks this module writes and reads back.
 *
 * Each pattern tolerates CRLF on purpose: an issue file may be checked out with
 * CRLF on this platform, and a block this module wrote must still be recognised
 * then. A failed match would silently open a second ticket instead of linking.
 */
const ISSUE_METADATA = /<!-- ptc-hashline-incident-issue\r?\n([\s\S]*?)\r?\n-->/u
const OCCURRENCE_METADATA = /<!-- ptc-hashline-occurrence\r?\n([^\r\n]*)\r?\n-->/gu
const RECOVERY_METADATA = /<!-- ptc-hashline-recovery\r?\n([^\r\n]*)\r?\n-->/gu

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
 * Normalise one exported first line into a class fingerprint (INC-07).
 *
 * Two instances of ONE class differ only in their payload: a path, a byte
 * offset, a seq, a count, a digest or a timestamp. Masking exactly those makes
 * the two lines equal without merging different classes, which is what the
 * ticket's 「同 kind + 同工具名 + 归一化首行」 criterion needs. Case is folded
 * because a wording change between host versions is not a new class.
 *
 * The line is redacted here rather than trusted to the caller: the fingerprint is
 * stored in a ticket and compared across runs, so it must never carry a token
 * even when raw text reaches this exported function. Redacting twice is a no-op.
 * @param {string} text one first line, raw or already redacted
 * @param {{home?: string}} [options] home directory override (tests pin it)
 * @returns {string} the normalised form
 */
export function normalizeFirstLine(text, options = {}) {
  const line = typeof text === 'string' ? redactText(text, options).split('\n')[0].replace(/\r/gu, '') : ''
  const masked = line
    .replace(/0x[0-9a-f]+/giu, '0x#')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/giu, '<hash>')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/gu, '<time>')
    .replace(/"[^"\n]*"/gu, '"…"')
    .replace(/'[^'\n]*'/gu, "'…'")
    .replace(/\d+(?:\.\d+)?/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
  return masked.toLowerCase().slice(0, 200)
}

/**
 * The same-class fingerprint of one finding: kind, tool name, normalised line.
 * It is stored in the issue's metadata block (INC-07), so a later run matches
 * the file by data instead of by its heading wording.
 * @param {{kind: string, name: string, firstLine: string}} finding the finding
 * @param {{home?: string}} [options] home directory override (tests pin it)
 * @returns {string} the fingerprint
 */
export function recurrenceKeyOf(finding, options = {}) {
  return String(finding.kind) + '|' + String(finding.name) + '|' + normalizeFirstLine(finding.firstLine, options)
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
    // SCOPE-06: who supplied the statement. A subagent's message is an agent's
    // statement, not the user's own: it may assist the analysis, but nothing
    // recorded here may later be read as the user confirming anything.
    const byAgent = options.invocation?.delegation?.role === 'subagent'
    userReport = {
      kind: 'user-reported-mismatch',
      severity: 'high',
      statement: redactText(options.userReport, { home }),
      source: byAgent ? 'subagent' : 'user',
      standsForUser: !byAgent,
      independentEvidence: typeof options.userEvidence === 'string' && options.userEvidence.trim() !== '' ? redactText(options.userEvidence, { home }) : null,
      relatedEventSeqs: related,
      verification: 'independent-evidence-required',
      note: 'A successful tool result does not prove the bytes are right: the log cannot detect silent corruption. Check the file bytes, a diff or a test result independently; the related events keep isError=false on purpose.'
        + (byAgent ? ' This statement came from an assisted (subagent) session: it is evidence input, never the user confirmation.' : ''),
    }
    if (related.length === 0) issues.push('the user report names a mismatch but the range holds no successful call to associate it with')
  }

  const counts = { events: events.length, states: { completed: 0, started: 0, denied: 0, 'settled-without-start': 0 }, kinds: {}, severities: {} }
  for (const event of events) {
    counts.states[event.state] += 1
    counts.kinds[event.kind] = (counts.kinds[event.kind] ?? 0) + 1
    counts.severities[event.severity] = (counts.severities[event.severity] ?? 0) + 1
  }

  const lastUser = [...inScope].reverse().find((record) => isUserMessage(record))
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
      // SCOPE-06: who invoked the workflow. An assisted session may analyze
      // the evidence; it can never supply the approval an upgrade needs.
      delegation: options.invocation?.delegation ?? null,
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
    // SCOPE-06: provenance, so an assisted session's message is never read as
    // the user's own confirmation.
    lines.push('- Reported by: ' + incident.userReport.source + (incident.userReport.standsForUser === true ? '' : ' (an agent statement, not a user confirmation)'))
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
  const linked = Array.isArray(registration?.associated) ? registration.associated : []
  const recovered = Array.isArray(registration?.recoveries) ? registration.recoveries : []
  if (registration !== undefined && (registration.written.length > 0 || linked.length > 0 || recovered.length > 0)) {
    lines.push('## Registered triage issues')
    lines.push('')
    for (const written of registration.written) lines.push('- ' + written.path + ' (' + written.status + ', ' + written.kind + ')')
    for (const entry of linked) {
      lines.push('- linked: ' + entry.path + ' (occurrence ' + entry.occurrence + ', Status unchanged' + (entry.duplicate === true ? ', already recorded' : '') + ')')
    }
    for (const entry of recovered) {
      lines.push('- recovery: ' + entry.path + ' — ' + entry.statement + ' (seq ' + entry.evidenceSeqs.join(', ') + '); the issue stays open')
    }
    lines.push('')
    lines.push('A link appends one occurrence record to the existing ticket and never rewrites its Status or its older evidence; a recovery records that this occurrence was recovered and never closes the issue.')
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
 * Each finding carries its same-class fingerprint (INC-07), so a later run can
 * link it to the issue that already exists instead of writing another one.
 * @param {object} incident the assembled report
 * @returns {object[]} one finding per actionable item
 */
export function collectFindings(incident) {
  const findings = incident.events.filter((event) => ACTIONABLE.has(event.kind)).map((event) => withRecurrence({ ...event }))
  if (incident.userReport !== null) {
    findings.push(withRecurrence({
      kind: 'user-reported-mismatch',
      severity: 'high',
      name: 'user-report',
      via: 'user',
      state: 'reported',
      startSeq: incident.userReport.relatedEventSeqs[0] ?? null,
      doneSeq: incident.userReport.relatedEventSeqs[incident.userReport.relatedEventSeqs.length - 1] ?? null,
      firstLine: incident.userReport.statement,
      errorCode: null,
    }))
  }
  return findings
}

/** Attach the same-class fingerprint one finding is grouped by. */
function withRecurrence(finding) {
  return {
    ...finding,
    recurrence: {
      key: recurrenceKeyOf(finding),
      kind: finding.kind,
      tool: finding.name,
      normalizedFirstLine: normalizeFirstLine(finding.firstLine),
    },
  }
}

/**
 * Group one run's findings by fingerprint: one issue, one occurrence record
 * (INC-07).
 *
 * Two instances of one class inside the same range are ONE occurrence of it,
 * so an issue never receives two records for the same incident. The group reads
 * kind, tool and normalised line from the finding's own recurrence record, so
 * one fact never has two sources.
 * @param {object[]} findings the findings decorated by collectFindings
 * @returns {object[]} one group per fingerprint
 */
export function groupFindings(findings) {
  const groups = new Map()
  for (const finding of findings) {
    const entry = groups.get(finding.recurrence.key) ?? {
      ...finding.recurrence,
      severity: finding.severity,
      via: finding.via,
      state: finding.state,
      errorCode: finding.errorCode ?? null,
      firstLine: finding.firstLine,
      seqs: [],
    }
    entry.seqs.push(seqOfFinding(finding))
    groups.set(entry.key, entry)
  }
  for (const entry of groups.values()) {
    entry.seqs = entry.seqs.filter((seq) => typeof seq === 'number').sort((left, right) => left - right)
  }
  return [...groups.values()]
}

/** The seq one finding is anchored at, or undefined when the range gave none. */
function seqOfFinding(finding) {
  if (typeof finding.startSeq === 'number') return finding.startSeq
  if (typeof finding.doneSeq === 'number') return finding.doneSeq
  return undefined
}

/**
 * Did the same tool succeed later inside this range? (INC-07)
 *
 * That is the only retry-success one log can show: a completed, non-error call
 * of the SAME tool after the failing occurrence, cited at the seq it SETTLED on
 * (that is when it succeeded, not when it started). It is a recovery record —
 * not a verdict about the issue and never a status change.
 * @param {object} group one fingerprint group
 * @param {object} incident the assembled report
 * @returns {{recovered: boolean, evidenceSeqs: number[]}} the recovery facts
 */
export function detectRecovery(group, incident) {
  const last = group.seqs[group.seqs.length - 1]
  if (last === undefined) return { recovered: false, evidenceSeqs: [] }
  const evidenceSeqs = incident.events
    .filter((event) => event.name === group.tool
      && event.kind === 'success'
      && event.state === 'completed'
      && event.isError === false
      && typeof event.seq === 'number'
      && event.seq > last)
    .map((event) => (typeof event.doneSeq === 'number' ? event.doneSeq : event.seq))
    .sort((left, right) => left - right)
  return { recovered: evidenceSeqs.length > 0, evidenceSeqs }
}

/**
 * Read the machine-readable metadata a previously registered issue carries
 * (INC-07).
 *
 * A hand-written ticket has none, so it never matches by accident: an unknown
 * key stays unknown instead of being guessed from the heading wording.
 * @param {string} text one issue file's bytes
 * @returns {object | null} the metadata, or null when the file carries none
 */
export function parseIssueMetadata(text) {
  if (typeof text !== 'string') return null
  const match = ISSUE_METADATA.exec(text)
  if (match === null) return null
  let parsed
  try {
    parsed = JSON.parse(match[1])
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  if (typeof parsed.recurrenceKey !== 'string' || parsed.recurrenceKey === '') return null
  return parsed
}

/** The machine ids one issue file already records for one record kind. */
function metadataIdsIn(text, pattern) {
  const ids = []
  if (typeof text !== 'string') return ids
  for (const match of text.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1])
      if (typeof parsed?.id === 'string') ids.push(parsed.id)
    } catch {
      // An unparsable block is reported by its absence, never by a crash.
    }
  }
  return ids
}

/** How many records of one kind a file already holds. */
function countRecordsIn(text, pattern) {
  const matches = typeof text === 'string' ? text.match(pattern) : null
  return matches === null ? 0 : matches.length
}

/** The seq range one group occurred over, as text. */
function seqRangeOf(group) {
  if (group.seqs.length === 0) return 'n/a'
  const first = group.seqs[0]
  const last = group.seqs[group.seqs.length - 1]
  return first === last ? String(first) : String(first) + '..' + String(last)
}

/** Wrap one value in the marker the issue bodies use for machine-ish values. */
function quoted(value) {
  return '`' + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + '`'
}

/** The evidence-package bullet every record cites, packages path included. */
function evidenceBullet(directory, incident) {
  const path = redactText(join(String(directory ?? ''), 'incident.json'))
  return '- 证据包：' + quoted(path) + '（目标会话 ' + quoted(incident.target.sessionId) + '，源日志 sha256 ' + quoted(incident.target.source.sha256) + '）'
}

/**
 * One occurrence's own baseline, condensed to the fields a reader compares.
 *
 * Every occurrence keeps its own copy: a later run under another commit, patch
 * state or route must not rewrite the record of the earlier one.
 * @param {object} [baseline] the run's baseline report
 * @returns {string} one markdown bullet's text
 */
function baselineLine(baseline) {
  if (baseline === null || typeof baseline !== 'object') return '基线：unknown（本次未采集到运行基线）'
  const repository = baseline.repository ?? {}
  const engines = baseline.engines ?? {}
  const session = baseline.session ?? {}
  const patch = (engine) => quoted(engine?.patch?.status ?? 'unknown')
  const parts = [
    'commit ' + quoted(repository.commit) + '（' + (repository.dirty === 'clean' ? 'clean' : repository.dirty === 'dirty' ? 'dirty' : 'unknown') + '）',
    'preset ' + quoted(session.preset),
    'hashline ' + quoted(engines.hashline?.version) + '（' + patch(engines.hashline) + '）',
    'tool-edit ' + quoted(engines.toolEdit?.version) + '（' + patch(engines.toolEdit) + '）',
    'model ' + quoted(session.model),
    '采集于 ' + quoted(baseline.collectedAt),
  ]
  return redactText('基线：' + parts.join(' · '))
}

/**
 * One occurrence record's heading and bullets (INC-07).
 * @param {object} group the fingerprint group this run grouped
 * @param {object} incident the assembled report
 * @param {number} index the occurrence number inside the issue file
 * @param {string} directory the evidence package directory
 * @param {object} [baseline] the baseline THIS occurrence happened under
 * @returns {string[]} the record's markdown lines
 */
function occurrenceSection(group, incident, index, directory, baseline) {
  return [
    '### 发生 ' + index + ' · ' + incident.generatedAt + ' · ' + incident.target.sessionId,
    '',
    '- 发生范围：seq ' + seqRangeOf(group) + '（via ' + quoted(group.via) + '，state ' + quoted(group.state) + '，kind ' + quoted(group.kind) + '，severity ' + quoted(group.severity) + '，错误码 ' + quoted(group.errorCode) + '）',
    '- 首行：' + quoted(group.firstLine || '(none)'),
    evidenceBullet(directory, incident),
    '- ' + baselineLine(baseline),
  ]
}

/**
 * One recovery record's heading and bullets (INC-07).
 *
 * The wording states the boundary on every record: this occurrence recovered,
 * the issue stays open, and history is not erased.
 * @param {object} group the fingerprint group
 * @param {object} incident the assembled report
 * @param {number} index the recovery number inside the issue file
 * @param {string} directory the evidence package directory
 * @param {{evidenceSeqs: number[]}} recovery the detected retry success
 * @returns {string[]} the record's markdown lines
 */
function recoverySection(group, incident, index, directory, recovery) {
  return [
    '### 恢复 ' + index + ' · ' + incident.generatedAt + ' · ' + incident.target.sessionId,
    '',
    '- 结论：**' + RECOVERY_STATEMENT + '** —— 同类工具 ' + quoted(group.tool) + ' 在 seq ' + recovery.evidenceSeqs.join(', ') + ' 成功（state ' + quoted('completed') + '，isError=false）。',
    evidenceBullet(directory, incident),
    '- 说明：恢复只记录本次，不自动关闭问题 —— Status 保持 ' + quoted(TRIAGE_STATUS) + '，历史失败与部分成功不因此抹去。',
  ]
}

/**
 * Render one NEW issue: the class fingerprint first, then the first occurrence,
 * then the log section every later association appends to.
 * @param {object} group the fingerprint group to register
 * @param {object} incident the assembled report
 * @param {string} directory the evidence package directory
 * @param {string} number the ticket number (two digits)
 * @param {object} [baseline] this occurrence's baseline
 * @param {{recovered: boolean, evidenceSeqs: number[]}} recovery the recovery facts
 * @param {string} id the first occurrence's machine id
 * @param {string | null} [recoveryId] the recovery's machine id, when recovered
 * @returns {string} the whole issue file
 */
function renderIssue(group, incident, directory, number, baseline, recovery, id, recoveryId) {
  const metadata = JSON.stringify({
    format: ISSUE_FORMAT,
    version: 1,
    kind: group.kind,
    tool: group.tool,
    normalizedFirstLine: group.normalizedFirstLine,
    recurrenceKey: group.key,
    createdAt: incident.generatedAt,
  }, null, 2)
  const lines = [
    '# ' + number + ': ' + group.kind + ': ' + group.tool + ' (seq ' + seqRangeOf(group) + ')',
    '',
    '<!-- ' + ISSUE_FORMAT,
    metadata,
    '-->',
    '',
    '**What to build:** ' + HYPOTHESES[group.kind],
    '**Blocked by:** None',
    '**Status:** ' + TRIAGE_STATUS,
    '',
    '需求依据：[权威需求规格](../../../docs/specs/2026-10-23-ptc-hashline-operations-skills.md)；本票由 incident 自动登记（INC-06），不表示已证实为代码 Bug。',
    '',
    '## 同类判据',
    '',
    '- 同类 = 同 kind + 同工具名 + 同归一化首行：kind ' + quoted(group.kind) + '，工具 ' + quoted(group.tool) + '，归一化首行 ' + quoted(group.normalizedFirstLine),
    '- 指纹：' + quoted(group.key) + '（incident 用它匹配本文件，不靠标题措辞；手写票据没有该块，因此不会被误认为同类）',
    '- 关联规则：再次发生时只向本文件追加一条发生记录；本文件的 Status 行不被改写，既有记录与证据不被覆盖。',
    '',
    '## 证据（第 1 次发生）',
    '',
    evidenceBullet(directory, incident),
    '- 事件：' + quoted(group.tool) + ' via ' + quoted(group.via) + '，state ' + quoted(group.state) + '，kind ' + quoted(group.kind) + '，severity ' + quoted(group.severity) + '，seq ' + quoted(seqRangeOf(group)),
    '- 首行：' + quoted(group.firstLine || '(none)'),
    '- 错误码：' + quoted(group.errorCode),
    '',
    '## 假说',
    '',
    HYPOTHESES[group.kind],
    '',
    '## 边界',
    '',
    '- 同类关联与恢复记录（票据 03）：发生记录只追加，Status 与旧证据不被改写；恢复只记「本次已恢复」，不自动关闭本问题。',
    '- 未重放、未清理现场、未修改实现；核验前不要假定自动回滚。',
    '',
    '## 发生与恢复记录',
    '',
    '（本段只追加：发生记录与恢复记录按时间顺序追加；恢复不自动关闭本问题。）',
    '',
    ...occurrenceMetadataBlock(group, incident, id),
    ...occurrenceSection(group, incident, 1, directory, baseline),
    '',
    ...recovery.recovered ? [...recoveryMetadataBlock(group, incident, recoveryId, recovery), ...recoverySection(group, incident, 1, directory, recovery), ''] : [],
  ]
  return lines.join('\n') + '\n'
}

/**
 * The bytes one association appends: the occurrence id, the occurrence record
 * and — when this run observed a retry success — the recovery record.
 *
 * The block is self-contained and APPENDED, never merged into the existing text,
 * so an association cannot rewrite the Status line or an older record.
 * @param {object} group the fingerprint group this run grouped
 * @param {object} incident the assembled report
 * @param {string} directory the evidence package directory
 * @param {object} [baseline] the baseline THIS occurrence happened under
 * @param {string} id the occurrence's machine id
 * @param {number} index the occurrence number inside the issue file
 * @param {{recovered: boolean, evidenceSeqs: number[]}} recovery the recovery facts
 * @param {string} recoveryId the recovery's machine id
 * @param {number} recoveryIndex the recovery number inside the issue file
 * @returns {string} the appended block
 */
function occurrenceBlock(group, incident, directory, baseline, id, index, recovery, recoveryId, recoveryIndex) {
  const lines = [
    '',
    ...occurrenceMetadataBlock(group, incident, id),
    ...occurrenceSection(group, incident, index, directory, baseline),
    '',
    '- 说明：本次只追加一条发生记录；Status 未改变，旧证据未被覆盖。',
    '',
  ]
  if (recovery.recovered) lines.push(...recoveryMetadataBlock(group, incident, recoveryId, recovery), ...recoverySection(group, incident, recoveryIndex, directory, recovery), '')
  return lines.join('\n')
}

/** One occurrence's machine-readable identity: a re-run must match, not append. */
function occurrenceMetadataBlock(group, incident, id) {
  return [
    '<!-- ' + OCCURRENCE_FORMAT,
    JSON.stringify({
      format: OCCURRENCE_FORMAT,
      version: 1,
      id,
      sessionId: incident.target.sessionId,
      seqRange: seqRangeOf(group),
      recordedAt: incident.generatedAt,
      recurrenceKey: group.key,
    }),
    '-->',
  ]
}

/** One recovery's machine-readable identity, so a re-analysis matches it. */
function recoveryMetadataBlock(group, incident, id, recovery) {
  return [
    '<!-- ' + RECOVERY_FORMAT,
    JSON.stringify({
      format: RECOVERY_FORMAT,
      version: 1,
      id,
      sessionId: incident.target.sessionId,
      evidenceSeqs: recovery.evidenceSeqs,
      recordedAt: incident.generatedAt,
      recurrenceKey: group.key,
    }),
    '-->',
  ]
}

/** A short, stable digest of the given parts. */
function digestOf(parts) {
  return createHash('sha256').update(parts.map((part) => String(part)).join('\n')).digest('hex').slice(0, 16)
}

/**
 * Identity of one occurrence: this session, this class, this seq range.
 *
 * The source-log digest is deliberately NOT part of it. A log grows every turn,
 * and re-analysing the same failing call after that growth is still the SAME
 * occurrence — an id that moved with the file would append the record twice.
 */
function occurrenceIdOf(group, incident) {
  return digestOf([group.key, incident.target.sessionId, seqRangeOf(group)])
}

/** Identity of one recovery: its occurrence plus the seqs that recovered it. */
function recoveryIdOf(group, incident, recovery) {
  return digestOf([occurrenceIdOf(group, incident), recovery.evidenceSeqs.join(',')])
}

/** The registration entry one recovery reports; it is never a status change. */
function recoveryEntry(facts) {
  return {
    path: redactText(facts.path),
    number: facts.number,
    statement: RECOVERY_STATEMENT,
    evidenceSeqs: facts.recovery.evidenceSeqs,
    recordedAt: facts.incident.generatedAt,
    recurrenceKey: facts.group.key,
    closed: false,
    appended: facts.appended,
  }
}

/**
 * The bytes a re-analysis appends when the occurrence is already on file but the
 * retry success it now observes is not: a recovery record on its own. Dropping it
 * would lose the only new fact the wider range produced.
 */
function recoveryBlock(group, incident, directory, recoveryId, recoveryIndex, recovery) {
  return ['', ...recoveryMetadataBlock(group, incident, recoveryId, recovery), ...recoverySection(group, incident, recoveryIndex, directory, recovery), ''].join('\n')
}

/**
 * Register one needs-triage issue per actionable finding, and link a repeated
 * class to the issue that already exists (INC-06, INC-07).
 *
 * The first occurrence of a class creates the ticket. A later occurrence of the
 * SAME class — same kind, same tool, same normalised first line — appends one
 * occurrence record to the existing file and leaves its Status, its evidence and
 * every earlier record untouched. When the range also holds a successful retry
 * of that tool, the association records 「本次已恢复」: a recovery record, never a
 * status transition, so a retry that worked never closes an open issue.
 *
 * The issue directory follows the tracker convention
 * (.scratch/<feature>/issues/NN-<slug>.md); numbering continues after the
 * highest existing ticket. An unusable maintenance repository stops the writes
 * and reports the reason instead of falling back to the business cwd (D9).
 * @param {{maintenanceRepository: string, feature: string, incident: object, directory: string, baseline?: object}} options
 * @returns {Promise<object>} the registration result
 */
export async function registerNeedsTriageIssues(options) {
  const findings = collectFindings(options.incident)
  const repository = typeof options.maintenanceRepository === 'string' ? options.maintenanceRepository : ''
  if (repository === '') {
    return {
      configured: false,
      directory: null,
      written: [],
      associated: [],
      recoveries: [],
      skipped: findings.length === 0 ? [] : [{ reason: 'the maintenance repository is not usable, so no issue file was written; this workflow never writes into the business working directory' }],
    }
  }
  const directory = join(repository, '.scratch', options.feature, 'issues')
  const displayDirectory = redactText(directory)
  // No actionable finding means no issue directory at all: a clean analysis
  // must not leave a `.scratch` tree behind (INC-06).
  if (findings.length === 0) return { configured: true, directory: displayDirectory, written: [], associated: [], recoveries: [], skipped: [] }
  let entries = []
  try {
    entries = await readdir(directory)
  } catch (error) {
    if (error?.code !== 'ENOENT') return { configured: true, directory: displayDirectory, written: [], associated: [], recoveries: [], skipped: [{ reason: 'cannot list ' + displayDirectory + ': ' + (error instanceof Error ? error.message : String(error)) }] }
  }
  await mkdir(directory, { recursive: true })
  let next = 1
  // Issues already registered for a fingerprint. The match is by data only: a
  // hand-written ticket carries no metadata block and therefore never matches.
  const known = new Map()
  for (const name of entries) {
    const match = /^(\d+)-/u.exec(name)
    if (match !== null) next = Math.max(next, Number(match[1]) + 1)
    if (!name.endsWith('.md')) continue
    const file = join(directory, name)
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const metadata = parseIssueMetadata(text)
    if (metadata === null || known.has(metadata.recurrenceKey)) continue
    known.set(metadata.recurrenceKey, { path: file, number: match?.[1] ?? 'unknown', text })
  }
  const packageDirectory = redactText(String(options.directory ?? ''))
  const written = []
  const associated = []
  const recoveries = []

  for (const group of groupFindings(findings)) {
    const recovery = detectRecovery(group, options.incident)
    const id = occurrenceIdOf(group, options.incident)
    const recoveryId = recoveryIdOf(group, options.incident, recovery)
    const existing = known.get(group.key)
    if (existing === undefined) {
      const number = String(next).padStart(2, '0')
      next += 1
      const slug = (String(group.kind) + '-' + String(group.tool)).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'incident'
      const file = join(directory, number + '-' + slug + '.md')
      // The new issue records its first occurrence — and its recovery, when this
      // range already holds one — under the same ids an association looks for,
      // so re-running the same range cannot append either of them twice.
      await writeFile(file, renderIssue(group, options.incident, packageDirectory, number, options.baseline, recovery, id, recoveryId), 'utf8')
      written.push({ path: redactText(file), number, status: TRIAGE_STATUS, kind: group.kind, recurrenceKey: group.key })
      if (recovery.recovered) {
        recoveries.push(recoveryEntry({ path: file, number, incident: options.incident, group, recovery, appended: false }))
      }
      continue
    }
    const occurrence = countRecordsIn(existing.text, OCCURRENCE_HEADING)
    const recoveryIndex = countRecordsIn(existing.text, RECOVERY_HEADING)
    const recorded = metadataIdsIn(existing.text, OCCURRENCE_METADATA).includes(id)
    const newRecovery = recovery.recovered && !metadataIdsIn(existing.text, RECOVERY_METADATA).includes(recoveryId)
    if (recorded && !newRecovery) {
      // The same session and range analysed again is the SAME occurrence, and a
      // recovery already on file stays recorded: nothing is appended twice.
      associated.push({ path: redactText(existing.path), number: existing.number, status: TRIAGE_STATUS, kind: group.kind, recurrenceKey: group.key, occurrence, duplicate: true, appended: false, statusChanged: false })
      continue
    }
    // Append only: the bytes already in the file — its Status, its evidence and
    // every earlier record — are never rewritten by an association.
    const block = recorded
      ? recoveryBlock(group, options.incident, packageDirectory, recoveryId, recoveryIndex + 1, recovery)
      : occurrenceBlock(group, options.incident, packageDirectory, options.baseline, id, occurrence + 1, recovery, recoveryId, recoveryIndex + 1)
    await appendFile(existing.path, block, 'utf8')
    associated.push({ path: redactText(existing.path), number: existing.number, status: TRIAGE_STATUS, kind: group.kind, recurrenceKey: group.key, occurrence: recorded ? occurrence : occurrence + 1, duplicate: recorded, appended: true, statusChanged: false })
    if (newRecovery) {
      recoveries.push(recoveryEntry({ path: existing.path, number: existing.number, incident: options.incident, group, recovery, appended: true }))
    }
  }
  return { configured: true, directory: displayDirectory, written, associated, recoveries, skipped: [] }
}
