/**
 * Invocation-context verification for the operations skills (SCOPE-04/05).
 *
 * The check answers one question: is the session that invoked this workflow
 * really running the `ptc-hashline` preset? It replays the preset projection
 * the host records in the session log — the header's initial value plus any
 * later `agent-preset/selected` events — and reads nothing else. Consequences:
 *
 * - the caller's session id must come from the host-managed shell variable, so
 *   `--session` is required and an unknown value is refused rather than
 *   defaulted to true;
 * - the header's `agentPreset` may be absent on a legitimate session, so the
 *   header alone is not a verdict; a later selection may name the preset;
 * - a family marker such as `ptc`, a directory name, a user-typed
 *   `--preset`, or another session's projection never substitute for this
 *   session's own projection.
 *
 * This is a workflow guard, not an operating-system boundary: a local operator
 * can still run any script they may read.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/context
 */
import { readSessionArtifact } from './session-log.mjs'

/** The preset this workflow belongs to. */
export const TARGET_PRESET = 'ptc-hashline'

/** Family prefixes that are NOT the target preset. */
const FAMILY_ONLY = /^ptc$/u

/**
 * Replay the preset projection of one already-decoded session log.
 *
 * The effective preset is the LAST selection event when one exists, otherwise
 * the header's initial value. That ordering is the host's own: a session starts
 * on its header preset and a blank-session selection replaces it.
 * @param {object[]} records decoded records in log order
 * @returns {{headerPreset?: string, selectedPreset?: string, effective?: string, selectionSeq?: number}}
 */
export function replayPresetProjection(records) {
  const header = records.find(record => record?.type === 'session')
  let selected
  for (const record of records) {
    if (record?.type !== 'agent-preset/selected') continue
    if (typeof record.data?.agentPreset !== 'string') continue
    selected = { agentPreset: record.data.agentPreset, seq: record.seq }
  }
  const headerPreset = typeof header?.agentPreset === 'string' ? header.agentPreset : undefined
  return {
    ...headerPreset === undefined ? {} : { headerPreset },
    ...selected === undefined ? {} : { selectedPreset: selected.agentPreset, selectionSeq: selected.seq },
    ...selected === undefined
      ? headerPreset === undefined ? {} : { effective: headerPreset }
      : { effective: selected.agentPreset },
  }
}

/**
 * Judge one preset projection against this workflow's requirement.
 * @param {{effective?: string}} projection the replayed projection
 * @returns {{eligible: boolean, reason?: string}}
 */
export function judgeProjection(projection) {
  if (projection.effective === undefined) {
    return { eligible: false, reason: 'context-unverified: the session records no preset projection' }
  }
  if (projection.effective === TARGET_PRESET) return { eligible: true }
  if (FAMILY_ONLY.test(projection.effective)) {
    return {
      eligible: false,
      reason: 'wrong-preset: the session preset is "' + projection.effective + '", which is the PTC family marker, not "' + TARGET_PRESET + '"',
    }
  }
  return {
    eligible: false,
    reason: 'wrong-preset: the session preset is "' + projection.effective + '", not "' + TARGET_PRESET + '"',
  }
}

/**
 * Replay the provider/model the host recorded for this session.
 *
 * The request header is the host's own record of the route it used; a session
 * that never sent a request reports `unknown` rather than borrowing another
 * session's route or a default.
 * @param {object[]} records decoded records in log order
 * @returns {{provider?: string, model?: string}}
 */
export function replayRoute(records) {
  let route
  for (const record of records) {
    if (record?.type !== 'request/header') continue
    const config = record.data?.header?.config
    if (config === null || typeof config !== 'object') continue
    route = {
      ...typeof config.provider === 'string' ? { provider: config.provider } : {},
      ...typeof config.model === 'string' ? { model: config.model } : {},
    }
  }
  return route ?? {}
}

/**
 * The delegation shape a session header records (SCOPE-06).
 *
 * The host writes `origin: 'subagent'`, the parent session and the delegation
 * depth into the header; any one of them makes this session an assisted one.
 * A session that records none of them is the main session the user started.
 * @param {object[]} records decoded records in log order
 * @returns {{role: string, parentSession: string | null, delegationDepth: number | null, origin: string | null}}
 */
export function replayDelegation(records) {
  const header = records.find(record => record?.type === 'session')
  const parentSession = typeof header?.parentSession === 'string' && header.parentSession !== '' ? header.parentSession : null
  const rawDepth = header?.delegationDepth
  const delegationDepth = typeof rawDepth === 'number' && Number.isSafeInteger(rawDepth) && rawDepth >= 0 ? rawDepth : null
  const origin = header?.origin === 'subagent' ? 'subagent' : null
  const assisted = origin === 'subagent' || parentSession !== null || (delegationDepth ?? 0) > 0
  return { role: assisted ? 'subagent' : 'main', parentSession, delegationDepth, origin }
}

