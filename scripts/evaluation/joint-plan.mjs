/**
 * Planning and reconciliation for the FROZEN joint real-model evaluation (intent-gate P6 +
 * tool-routing T4).
 *
 * What this module is: the arithmetic and the refusal rules around
 * [the frozen cases](../../docs/plans/2026-10-28-joint-real-model-cases.json). It validates the
 * frozen set, refuses to emit a run plan while the model/params/price/cap fields a human must
 * fill are empty, and turns the per-session evidence into the reconciliation table the plan
 * asks for ("语义结果 / 工具采用 / 业务正确 / 成本" reported separately).
 *
 * What it is NOT: a driver. It never calls a model, never writes a session, and it treats a
 * missing session as a GAP instead of a pass. Execution needs the user's explicit approval of
 * model, provider, generation parameters, prices and caps — the plan forbids inventing them.
 * @module dsh-tool-hashline/scripts/evaluation/joint-plan
 */

/** The fields a human must fill before any real call may run (manifest §2). */
export const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  'provider',
  'model',
  'reasoningEffort',
  'temperature',
  'maxTokens',
  'inputTokenPrice',
  'outputTokenPrice',
  'currency',
  'globalGenerationCap',
  'walletCap',
  'wallClockCap',
])

/** The two working lines a frozen case can belong to. */
export const CASE_LINE = Object.freeze({ GATE: 'gate', TOOL: 'tool' })

/** Tool-task kinds, duplicated here so the planner can validate without importing the judge. */
export const TOOL_KINDS = Object.freeze(['text-read', 'text-update', 'create', 'search', 'shell', 'no-file-work'])

const filled = value => value !== undefined && value !== null && String(value).trim() !== ''

/**
 * Validate the frozen case document: ids unique and well formed, the two lines separated, tool
 * cases carrying a known kind with declared targets, gate cases carrying none, and the budget
 * arithmetic consistent with the case count.
 * @param document - the parsed JSON document.
 * @returns { ok, errors, stats }
 */
export function validateCases(document) {
  const errors = []
  const cases = Array.isArray(document?.cases) ? document.cases : []
  if (cases.length === 0) errors.push('no cases')
  const seen = new Set()
  let gate = 0
  let tool = 0
  for (const entry of cases) {
    const id = String(entry?.id ?? '')
    if (id === '') errors.push('case without id')
    if (seen.has(id)) errors.push('duplicate case id: ' + id)
    seen.add(id)
    const line = entry?.line
    if (line !== CASE_LINE.GATE && line !== CASE_LINE.TOOL) errors.push('case ' + id + ' has an unknown line: ' + String(line))
    if (line === CASE_LINE.GATE) {
      gate += 1
      if (entry?.kind !== undefined) errors.push('case ' + id + ' is a gate case but declares a tool kind')
      if (!Array.isArray(entry?.input) || entry.input.length === 0) errors.push('case ' + id + ' has no frozen input')
    }
    if (line === CASE_LINE.TOOL) {
      tool += 1
      if (!TOOL_KINDS.includes(entry?.kind)) errors.push('case ' + id + ' has an unknown tool kind: ' + String(entry?.kind))
      if (!Array.isArray(entry?.targets)) errors.push('case ' + id + ' does not declare its targets')
      if (!Array.isArray(entry?.input) || entry.input.length === 0) errors.push('case ' + id + ' has no frozen input')
    }
  }
  const budget = document?.budget ?? {}
  const perConversation = budget.perConversationGenerations
  const conversations = budget.conversations
  if (Number.isSafeInteger(perConversation) && conversations !== cases.length * 2) {
    errors.push('budget.conversations ' + String(conversations) + ' does not match cases × 2 = ' + String(cases.length * 2))
  }
  if (Number.isSafeInteger(perConversation) && Number.isSafeInteger(conversations)
    && budget.nominalGenerationCap !== conversations * perConversation) {
    errors.push('budget.nominalGenerationCap ' + String(budget.nominalGenerationCap) + ' does not match conversations × perConversationGenerations')
  }
  return { ok: errors.length === 0, errors, stats: { cases: cases.length, gate, tool, conversations, nominalGenerationCap: budget.nominalGenerationCap ?? null } }
}

