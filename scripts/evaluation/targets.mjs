/** Per-file-goal observations. Parsing uses the installed engine, never model self-report. */
import path from 'node:path'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { sha256 } from './stimuli.mjs'
import { adoption } from './counting.mjs'
import { parsedPlanFiles } from './apply-patch-targets.mjs'

export function installedPatch(protocol) {
  const engine = protocol.dependencies.packages['@hy-sde-org/dsh-hashline']
  if (!engine?.entry || sha256(readFileSync(engine.entry)) !== engine.entryHash) throw new Error('EVAL_TARGET_PARSER_IDENTITY')
  return createRequire(import.meta.url)(engine.entry).Patch
}

export function requestFiles(name, args, cwd, root, Patch, call) {
  try {
    if (typeof args === 'string') args = JSON.parse(args)
    const explicit = args?.file_path ?? args?.path
    let files
    if (name === 'read' || name === 'write') files = [explicit]
    else if (name === 'edit') {
      if ([args?.old_string !== undefined, args?.edits !== undefined, args?.input !== undefined].filter(Boolean).length !== 1) return 'unknown'
      if (args?.old_string !== undefined) files = [explicit]
      else if (Array.isArray(args?.edits)) files = [explicit, ...args.edits.map(e => e.rename).filter(Boolean)]
      else if (call?.selectedMode === 'apply_patch') {
        files = parsedPlanFiles(args, call, cwd)
        if (files === 'unknown') return 'unknown'
      }
      else if (typeof args?.input === 'string' && Patch) files = Patch.parse(args.input, { cwd, path: explicit }).sections.flatMap(s => [s.path, ...(s.fileOp?.kind === 'move' ? [s.fileOp.dest] : [])])
      else return 'unknown'
    } else return 'unknown'
    if (!files.length || files.some(f => typeof f !== 'string' || !f)) return 'unknown'
    const relative = files.map(f => path.relative(root, path.resolve(cwd, f)).split(path.sep).join('/'))
    if (relative.some(f => !f || f === '..' || f.startsWith('../') || path.isAbsolute(f))) return 'unknown'
    return [...new Set(relative)]
  } catch { return 'unknown' }
}

const choice = call => {
  if (call?.selectedMode && call.selectedMode !== 'unknown' && call.requestedMode && call.requestedMode !== 'unknown' && call.selectedMode !== call.requestedMode) return 'unknown'
  const mode = call?.selectedMode && call.selectedMode !== 'unknown' ? call.selectedMode : call?.requestedMode
  return mode === 'hashline' ? 'hashline' : ['replace', 'patch', 'apply_patch', 'write'].includes(mode) ? 'non-hashline' : 'unknown'
}

export function targetObservations(trace, sources, graph, Patch) {
  const root = sources.find(s => s.id === graph.rootId)?.cwd
  const positions = new Map(graph.order.map((r, i) => [r.sessionId + ':' + r.seq, i]))
  const observations = [], unassigned = []
  for (const source of sources) {
    let cwd = source.cwd
    for (const event of source.events) {
      if (event.seq < source.inherited) continue
      if (event.type === 'working-directory/change' && typeof event.data?.cwd === 'string') cwd = event.data.cwd
      const call = trace.calls.find(c => c.sessionId === source.id && c.startSeq === event.seq)
      if (!call) continue
      if (!['read', 'edit', 'write'].includes(call.name)) {
        if (['bash', 'pwsh'].includes(call.name)) unassigned.push({ sessionId: source.id, callId: call.id, reason: 'shell-side-effects-unknown' })
        continue
      }
      const files = requestFiles(call.name, event.data?.arguments, cwd, root, Patch, { ...call, receipts: source.receipts.filter(r => r.callId === call.id) })
      if (files === 'unknown') { if (call.name !== 'read') unassigned.push({ sessionId: source.id, callId: call.id, reason: 'unresolved-target' }); continue }
      for (const file of files) observations.push({ file, call, order: positions.get(source.id + ':' + event.seq) })
    }
  }
  observations.sort((a, b) => a.order - b.order)
  return { observations, unassigned }
}

