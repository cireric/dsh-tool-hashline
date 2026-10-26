/** Consume the existing policy decision; never reimplement the upstream parser. */
import path from 'node:path'
import { POLICY_VERSION, requestTargets } from '../../presets/ptc-hashline/policy/default-edit-policy.mjs'

export function captureParsedPlan(receipt) {
  const decision = receipt.decision
  if (receipt.mode !== 'apply_patch' || decision?.mode !== 'apply_patch') return undefined
  return {
    version: receipt.version, callId: decision.callId,
    rootCallId: decision.rootCallId ?? decision.callId, mode: decision.mode,
    targets: Array.isArray(decision.targets) ? decision.targets.map(t => ({ path: t?.path, op: t?.op })) : undefined,
  }
}

export function parsedPlanFiles(args, call, cwd) {
  // The current decision omits rename destinations. Do not claim full coverage.
  if (typeof args?.input !== 'string' || /^\s*\*\*\* Move to:/mu.test(args.input)) return 'unknown'
  if (call?.requestedMode !== 'apply_patch' || call.selectedMode !== 'apply_patch' || !call.receipts?.length) return 'unknown'
  const normalize = file => {
    const resolved = path.resolve(cwd, file)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const authored = [...new Set(requestTargets('apply_patch', args).map(normalize))].sort()
  if (!authored.length) return 'unknown'
  for (const receipt of call.receipts) {
    const plan = receipt.parsedPlan
    if (receipt.callId !== call.id || receipt.mode !== 'apply_patch' || plan?.version !== POLICY_VERSION || plan.mode !== 'apply_patch' || plan.callId !== call.id || plan.rootCallId !== call.rootCallId || !Array.isArray(plan.targets) || !plan.targets.length) return 'unknown'
    if (plan.targets.some(t => typeof t?.path !== 'string' || !t.path.trim() || !['create', 'update', 'delete'].includes(t.op))) return 'unknown'
    const parsed = [...new Set(plan.targets.map(t => normalize(t.path)))].sort()
    if (JSON.stringify(parsed) !== JSON.stringify(authored)) return 'unknown'
  }
  return authored
}
