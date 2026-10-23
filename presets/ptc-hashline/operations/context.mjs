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
  }
}