/** Which required approval fields are still empty. */
export function approvalBlockers(config) {
  const given = config !== null && typeof config === 'object' ? config : {}
  return REQUIRED_APPROVAL_FIELDS.filter(field => !filled(given[field]))
}

/**
 * Build the run plan — or refuse to. Nothing here spends anything: an unapproved plan is a list
 * of the sessions that WOULD run, so a human can review cost before authorising them.
 * @param input - { document, approval }.
 * @returns { status, blockers, plan }
 */
export function buildRunPlan(input) {
  const document = input?.document ?? {}
  const validation = validateCases(document)
  const blockers = [...validation.errors, ...approvalBlockers(input?.approval).map(field => 'approval.' + field + ' is empty')]
  const cases = Array.isArray(document?.cases) ? document.cases : []
  const budget = document?.budget ?? {}
  const plan = {
    cases: cases.map(entry => String(entry?.id)),
    sessions: cases.flatMap(entry => ['a', 'b'].map(session => ({ caseId: String(entry?.id), session }))),
    limits: {
      perConversationGenerations: budget.perConversationGenerations ?? null,
      globalGenerationCap: input?.approval?.globalGenerationCap ?? null,
      walletCap: input?.approval?.walletCap ?? null,
      wallClockCap: input?.approval?.wallClockCap ?? null,
    },
    // One slot per session: the session artifact is what both the declaration reading and the
    // tool-path judgement consume, so the plan asks for exactly one file per conversation.
    evidenceSlots: cases.flatMap(entry => ['a', 'b'].map(session =>
      'evidence/' + String(entry?.id) + '/' + session + '/session.jsonl')),
  }
  return { status: blockers.length === 0 ? 'ready' : 'unauthorized', blockers, validation, plan }
}

/**
 * Reconcile the evidence a run produced into the four axes the two plans require, per session.
 *
 * `runs` is one entry per conversation: { caseId, session, report } where `report` is the
 * extractor's report for that session (it carries `accounting`, `toolPath` and
 * `evidence.status`). A session that did not run is a GAP row, never a skipped one.
 * @param input - { document, runs }.
 * @returns { rows, totals, gaps }
 */
