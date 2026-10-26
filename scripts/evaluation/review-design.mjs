/** Frozen design facts; does not grant execution or judge model benefit. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertFrozenProtocol, loadFrozenProtocol, protocolHash, REQUIRED_TASK_FAMILIES } from './protocol.mjs'
import { captureIdentity, assertIdentity, armRows } from './identity.mjs'
import { capturePresetRows } from './host.mjs'
import { schedule } from './run.mjs'
import { CONDITION_SEMANTICS } from './verdict.mjs'

export function reviewDesign(protocol, presetRows) {
  assertFrozenProtocol(protocol)
  if (protocolHash(presetRows) !== protocol.tools.presetHash) throw new Error('EVAL_PRESET_DRIFT')
  const arms = Object.fromEntries(protocol.comparison.map(arm => {
    const rows = armRows(presetRows, arm)
    if (protocolHash(rows) !== protocol.tools.arms[arm]) throw new Error('EVAL_ARM_DRIFT: ' + arm)
    if (rows.some(r => typeof r.id !== 'string') || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('distinct plugin ids required for comparison')
    return [arm, rows]
  }))
  const ids = [...new Set(Object.values(arms).flatMap(rows => rows.map(r => r.id)))].sort()
  const plugins = ids.map(id => {
    const configurations = Object.fromEntries(protocol.comparison.map(arm => {
      const row = arms[arm].find(r => r.id === id)
      const settings = row && ['tool-fs', 'tool-read', 'tool-edit'].includes(id)
        ? Object.fromEntries(Object.entries(row.config ?? {}).filter(([key, value]) => ['read', 'edit', 'mode', 'limit', 'readLimit', 'maxLineLength', 'readMaxLineLength', 'maxBytes', 'readMaxBytes', 'snapshotMaxBytes'].includes(key) && (typeof value === 'boolean' || typeof value === 'number' || (key === 'mode' && ['auto', 'hashline', 'replace', 'patch', 'apply_patch'].includes(value))))) : {}
      return [arm, row ? { present: true, name: row.name, hash: protocolHash(row), settings } : { present: false }]
    }))
    const hashes = Object.values(configurations).map(c => c.present ? c.hash : 'absent')
    return { id, identical: new Set(hashes).size === 1, configurations }
  })
  const pairs = protocol.comparison.flatMap((left, i) => protocol.comparison.slice(i + 1).map(right => ({
    left, right, changedPlugins: plugins.filter(p => protocolHash(p.configurations[left]) !== protocolHash(p.configurations[right])).map(p => p.id),
  })))
  const families = Object.fromEntries(REQUIRED_TASK_FAMILIES.map(family => [family, protocol.tasks.filter(t => t.family === family).map(t => t.id)]))
  const scoped = protocol.passConditions.firstCandidateScope
  const scopeStatus = scoped ? 'frozen-v2' : protocol.passConditions.semantics === CONDITION_SEMANTICS ? 'all-tasks-v1' : 'semantics-not-frozen'
  const include = scoped?.include ?? (scopeStatus === 'all-tasks-v1' ? protocol.tasks.map(t => t.id) : [])
  const exclusion = scoped?.exclude ?? []
  const gaps = [
    { id: 'actual-prompt-sdk', reason: 'Row hashes do not independently capture the complete request prompt or generated tool SDK per arm.' },
    { id: 'representativeness', reason: 'Family labels and sample counts do not establish task representativeness or statistical power.' },
    { id: 'latency', reason: 'Recorded wallMs includes evaluator work; independent model and tool latency is not established.' },
    { id: 'causal-benefit', reason: 'No relative benefit or pure-policy causal conclusion follows from frozen absolute conditions.' },
    { id: 'behavior', reason: 'Independent final bytes do not establish all required intermediate behavior or tool-choice compliance.' },
  ]
  if (plugins.some(p => !p.identical)) gaps.push({ id: 'tool-configuration-differences', reason: 'Selected arms have different plugin rows; treat this as a tool-configuration comparison, not a pure-policy ablation.' })
  if (protocol.tasks.some(t => include.includes(t.id) && t.family === 'consecutive-edits' && t.batchBoundary === 'first-edit-program')) gaps.push({ id: 'multi-stage-first-candidate', reason: 'An edit-bearing program may be an intentional intermediate stage; review whether first-program correctness measures the intended goal.' })
  if (exclusion.length) gaps.push({ id: 'authored-first-scope', reason: 'Excluded tasks remain in final correctness and cost; exclusion reasons are author declarations, not independently verified applicability.' })
  if (scopeStatus === 'semantics-not-frozen') gaps.push({ id: 'condition-semantics', reason: 'Historical conditions did not freeze their semantics; no first-condition denominator is inferred.' })
  return {
    version: 1, scope: 'frozen-design-facts-only', status: 'GAP', protocolHash: protocol.protocolHash,
    comparison: { interpretation: 'tool-configuration-comparison', purePolicyCausality: 'not-established', plugins, pairs },
    model: { configurationHash: protocolHash(protocol.model), frozenSharedAcrossSchedule: true },
    tasks: { count: protocol.tasks.length, repetitions: protocol.samples.repetitions, scheduledSamples: schedule(protocol).length, families,
      frozenInputsSharedByTask: true, firstCandidateScopeStatus: scopeStatus, firstCandidateInclude: include, firstCandidateExclude: exclusion,
      perArmFirstDenominator: scopeStatus === 'semantics-not-frozen' ? null : include.length * protocol.samples.repetitions, perArmFinalAndTokenDenominator: protocol.tasks.length * protocol.samples.repetitions },
    evidenceLimits: gaps,
    claims: 'Design facts only. GAP is not an execution refusal; no model execution, benefit judgment or promotion authorization.',
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [frozen, profileArg, out, ...extra] = process.argv.slice(2)
  try {
    if (!frozen || !profileArg || !out || extra.length) throw new Error('usage: review-design.mjs <frozen.json> <disposable-profile> <new-review.json>')
    const profile = path.resolve(profileArg), protocol = loadFrozenProtocol(frozen)
    if (JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8')).name !== 'dsh-profile-acceptance') throw new Error('disposable acceptance profile required')
    assertIdentity(protocol.dependencies, captureIdentity(profile, protocol.tools.providerPlugin))
    const review = reviewDesign(protocol, await capturePresetRows(profile))
    fs.writeFileSync(out, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' })
    console.log('design review written (GAP retained); no host or model started')
  } catch (error) { console.error('design review refused: ' + error.message); process.exitCode = 2 }
}
