#!/usr/bin/env node
/**
 * Read-only extractor for the evidence a HOST-11-style claim needs: which preset
 * the session selected, which assistant message carried each behavior-changing
 * tool call, whether that message's FIRST line is a legal intent-gate line, and
 * whether any gate refusal is recorded inside the requested seq range.
 *
 * Contract (plan 2026-10-23-policy-and-evidence-audit-closure-plan.md §6):
 *
 * - Read-only. The source is opened once; nothing else is scanned, and a header
 *   whose session id differs from --session is refused rather than exported.
 * - The log format is the real one: a v4 JSONL session, optionally wrapped in
 *   concatenated Zstandard frames (session-persistence-jsonl). Every COMPLETE
 *   frame is decoded; a torn final frame is reported, never silently dropped.
 * - Missing evidence never becomes a negative finding. A parse failure, a torn
 *   frame, a seq gap, or a requested bound beyond the available log makes the
 *   result INCOMPLETE (exit 2); absence of a gate line inside a complete range
 *   is a reported finding, not proof about the rest of the session.
 * - One tool call is counted once. A PTC sub-dispatch emits
 *   tool/ptc-dispatch-start and tool/ptc-dispatch; both carry the same
 *   subCallId and are PAIRED here into one call with a lifecycle state
 *   (completed / started / denied / settled-without-start). A start without a
 *   settle is incomplete evidence, not a call that quietly vanished.
 * - A call's carrier is an assistant message of the SAME turn. The gate itself
 *   keys its declaration by turn, so a declaration from an earlier turn can
 *   never support a later one; when the log holds no same-turn message the call
 *   is unassociated and the result is INCOMPLETE. The turn-level declaration
 *   (turnGate) and the exact carrier message (carrierGate) are reported
 *   separately on purpose.
 * - Only redacted facts leave the tool: preset, first lines, tool names, call
 *   ids, turn/step, seq/time, refusal first line. No arguments, tool bodies,
 *   headers, environment or credentials.
 *
 * Usage:
 *   node scripts/extract-runtime-evidence.mjs --source <path> --session <id>
 *        [--seq-min N] [--seq-max M] [--out <file>] [--now <iso>]
 * @module dsh-tool-hashline/scripts/extract-runtime-evidence
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const ZSTD_MAGIC = 0xFD2FB528
/** Mirrors the watchdog's GATE_LINE_RE: first line, literal token, six buckets. */
const GATE_LINE_RE = /^Intent:\s*(research|implementation|investigation|evaluation|fix|open-ended)\b/i
/** Mirrors GATEISH_RE: something gate-shaped was written but the bucket is wrong. */
const GATEISH_RE = /^Intent:/i
/** Mirrors BEHAVIOR_TOOLS in presets/ptc-hashline/intent-gate-watchdog.mjs. */
const BEHAVIOR_TOOLS = new Set([
  'write', 'edit', 'bash', 'pwsh',
  'explorer', 'librarian', 'oracle', 'implementer', 'designer',
  'subagent', 'subagent_fork', 'subagent_codex', 'subagent_claude_code', 'ralph',
  'ask_user_question',
])
/** The gate's refusal text, distinct from the watchdog's own notices. */
const DENY_MARK = '[intent-gate]'
const MODE_NOTICE = '[intent-gate-watchdog] mode='

class UsageError extends Error {}

/**
 * Locate structurally complete Zstandard frames without decompressing them.
 * Same algorithm as the host's session-persistence scanner: EOF inside the
 * final frame returns its start so the caller can report it as torn.
 * @param {Buffer} buffer bytes present in the artifact
 * @returns {{frames: {start: number, end: number}[], tornStart?: number}}
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('invalid Zstandard frame magic at byte ' + offset)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error('reserved frame-header bit at byte ' + (offset - 1))
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerRest = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerRest) return { frames, tornStart: start }
    offset += headerRest
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('reserved block type at byte ' + (offset - 3))
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Decode the artifact into JSONL text. Complete frames only; a torn frame is
 * reported instead of being half-decoded (a half frame is not evidence).
 * @param {Buffer} buffer artifact bytes
 * @returns {{format: string, text: string, frames: number, tornStart?: number}}
 */