export function unavailableTargets(task) {
  if (!task.targets?.length) return { status: 'not-declared', targets: [], rates: 'unknown' }
  const targets = task.targets.map(t => ({ id: t.id, path: t.path, class: t.class, firstAttempt: 'unknown', mode: 'unknown' }))
  return { status: 'GAP', targets, rates: adoption(targets) }
}

export function targetSummary(task, trace, sources, graph, final, Patch) {
  if (!task.targets?.length) return unavailableTargets(task)
  const { observations, unassigned } = targetObservations(trace, sources, graph, Patch)
  const fileKey = f => process.platform === 'win32' ? f.toLowerCase() : f
  for (const observation of observations.filter(o => o.call.name !== 'read')) {
    if (!task.targets.some(t => fileKey(t.path) === fileKey(observation.file))) unassigned.push({ sessionId: observation.call.sessionId, callId: observation.call.id, reason: 'unannotated-target' })
  }
  const targets = task.targets.map(target => {
    const key = f => process.platform === 'win32' ? f.toLowerCase() : f
    const observed = observations.filter(o => key(o.file) === key(target.path))
    const writes = observed.filter(o => o.call.name !== 'read')
    const reads = { initial: 0, beforeEdit: 0, afterFailure: 0, afterSuccess: 0, failed: 0, concurrentOrUnknown: 0 }
    const readSessions = new Set()
    for (const observation of observed.filter(o => o.call.name === 'read')) {
      const call = observation.call
      if (call.isError !== false) { reads.failed++; continue }
      const prior = writes.filter(o => o.call.sessionId === call.sessionId && o.call.endOrder < call.startOrder).sort((a, b) => a.call.endOrder - b.call.endOrder).at(-1)?.call
      const overlaps = writes.some(o => o.call.startOrder < call.endOrder && o.call.endOrder > call.startOrder)
      if (overlaps || (prior && prior.isError === undefined)) reads.concurrentOrUnknown++
      else if (prior) reads[prior.isError ? 'afterFailure' : 'afterSuccess']++
      else if (!readSessions.has(call.sessionId)) reads.initial++
      else reads.beforeEdit++
      readSessions.add(call.sessionId)
    }
    const fileResult = final.files?.find(f => f.name === target.path)
    const unattributedChange = fileResult?.changed === true && !writes.length
    const ambiguous = trace.status !== 'PASS' || unassigned.length > 0 || unattributedChange
    const modes = [...new Set(writes.map(o => o.call.name === 'write' && o.call.isError === false ? 'non-hashline' : o.call.actualMode === 'hashline' ? 'hashline' : o.call.actualMode && o.call.actualMode !== 'unknown' ? 'non-hashline' : 'unknown'))]
    return {
      id: target.id, path: target.path, class: target.class,
      firstAttempt: ambiguous ? 'unknown' : writes[0] ? writes[0].call.name === 'write' ? 'non-hashline' : choice(writes[0].call) : 'not-attempted',
      mode: ambiguous || modes.includes('unknown') ? 'unknown' : modes.length > 1 ? 'mixed' : modes[0] ?? 'not-attempted',
      observedCalls: writes.map(o => ({ sessionId: o.call.sessionId, callId: o.call.id })),
      observedAttempts: writes.length, observedFailures: writes.filter(o => o.call.isError).length,
      observedRecovery: writes.some((o, i) => o.call.isError === false && writes.slice(0, i).some(p => p.call.isError === true)),
      reads, finalCorrect: fileResult?.correct ?? 'unknown', changedOnDisk: fileResult?.changed ?? 'unknown',
    }
  })
  return { status: trace.status !== 'PASS' || unassigned.length || targets.some(t => t.firstAttempt === 'unknown') ? 'GAP' : 'PASS', targets, unassigned, rates: adoption(targets) }
}
