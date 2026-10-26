/** Local assembled-request evidence, independently replayed through the pinned Session. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { protocolHash } from './protocol.mjs'
import { sha256 } from './stimuli.mjs'
import { readSessionEvidence } from './session-tree.mjs'

const fields = ['provider', 'model', 'reasoningEffort', 'maxTokens', 'temperature', 'stop', 'system', 'messages', 'tools', 'toolHistory', 'sessionId', 'purpose']
const configFields = ['provider', 'model', 'reasoningEffort', 'maxTokens', 'temperature', 'stop']
const json = value => JSON.parse(JSON.stringify(value))

export function requestSurface(request) {
  const systems = [request.system, ...(request.messages ?? []).filter(m => m.role === 'system').flatMap(m => m.content ?? []).filter(p => p.type === 'text').map(p => p.text)].filter(s => typeof s === 'string')
  const sdk = []
  // Pinned PTC renderer's explicit block. No heuristic slicing of arbitrary code fences.
  for (const text of systems) {
    const marker = 'Program-only SDK bindings:'
    if (!text.includes(marker)) continue
    if (text.indexOf(marker) !== text.lastIndexOf(marker)) return { messagesHash: protocolHash(request.messages), systemHash: protocolHash(systems), toolsHash: protocolHash(request.tools ?? []), sdk: { status: 'unknown' } }
    const match = /^\s*```ts\r?\n([\s\S]*?)\r?\n```/u.exec(text.slice(text.indexOf(marker) + marker.length))
    if (match && match[1].includes('declare const tools:')) sdk.push(match[1])
  }
  return { messagesHash: protocolHash(request.messages), systemHash: protocolHash(systems), toolsHash: protocolHash(request.tools ?? []),
    sdk: sdk.length === 1 ? { status: 'known', hash: protocolHash(sdk[0]), characters: sdk[0].length } : { status: 'unknown' } }
}

export function captureRequest(options, actor, ordinal, directory) {
  if (!actor?.session || !Array.isArray(options.messages)) throw new Error('EVAL_REQUEST_CAPTURE_UNAVAILABLE')
  if (Object.keys(options).some(key => key !== 'signal' && !fields.includes(key))) throw new Error('EVAL_REQUEST_OPTIONS_UNSUPPORTED')
  const events = json(actor.session.snapshotEvents()), request = json(Object.fromEntries(fields.filter(k => options[k] !== undefined).map(k => [k, options[k]])))
  const data = { version: 1, boundary: 'llm/stream-before-next', ordinal, sessionId: actor.id, eventCount: events.length, prefixHash: protocolHash(events), request }
  const artifact = 'request-' + String(ordinal).padStart(6, '0') + '.json', bytes = JSON.stringify(data, null, 2) + '\n'
  fs.writeFileSync(path.join(directory, artifact), bytes, { flag: 'wx', mode: 0o600 })
  return { version: 1, status: 'captured', artifact, sha256: sha256(Buffer.from(bytes)), ...requestSurface(request) }
}

/** Integrity problems reject a report; unavailable replay/SDK remains an honest GAP. */
export function auditRequestEvidence(protocol, report, directory) {
  const required = protocol.requestEvidence?.version === 1
  if (!required && report.requestEvidenceVersion === undefined) return { summary: { status: 'GAP', reason: 'not-captured', requests: report.requests?.length ?? 0, replayed: 0 }, problems: [] }
  const problems = [], gaps = [], captures = [], sources = new Map()
  if (report.requestEvidenceVersion !== 1) problems.push('request evidence version missing/unsupported')
  let Session, formatVersion
  try {
    const entry = protocol.dependencies.packages['@deepseek-ai/dsh-session']
    if (!entry?.entry || sha256(fs.readFileSync(entry.entry)) !== entry.entryHash) throw new Error('session identity')
    const runtime = createRequire(import.meta.url)(entry.entry)
    Session = runtime.Session; formatVersion = runtime.SESSION_FORMAT_VERSION
  } catch { gaps.push('pinned Session replay unavailable') }
  for (const run of report.runs ?? []) if (run.sessionId && run.graphVersion === 1) {
    try { for (const source of readSessionEvidence(directory, run.sessionId).sources) sources.set(source.id, source) }
    catch { gaps.push('session graph unavailable: ' + run.sessionId) }
  }
  const artifacts = new Set()
  for (const [index, row] of (report.requests ?? []).entries()) {
    const ref = row.capture
    if (ref?.status === 'unknown') { gaps.push('request capture unavailable: ' + index); continue }
    try {
      if (ref?.version !== 1 || ref.status !== 'captured' || ref.artifact !== 'request-' + String(index + 1).padStart(6, '0') + '.json' || artifacts.has(ref.artifact)) throw new Error('capture reference')
      artifacts.add(ref.artifact)
      const file = path.join(directory, ref.artifact), stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('capture is not a regular file')
      const bytes = fs.readFileSync(file)
      if (sha256(bytes) !== ref.sha256) throw new Error('capture digest')
      let data
      try { data = JSON.parse(bytes) } catch { throw new Error('capture JSON') }
      const source = sources.get(row.sessionId)
      if (data.version !== 1 || data.boundary !== 'llm/stream-before-next' || data.ordinal !== index + 1 || data.sessionId !== row.sessionId || !Array.isArray(data.request?.messages)) throw new Error('capture identity')
      if (Object.keys(data.request).some(k => !fields.includes(k))) throw new Error('unexpected option field')
      for (const key of ['provider', 'model']) if (data.request[key] !== row[key] || data.request[key] !== protocol.model[key]) throw new Error('request model')
      for (const key of ['reasoningEffort', 'maxTokens']) if ((data.request[key] ?? 'unknown') !== row[key]) throw new Error('request parameters')
      for (const [key, value] of Object.entries(protocol.model.parameters)) if (data.request[key] !== value) throw new Error('frozen model parameters')
      const surface = requestSurface(data.request)
      for (const key of ['messagesHash', 'systemHash', 'toolsHash', 'sdk']) if (protocolHash(ref[key]) !== protocolHash(surface[key])) throw new Error('surface summary')
      const capture = { sessionId: row.sessionId, ordinal: index + 1, ...surface, replay: 'unknown' }
      captures.push(capture)
      if (!source || !Session) { gaps.push('request replay unavailable: ' + index); continue }
      if (!Number.isSafeInteger(data.eventCount) || data.eventCount < source.inherited || data.eventCount > source.events.length || protocolHash(source.events.slice(0, data.eventCount)) !== data.prefixHash) throw new Error('session prefix')
      let replay
      try { replay = Session.create(source.id, source.events.slice(0, data.eventCount), { version: formatVersion, id: source.id, createdAt: source.createdAt, cwd: source.cwd, isSeeded: source.inherited > 0, ...(source.parentId ? { parentSession: source.parentId } : {}) }, source.inherited) }
      catch { gaps.push('Session prefix could not be replayed: ' + index); continue }
      const header = replay.requestHeader()
      if (protocolHash(replay.deriveMessages()) !== protocolHash(data.request.messages) || protocolHash(header?.tools ?? []) !== protocolHash(data.request.tools ?? []) || protocolHash(replay.toolHistory()) !== protocolHash(data.request.toolHistory)) throw new Error('request/Session reconstruction')
      for (const key of configFields) if ((header?.config?.[key] ?? null) !== (data.request[key] ?? null) && protocolHash(header?.config?.[key] ?? null) !== protocolHash(data.request[key] ?? null)) throw new Error('header parameters')
      if (data.request.system !== undefined || (data.request.sessionId !== undefined && data.request.sessionId !== source.id)) throw new Error('unexpected request surface')
      capture.replay = 'PASS'
      if (surface.sdk.status !== 'known') gaps.push('PTC SDK block unavailable: ' + index)
    } catch (error) { problems.push('request evidence mismatch at ' + index + ': ' + error.message) }
  }
  return { summary: { version: 1, status: problems.length || gaps.length ? 'GAP' : 'PASS', boundary: 'llm/stream-before-next', providerWire: 'unknown', requests: report.requests?.length ?? 0, replayed: captures.filter(c => c.replay === 'PASS').length, gaps }, problems, captures }
}