export function decodeArtifact(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).readUInt32LE(0) === ZSTD_MAGIC) {
    const scan = scanZstdFrames(buffer)
    const parts = scan.frames.map(frame => zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
    return { format: 'jsonl.v4.zstd', text: Buffer.concat(parts).toString('utf8'), frames: scan.frames.length, ...scan.tornStart === undefined ? {} : { tornStart: scan.tornStart } }
  }
  return { format: 'jsonl.v4', text: buffer.toString('utf8'), frames: 0 }
}

/** Parse one record per line; a bad line is a reported failure, not a skip. */
export function parseRecords(text) {
  const records = []
  const failures = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    try {
      records.push(JSON.parse(line))
    } catch (error) {
      failures.push({ line: index + 1, message: error instanceof Error ? error.message : String(error) })
    }
  })
  return { records, failures }
}

/** Concatenate text blocks exactly like the watchdog's messageText. */
export function messageText(message) {
  const blocks = message?.content
  if (!Array.isArray(blocks)) return ''
  let text = ''
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text + '\n'
  }
  return text
}

/** Judge one carrier message's first line with the watchdog's current rule. */
export function judgeFirstLine(firstLine) {
  if (firstLine === undefined || firstLine.trim() === '') return 'no-text'
  if (GATE_LINE_RE.test(firstLine)) return 'valid'
  if (GATEISH_RE.test(firstLine)) return 'invalid'
  return 'missing'
}

/**
 * Validate a seq range. Both bounds or neither; safe non-negative integers;
 * min <= max. Exported so a programmatic caller cannot bypass the CLI checks.
 * @param {unknown} seqMin lower bound, or undefined
 * @param {unknown} seqMax upper bound, or undefined
 * @returns {{min: number, max: number}|undefined}
 */
export function validateBounds(seqMin, seqMax) {
  if ((seqMin === undefined) !== (seqMax === undefined)) throw new UsageError('--seq-min and --seq-max must be given together')
  if (seqMin === undefined) return undefined
  for (const [name, value] of [['--seq-min', seqMin], ['--seq-max', seqMax]]) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new UsageError(name + ' must be a safe integer')
    if (value < 0) throw new UsageError(name + ' must not be negative')
  }
  if (seqMin > seqMax) throw new UsageError('--seq-min must not exceed --seq-max')
  return { min: seqMin, max: seqMax }
}

const firstLineOf = (text) => text.split('\n')[0] ?? ''
const clip = (value, limit) => typeof value !== 'string' ? value : value.length <= limit ? value : value.slice(0, limit) + '…'
const textOfBlocks = (blocks) => Array.isArray(blocks) ? blocks.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n') : ''

/**
 * Pair PTC sub-dispatch start/settle events into one call per subCallId.
 * @param {object[]} records records in the effective range, in log order
 * @returns {Map<string, object>} one entry per observed dispatch identity
 */
function collectPtcCalls(records) {
  const calls = new Map()
  let counter = 0
  const identityOf = (data) => {
    if (typeof data?.subCallId === 'string') return data.subCallId
    // A record without an identity cannot be paired; give it a unique key so it
    // is still reported instead of being merged into an unrelated call.
    counter += 1
    return 'unidentified:' + counter
  }
  for (const record of records) {
    if (record.type !== 'tool/ptc-dispatch-start' && record.type !== 'tool/ptc-dispatch') continue
    if (!BEHAVIOR_TOOLS.has(record.data?.name)) continue
    const key = identityOf(record.data)
    const existing = calls.get(key) ?? { callId: key, name: record.data?.name, rootCallId: record.data?.rootCallId, startSeq: undefined, doneSeq: undefined, isError: undefined, body: '' }
    if (record.type === 'tool/ptc-dispatch-start') {
      existing.startSeq = record.seq
      existing.rootCallId ??= record.data?.rootCallId
    } else {
      existing.doneSeq = record.seq
      existing.isError = record.data?.isError === true
      existing.body = textOfBlocks(record.data?.content)
    }
    calls.set(key, existing)
  }
  return calls
}