export function reconcileRun(input) {
  const cases = Array.isArray(input?.document?.cases) ? input.document.cases : []
  const runs = Array.isArray(input?.runs) ? input.runs : []
  const byKey = new Map(runs.map(run => [String(run?.caseId) + '/' + String(run?.session), run]))
  const rows = []
  const gaps = []
  for (const entry of cases) {
    for (const session of ['a', 'b']) {
      const key = String(entry?.id) + '/' + session
      const run = byKey.get(key)
      if (run === undefined || run?.report === undefined || run?.report === null) {
        gaps.push({ caseId: String(entry?.id), session, kind: 'session-did-not-run' })
        continue
      }
      const report = run.report
      const accounting = report.accounting ?? { totals: {}, requests: [] }
      const toolPath = Array.isArray(report.toolPath?.tasks) ? report.toolPath.tasks : []
      const toolTask = toolPath.find(task => task.taskId === String(entry?.id))
      // The presentation axis (P3): what each policy-owned turn SHOULD have looked like. Reports
      // written before that block existed simply carry no axis here — absent, never "all fine".
      const presentation = report.presentation === undefined || report.presentation === null
        ? null
        : {
            turns: report.presentation.totals?.turns ?? 0,
            recovering: report.presentation.totals?.recovering ?? 0,
            failures: report.presentation.totals?.failure ?? 0,
            refused: (report.presentation.turns ?? []).filter(entry2 => entry2?.presentedAs === 'failure').map(entry2 => entry2?.reason ?? 'unknown'),
          }
      rows.push({
        caseId: String(entry?.id),
        line: entry?.line ?? null,
        session,
        complete: report.evidence?.status === 'complete',
        declaration: {
          issues: Array.isArray(report.evidence?.issues) ? report.evidence.issues.length : 0,
          repairs: accounting.totals?.repairs ?? 0,
          accepted: (accounting.requests ?? []).reduce((sum, request) => sum + (request.accepted ?? 0), 0),
        },
        cost: {
          attempts: accounting.totals?.attempts ?? 0,
          inputTokens: accounting.totals?.inputTokens ?? 0,
          outputTokens: accounting.totals?.outputTokens ?? 0,
          // "unknown" stays a count of unknown stages, never a substituted zero
          usageUnknown: accounting.totals?.usageUnknown ?? 0,
        },
        toolPath: toolTask === undefined
          ? null
          : { verdict: toolTask.verdict, provenBypass: toolTask.provenBypass?.length ?? 0, candidates: toolTask.candidates?.length ?? 0, unknowns: toolTask.unknowns?.length ?? 0 },
        presentation,
      })
    }
  }
  const totals = { rows: rows.length, gaps: gaps.length, repairs: 0, inputTokens: 0, outputTokens: 0, usageUnknown: 0, toolPathClean: 0, toolPathUnknown: 0, toolPathBypass: 0, presentationTurns: 0, presentationRecovering: 0, presentationFailures: 0, presentationRefused: 0 }
  for (const row of rows) {
    totals.repairs += row.declaration.repairs
    totals.inputTokens += row.cost.inputTokens
    totals.outputTokens += row.cost.outputTokens
    totals.usageUnknown += row.cost.usageUnknown
    if (row.toolPath?.verdict === 'applied-tool-path' || row.toolPath?.verdict === 'normal-exception' || row.toolPath?.verdict === 'no-file-work') totals.toolPathClean += 1
    else if (row.toolPath?.verdict === 'bypass') totals.toolPathBypass += 1
    else if (row.toolPath !== null) totals.toolPathUnknown += 1
    if (row.presentation !== null) {
      totals.presentationTurns += row.presentation.turns
      totals.presentationRecovering += row.presentation.recovering
      totals.presentationFailures += row.presentation.failures
      totals.presentationRefused += row.presentation.refused.length
    }
  }
  return { rows, totals, gaps }
}

/**
 * CLI:
 *   node scripts/evaluation/joint-plan.mjs --cases <frozen.json> [--approval <approval.json>] [--out <file>]
 *   node scripts/evaluation/joint-plan.mjs --cases <frozen.json> --runs <runs.json> [--out <file>]
 *
 * Exit codes: 0 = the plan is ready (or the reconciliation was written), 2 = the frozen set or
 * the approval is not yet runnable (nothing was spent; the blockers are listed), 1 = the input
 * itself is invalid (unreadable/not JSON/missing required file).
 */
export async function main(argv) {
  const { readFile, writeFile } = await import('node:fs/promises')
  const option = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const casesPath = option('--cases')
  if (casesPath === undefined) throw new Error('usage: --cases <frozen.json> [--approval <json>] [--runs <json>] [--out <file>]')
  const document = JSON.parse(await readFile(casesPath, 'utf8'))
  const out = option('--out')
  const write = async text => (out === undefined ? process.stdout.write(text) : writeFile(out, text, 'utf8'))
  const runsPath = option('--runs')
  if (runsPath !== undefined) {
    const runs = JSON.parse(await readFile(runsPath, 'utf8'))
    const result = reconcileRun({ document, runs: Array.isArray(runs) ? runs : runs?.runs })
    await write(JSON.stringify(result, null, 2) + '\n')
    return 0
  }
  const approvalPath = option('--approval')
  const approval = approvalPath === undefined ? {} : JSON.parse(await readFile(approvalPath, 'utf8'))
  const plan = buildRunPlan({ document, approval })
  await write(JSON.stringify(plan, null, 2) + '\n')
  if (!plan.validation.ok) return 1
  return plan.status === 'ready' ? 0 : 2
}

/* istanbul ignore next -- CLI entry, exercised by hand and by the runbook */
if (process.argv[1] !== undefined && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error('joint-plan: ' + String(error?.message ?? error))
    process.exitCode = 1
  })
}
