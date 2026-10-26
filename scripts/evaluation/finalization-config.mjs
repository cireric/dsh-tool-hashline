/** Author bounded S0/formal configurations; never executes or selects a real model. */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultTasks } from './task-suite.mjs'

export function finalizationConfig(settings, kind) {
  if (!['probe', 'formal'].includes(kind)) throw new Error('kind must be probe or formal')
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('editable settings required')
  for (const key of ['tools', 'dependencies', 'frozenAt', 'protocolHash']) if (key in settings) throw new Error('settings must not include generated identity')
  const config = structuredClone(settings)
  config.id = kind === 'probe' ? 'finalization-s0' : 'finalization-s1'
  config.kind = kind
  config.requestEvidence = { version: 1 }
  config.editPayloadVersion = 2
  config.comparison = ['stock-edit', 'hashline-default', 'hashline-fallback']
  config.samples = { repetitions: kind === 'probe' ? 1 : 3, seed: 7 }
  config.order = 'interleaved'
  config.tasks = defaultTasks().filter(t => kind === 'formal' || ['single', 'repeated', 'multi'].includes(t.id))
  const first = ['single', 'repeated', 'multi', 'unrelated-long', 'rewrite']
  const exclusions = {
    consecutive: 'The first edit program is an intentional intermediate stage; assess final correctness and cost.',
    drift: 'Evaluator-induced conflict and recovery are reported separately from conflict-free first-program correctness.',
    'target-long': 'Window-limited exception; route limitations must remain in final correctness and cost.',
    'snapshot-limit': 'Snapshot-limit exception; route limitations must remain in final correctness and cost.',
    satisfied: 'Verification-only task does not require an edit candidate.',
    create: 'Creation may use write without an edit checkpoint.',
    override: 'Explicit mode exception; route limitations must remain in final correctness and cost.',
    generator: 'Project generator has no edit-program checkpoint; retain final correctness and cost.',
  }
  config.passConditions = { ...config.passConditions, semantics: 'per-arm-cohort-count-and-per-run-tokens-v2', firstCandidateScope: {
    include: config.tasks.filter(t => first.includes(t.id)).map(t => t.id),
    exclude: config.tasks.filter(t => !first.includes(t.id)).map(t => ({ taskId: t.id, reason: exclusions[t.id] })),
  } }
  config.limits = [
    'End-to-end comparison of tool configurations; not pure-policy causal attribution.',
    kind === 'probe' ? 'S0 route/evidence pilot only: three ordinary tasks, one repetition, no promotion evidence.' : 'S1 descriptive comparison: thirteen families, three repetitions; not a statistical-power or generalization guarantee.',
    'All scheduled tasks, failures, cancellations and exceptions remain in final correctness and total-token accounting.',
    'First-candidate condition is limited prospectively to conflict-free, non-staged ordinary edits; exclusions do not establish natural inapplicability.',
    'Select the model, declared capacities, budgets, thresholds and any real execution explicitly before freezing.',
  ]
  return config
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [settings, kind, out, ...extra] = process.argv.slice(2)
  try {
    if (!settings || !kind || !out || extra.length) throw new Error('usage: finalization-config.mjs <editable-settings.json> <probe|formal> <new-experiment.json>')
    fs.writeFileSync(out, JSON.stringify(finalizationConfig(JSON.parse(fs.readFileSync(settings, 'utf8')), kind), null, 2) + '\n', { flag: 'wx' })
    console.log('bounded configuration written; review, fill and freeze before any explicit execution')
  } catch (error) { console.error('configuration refused: ' + error.message); process.exitCode = 2 }
}