/**
 * Extract the HOST-11 evidence from one already-read artifact.
 * @param {object} options source path, session id, seq bounds, extraction time
 * @returns {object} the redacted report
 */
export function extractSession(options) {
  const { sourcePath, sessionId, seqMin, seqMax, extractedAt, bytes, text, format, frames, tornStart } = options
  const requested = validateBounds(seqMin, seqMax)
  const { records, failures } = parseRecords(text)
  const header = records.find(record => record?.type === 'session')
  if (header === undefined) throw new Error('source has no session header record; refusing to guess the session')
  if (header.id !== sessionId) throw new Error('source header session id ' + JSON.stringify(header.id) + ' does not match --session ' + JSON.stringify(sessionId))

  const issues = []
  if (tornStart !== undefined) issues.push('torn-final-frame at byte ' + tornStart)
  for (const failure of failures) issues.push('unparsable record at line ' + failure.line + ': ' + failure.message)

  const sequenced = records.filter(record => typeof record?.seq === 'number').sort((a, b) => a.seq - b.seq)
  const availableFirst = sequenced[0]?.seq
  const availableLast = sequenced[sequenced.length - 1]?.seq
  const duplicated = []
  for (let index = 1; index < sequenced.length; index += 1) {
    if (sequenced[index].seq === sequenced[index - 1].seq) duplicated.push(sequenced[index].seq)
  }
  if (duplicated.length > 0) issues.push('duplicate seq values: ' + duplicated.join(','))

  // The effective range is the requested one, or the whole visible log. Gaps are
  // checked in BOTH cases: a log with holes is not a complete log just because
  // the caller did not name the bounds (the seq counter is per session and dense).
  if (availableFirst === undefined) issues.push('no sequenced records; an empty log cannot support any absence claim')
  const effective = requested ?? (availableFirst === undefined ? undefined : { min: availableFirst, max: availableLast })
  const inScope = effective === undefined ? [] : sequenced.filter(record => record.seq >= effective.min && record.seq <= effective.max)

  if (requested !== undefined && availableFirst !== undefined) {
    if (requested.min < availableFirst) issues.push('requested seq-min ' + requested.min + ' precedes the first available seq ' + availableFirst)
    if (requested.max > availableLast) issues.push('requested seq-max ' + requested.max + ' exceeds the last available seq ' + availableLast + ' (log is a snapshot, not a completed session)')
  }
  if (effective !== undefined && inScope.length === 0) issues.push('no records inside the effective range ' + effective.min + '..' + effective.max)
  if (effective !== undefined && inScope.length > 0) {
    const seen = new Set(inScope.map(record => record.seq))
    const gaps = []
    for (let seq = effective.min; seq <= effective.max; seq += 1) if (!seen.has(seq)) gaps.push(seq)
    if (gaps.length > 0) issues.push('missing seq values inside the effective range: ' + clip(gaps.join(','), 200))
  }

  const selection = inScope.find(record => record.type === 'agent-preset/selected')
  const modeNotice = inScope.find(record => record.type === 'user/message' && record.data?.source?.kind === 'intent-gate-watchdog' && String(textOfBlocks(record.data?.content)).startsWith(MODE_NOTICE))
  const lastUser = [...inScope].reverse().find(record => record.type === 'user/message' && record.data?.source?.kind === 'user')

  const assistants = new Map()
  const assistantOrder = []
  const calls = []
  const callByRootId = new Map()
  let messageIndex = 0
  let lastAssistant = undefined

  /** The carrier is the newest assistant message of the SAME turn; anything
  /** else is missing evidence, not a borrowed earlier declaration. */
  const carrierFor = (turn) => {
    if (lastAssistant === undefined) return undefined
    const candidate = assistants.get(lastAssistant)
    if (candidate === undefined) return undefined
    return candidate.turn === turn ? candidate : undefined
  }
  /** A turn-level declaration: the newest same-turn message at or before the
  /** carrier whose first line is a legal gate line (the gate's own rule). */
  const turnGateFor = (turn, carrierIndex) => {
    if (turn === undefined) return 'unassociated'
    const seen = assistantOrder.filter(index => index <= (carrierIndex ?? Number.POSITIVE_INFINITY))
    const sameTurn = seen.map(index => assistants.get(index)).filter(message => message?.turn === turn)
    if (sameTurn.length === 0) return 'unassociated'
    if (sameTurn.some(message => message.gate === 'valid')) return 'valid'
    return sameTurn[sameTurn.length - 1].gate
  }

  for (const record of inScope) {
    if (record.type === 'assistant/message') {
      messageIndex += 1
      lastAssistant = messageIndex
      const messageTextValue = messageText(record.data?.message)
      const firstLine = firstLineOf(messageTextValue)
      assistants.set(messageIndex, {
        index: messageIndex,
        seq: record.seq,
        turn: record.data?.turn,
        step: record.data?.step,
        firstLine: clip(firstLine, 200),
        gate: messageTextValue.trim() === '' ? 'no-text' : judgeFirstLine(firstLine),
      })
      assistantOrder.push(messageIndex)
      continue
    }
    if (record.type === 'tool/call') {
      const call = {
        seq: record.seq,
        turn: record.data?.turn,
        step: record.data?.step,
        name: record.data?.name,
        callId: record.data?.callId,
        carrier: carrierFor(record.data?.turn),
      }
      calls.push(call)
      if (typeof call.callId === 'string') callByRootId.set(call.callId, call)
      continue
    }
  }

  const resultsByCallId = new Map()
  for (const record of inScope) {
    if (record.type !== 'tool/result') continue
    const callId = record.data?.toolCallId ?? record.data?.message?.source?.callId
    if (typeof callId === 'string') resultsByCallId.set(callId, record)
  }

  const behavior = []
  for (const call of calls) {
    if (!BEHAVIOR_TOOLS.has(call.name)) continue
    const carrier = call.carrier
    behavior.push({
      via: 'direct',
      callId: call.callId,
      state: resultsByCallId.has(call.callId) ? 'completed' : 'started',
      seq: call.seq,
      startSeq: call.seq,
      doneSeq: resultsByCallId.get(call.callId)?.seq,
      turn: call.turn,
      name: call.name,
      rootCallId: call.callId,
      carrierIndex: carrier?.index,
      carrierSeq: carrier?.seq,
      carrierFirstLine: carrier?.firstLine,
      carrierGate: carrier?.gate ?? 'unassociated',
      turnGate: turnGateFor(call.turn, carrier?.index),
    })
  }

  for (const ptc of collectPtcCalls(inScope).values()) {
    const root = callByRootId.get(ptc.rootCallId)
    const carrier = root?.carrier
    const denied = ptc.body.includes(DENY_MARK)
    behavior.push({
      via: 'ptc',
      callId: ptc.callId,
      state: ptc.startSeq !== undefined && ptc.doneSeq !== undefined ? 'completed'
        : ptc.startSeq !== undefined ? 'started'
          : denied ? 'denied' : 'settled-without-start',
      seq: ptc.startSeq ?? ptc.doneSeq,
      startSeq: ptc.startSeq,
      doneSeq: ptc.doneSeq,
      turn: root?.turn,
      name: ptc.name,
      rootCallId: ptc.rootCallId,
      carrierIndex: carrier?.index,
      carrierSeq: carrier?.seq,
      carrierFirstLine: carrier?.firstLine,
      carrierGate: carrier?.gate ?? 'unassociated',
      turnGate: turnGateFor(root?.turn, carrier?.index),
    })
  }
  behavior.sort((a, b) => a.seq - b.seq)

  // One refusal, one record. A denied PTC dispatch also surfaces inside the root
  // run_code tool/result, so the same refusal can appear twice; the inner
  // dispatch record wins and the wrapper is dropped (keyed by root call + the
  // refusal's own first line, which names the refused tool).
  const denialsByKey = new Map()
  for (const record of [...inScope]) {
    if (record.type !== 'tool/result' && record.type !== 'tool/ptc-dispatch') continue
    const body = record.type === 'tool/result' ? textOfBlocks(record.data?.message?.content) : textOfBlocks(record.data?.content)
    if (!body.includes(DENY_MARK)) continue
    const reasonFirstLine = clip(firstLineOf(body), 240)
    // The wrapper prepends its own line ("code run failed …"), so the identity of
    // a refusal is the gate's marker line, not whichever line happens to come first.
    const markerLine = body.split('\n').find(line => line.includes(DENY_MARK)) ?? firstLineOf(body)
    const key = String(record.data?.rootCallId ?? record.data?.toolCallId ?? '') + '|' + clip(markerLine.trim(), 200)
    const entry = {
      seq: record.seq,
      type: record.type,
      callId: record.data?.subCallId ?? record.data?.toolCallId,
      rootCallId: record.data?.rootCallId,
      reasonFirstLine,
    }
    const existing = denialsByKey.get(key)
    if (existing === undefined || (existing.type === 'tool/result' && entry.type === 'tool/ptc-dispatch')) denialsByKey.set(key, entry)
  }
  const denials = [...denialsByKey.values()].sort((a, b) => a.seq - b.seq)

  const unassociated = behavior.filter(entry => entry.carrierGate === 'unassociated')
  if (unassociated.length > 0) issues.push('behavior calls without a same-turn carrier assistant message: ' + unassociated.map(entry => entry.name + '@' + entry.seq).join(','))
  const unfinished = behavior.filter(entry => entry.state === 'started')
  if (unfinished.length > 0) issues.push('behavior calls with a start and no settle inside the range: ' + unfinished.map(entry => entry.name + '@' + entry.startSeq).join(','))
  const settledWithoutStart = behavior.filter(entry => entry.state === 'settled-without-start')
  if (settledWithoutStart.length > 0) issues.push('behavior calls that settled without a start event: ' + settledWithoutStart.map(entry => entry.name + '@' + entry.doneSeq).join(','))

  const covered = effective !== undefined && issues.length === 0
  const status = issues.length === 0 && covered ? 'complete' : 'incomplete'

  const tally = { valid: 0, invalid: 0, missing: 0, 'no-text': 0, unassociated: 0 }
  for (const entry of behavior) {
    const key = entry.carrierGate === 'unassociated' ? 'unassociated' : entry.carrierGate
    tally[key] += 1
  }
  const states = { completed: 0, started: 0, denied: 0, 'settled-without-start': 0 }
  for (const entry of behavior) states[entry.state] += 1
  const turnTally = { valid: 0, invalid: 0, missing: 0, 'no-text': 0, unassociated: 0 }
  for (const entry of behavior) turnTally[entry.turnGate] += 1

  const turns = [...new Set(behavior.map(entry => entry.turn).filter(turn => typeof turn === 'number'))].sort((a, b) => a - b)
  const perTurn = turns.map(turn => {
    const first = behavior.find(entry => entry.turn === turn)
    return {
      turn,
      firstBehavior: first === undefined ? null : { seq: first.seq, name: first.name, via: first.via, state: first.state },
      carrierSeq: first?.carrierSeq ?? null,
      carrierFirstLine: first?.carrierFirstLine ?? null,
      carrierGate: first?.carrierGate ?? 'unassociated',
      turnGate: first?.turnGate ?? 'unassociated',
    }
  })

  return {
    tool: 'extract-runtime-evidence',
    version: 2,
    extractedAt,
    source: {
      path: sourcePath,
      bytes,
      sha256: createHash('sha256').update(options.buffer).digest('hex'),
      format,
      frames,
      ...tornStart === undefined ? {} : { tornStart },
    },
    session: {
      id: header.id,
      cwd: header.cwd,
      headerPreset: header.agentPreset,
      selectedPreset: selection === undefined ? null : { id: selection.data?.agentPreset, seq: selection.seq },
      gateMode: modeNotice === undefined ? null : { seq: modeNotice.seq, text: clip(firstLineOf(textOfBlocks(modeNotice.data?.content)), 240) },
      lastUserMessage: lastUser === undefined ? null : { seq: lastUser.seq, firstLine: clip(firstLineOf(textOfBlocks(lastUser.data?.content)), 240) },
    },
    range: {
      requested: requested ?? null,
      effective: effective ?? null,
      available: { first: availableFirst ?? null, last: availableLast ?? null },
      recordsInRange: inScope.length,
      covered,
    },
    records: { total: records.length, parsed: records.length, failures },
    evidence: {
      status,
      issues,
      assistantMessages: assistantOrder.map(index => assistants.get(index)),
      behaviorCalls: behavior,
      denials,
      tally,
      states,
      turnTally,
      perTurn,
      userMessages: inScope.filter(record => record.type === 'user/message' && record.data?.source?.kind === 'user').map(record => ({ seq: record.seq, firstLine: clip(firstLineOf(textOfBlocks(record.data?.content)), 240) })),
      note: 'Absence of a gate line or a refusal is a statement about the covered range only; it says nothing about events outside it. One tool call is counted once: start and settle events are paired by subCallId.',
    },
  }
}