/**
 * What a session's delegation allows (SCOPE-06).
 *
 * A subagent of the same preset may assist the evidence analysis of a workflow
 * the user started in the main session. It may not load or start the workflow
 * itself, and its own message is never the user approval an upgrade needs:
 * that decision stays in the main session and with the user.
 * @param {{role: string, parentSession?: string | null, delegationDepth?: number | null, origin?: string | null}} delegation
 * @returns {{role: string, parentSession: string | null, delegationDepth: number | null, origin: string | null, mayAssistAnalysis: boolean, mayApproveUpgrade: boolean, rule: string}} the rules for this session
 */
export function judgeDelegation(delegation) {
  const known = delegation.role === 'main' || delegation.role === 'subagent'
  // Every field is filled in explicitly: a refusal verdict knows only the role,
  // and a spread would leave the declared shape half-present.
  return {
    role: delegation.role,
    parentSession: delegation.parentSession ?? null,
    delegationDepth: delegation.delegationDepth ?? null,
    origin: delegation.origin ?? null,
    mayAssistAnalysis: known,
    mayApproveUpgrade: delegation.role === 'main',
    rule: 'SCOPE-06: a subagent of the same preset may assist evidence analysis only; it must not load or start the workflow, and an agent message is never the user approval an upgrade requires.',
  }
}

/**
 * Verify the invocation context of one session.
 *
 * Every failure is a stop with a reason; nothing here writes, installs, or
 * reaches the network. The sessions root and workspace come from the caller
 * (the host shell's own facts), never from a guess.
 * @param {object} options
 * @param {string} options.sessionsRoot host sessions root
 * @param {string} options.cwd the invoking session's workspace
 * @param {string} [options.sessionId] the invoking session id (required)
 * @param {string} [options.presetArgument] a user-typed `--preset` (never trusted)
 * @returns {Promise<object>} the verdict with the evidence it was read from
 */
export async function verifyInvocationContext(options) {
  const base = {
    workflow: 'ptc-hashline-operations',
    targetPreset: TARGET_PRESET,
    sessionsRoot: options.sessionsRoot,
    cwd: options.cwd,
  }
  if (typeof options.sessionId !== 'string' || options.sessionId.trim() === '') {
    return {
      ...base,
      eligible: false,
      status: 'context-unverified',
      reason: 'context-unverified: no session id was supplied; the host-managed DSH_SESSION_ID is the only accepted source',
      evidence: { presetArgumentIgnored: options.presetArgument ?? null },
      delegation: judgeDelegation({ role: 'unknown' }),
    }
  }
  const artifact = await readSessionArtifact({
    sessionsRoot: options.sessionsRoot,
    cwd: options.cwd,
    sessionId: options.sessionId,
  })
  if (artifact.status !== 'read') {
    return {
      ...base,
      sessionId: options.sessionId,
      eligible: false,
      status: 'context-unverified',
      reason: 'context-unverified: this session\'s own log is ' + artifact.status + ' (' + artifact.detail + ')',
      evidence: { directory: artifact.directory, presetArgumentIgnored: options.presetArgument ?? null },
      delegation: judgeDelegation({ role: 'unknown' }),
    }
  }
  const projection = replayPresetProjection(artifact.records)
  const route = replayRoute(artifact.records)
  const verdict = judgeProjection(projection)
  return {
    ...base,
    sessionId: options.sessionId,
    eligible: verdict.eligible,
    status: verdict.eligible ? 'eligible' : verdict.reason.startsWith('wrong-preset') ? 'wrong-preset' : 'context-unverified',
    ...verdict.eligible ? {} : { reason: verdict.reason },
    evidence: {
      source: artifact.path,
      generation: artifact.generation,
      format: artifact.format,
      frames: artifact.frames,
      tornStart: artifact.tornStart ?? null,
      headerPreset: projection.headerPreset ?? null,
      selectedPreset: projection.selectedPreset ?? null,
      selectionSeq: projection.selectionSeq ?? null,
      effectivePreset: projection.effective ?? null,
      // The host's own route record, so the baseline reports the real
      // provider/model instead of guessing one.
      provider: route.provider ?? null,
      model: route.model ?? null,
      // Reported, never trusted: a hand-typed argument cannot establish the mode.
      presetArgumentIgnored: options.presetArgument ?? null,
    },
    route,
    delegation: judgeDelegation(replayDelegation(artifact.records)),
  }
}
