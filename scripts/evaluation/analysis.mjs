/** One evidence interpretation shared by live runs and independent offline checks. */
import { traceSummary, candidateSummary } from './evidence.mjs'
import { treeTraceSummary } from './session-tree.mjs'
import { installedPatch, targetSummary, unavailableTargets, targetObservations } from './targets.mjs'
import { stimulusSummary } from './stimuli.mjs'

export function analyzeEvidence(task, evidence, arm, final, protocol, complete) {
  const payloadVersion = protocol.editPayloadVersion ?? 1
  const trace = evidence.graph
    ? treeTraceSummary(evidence.graph, evidence.sources, { arm, complete, payloadVersion })
    : traceSummary(evidence.events ?? [], { receipts: evidence.receipts ?? [], arm, complete, payloadVersion })
  Object.assign(trace, candidateSummary(trace, evidence.batches ?? [], task.batchBoundary))
  let targets = unavailableTargets(task)
  if (evidence.graph && task.targets?.length) {
    try { targets = targetSummary(task, trace, evidence.sources, evidence.graph, final, installedPatch(protocol)) }
    catch { targets = { ...targets, reason: 'installed target parser unavailable' } }
  }
  const stimuli = stimulusSummary(task, evidence.stimuli ?? [])
  if (task.stimuli?.length) {
    if (!evidence.graph || trace.status !== 'PASS') stimuli.status = 'GAP'
    else {
      const { observations } = targetObservations(trace, evidence.sources, evidence.graph)
      const reads = observations.filter(o => o.call.name === 'read' && o.call.isError === false).sort((a, b) => a.call.endOrder - b.call.endOrder)
      for (const planned of task.stimuli) {
        const read = reads.filter(o => o.file === planned.path)[planned.afterRead - 1]?.call
        const record = stimuli.records.find(r => r.id === planned.id)
        if (!read || record?.trigger?.callId !== read.id || record?.trigger?.sessionId !== read.sessionId) stimuli.status = 'GAP'
      }
    }
  }
  return { trace, targetEvaluation: targets, stimuli }
}