function parseArgs(argv) {
  const options = { }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag.startsWith('--')) throw new UsageError('unexpected argument: ' + flag)
    if (value === undefined) throw new UsageError(flag + ' needs a value')
    if (flag === '--source') options.sourcePath = value
    else if (flag === '--session') options.sessionId = value
    else if (flag === '--seq-min') options.seqMin = Number(value)
    else if (flag === '--seq-max') options.seqMax = Number(value)
    else if (flag === '--out') options.out = value
    else if (flag === '--now') options.now = value
    else throw new UsageError('unknown flag: ' + flag)
    index += 1
  }
  if (options.sourcePath === undefined) throw new UsageError('--source is required')
  if (options.sessionId === undefined) throw new UsageError('--session is required')
  validateBounds(options.seqMin, options.seqMax)
  return options
}

/** Run the CLI; returns the process exit code (0 complete, 2 incomplete, 3 refused). */
export async function main(argv) {
  let options
  try { options = parseArgs(argv) } catch (error) {
    process.stderr.write(String(error instanceof Error ? error.message : error) + '\n')
    return 3
  }
  let buffer
  try { buffer = await readFile(options.sourcePath) } catch (error) {
    process.stderr.write('cannot read source: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    return 3
  }
  let decoded
  try { decoded = decodeArtifact(buffer) } catch (error) {
    process.stderr.write('cannot decode source: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    return 3
  }
  let report
  try {
    report = extractSession({
      sourcePath: options.sourcePath,
      sessionId: options.sessionId,
      seqMin: options.seqMin,
      seqMax: options.seqMax,
      extractedAt: options.now ?? new Date().toISOString(),
      bytes: buffer.length,
      buffer,
      text: decoded.text,
      format: decoded.format,
      frames: decoded.frames,
      tornStart: decoded.tornStart,
    })
  } catch (error) {
    process.stderr.write('refused: ' + (error instanceof Error ? error.message : String(error)) + '\n')
    return 3
  }
  const json = JSON.stringify(report, null, 2)
  if (options.out === undefined) process.stdout.write(json + '\n')
  else await writeFile(options.out, json + '\n', 'utf8')
  return report.evidence.status === 'complete' ? 0 : 2
}

/* istanbul ignore next -- CLI entry, exercised through the tests as a child process. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
