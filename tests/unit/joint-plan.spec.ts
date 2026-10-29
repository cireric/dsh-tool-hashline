import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CASE_LINE,
  REQUIRED_APPROVAL_FIELDS,
  approvalBlockers,
  buildRunPlan,
  reconcileRun,
  validateCases,
} from '../../scripts/evaluation/joint-plan.mjs'

/**
 * The frozen joint evaluation's arithmetic and refusal rules (intent-gate P6 + tool-routing T4).
 *
 * This suite never calls a model: it pins that the SHIPPED frozen case file is self-consistent,
 * that the planner refuses to produce a run plan while the human-owned approval fields are
 * empty, and that reconciliation reports a session that did not run as a GAP instead of a pass.
 */
const manifestPath = path.resolve(process.cwd(), 'docs/plans/2026-10-28-joint-real-model-cases.json')

const loadShipped = async () => JSON.parse(await readFile(manifestPath, 'utf8')) as any

const minimalDocument = (): any => ({
  budget: { perConversationGenerations: 6, conversations: 4, nominalGenerationCap: 24 },
  cases: [
    { id: 'G1', line: 'gate', input: ['ask something'], tags: ['FIX-01'] },
    { id: 'T3', line: 'tool', kind: 'text-update', targets: ['src/a.ts'], input: ['update it'], tags: ['TOOL-02'] },
  ],
})

const fullApproval = () => Object.fromEntries(REQUIRED_APPROVAL_FIELDS.map(field => [field, field.includes('Price') || field.includes('Cap') ? 1 : 'x']))

describe('frozen joint cases: the shipped file is self-consistent', () => {
  it('validates the file this repository actually ships', async () => {
    const document = await loadShipped()
    const result = validateCases(document)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.stats).toMatchObject({ cases: 20, gate: 12, tool: 8, conversations: 40, nominalGenerationCap: 240 })
  })

  it('rejects a duplicate id, an unknown kind, a gate case with a tool kind, and bad budget arithmetic', () => {
    const document = minimalDocument()
    document.cases.push({ id: 'T3', line: 'tool', kind: 'text-read', targets: [], input: ['x'] })
    document.cases.push({ id: 'G2', line: 'gate', kind: 'text-read', input: ['x'] })
    document.cases.push({ id: 'T9', line: 'tool', kind: 'not-a-kind', targets: [], input: ['x'] })
    document.budget.conversations = 3
    const result = validateCases(document)
    expect(result.ok).toBe(false)
    expect(result.errors.join(' ')).toContain('duplicate case id: T3')
    expect(result.errors.join(' ')).toContain('is a gate case but declares a tool kind')
    expect(result.errors.join(' ')).toContain('unknown tool kind: not-a-kind')
    expect(result.errors.join(' ')).toContain('does not match cases × 2')
  })
})

describe('joint run plan: it refuses until a human fills the approval fields', () => {
  it('names every empty approval field and spends nothing', () => {
    const plan = buildRunPlan({ document: minimalDocument(), approval: { provider: 'p', model: 'm' } })
    expect(plan.status).toBe('unauthorized')
    expect(plan.blockers.filter(blocker => blocker.startsWith('approval.'))).toHaveLength(REQUIRED_APPROVAL_FIELDS.length - 2)
    expect(plan.plan.sessions).toHaveLength(4) // 2 cases × 2 independent sessions
  })

  it('marks the plan ready, with one evidence slot per conversation, once approval is complete', () => {
    const plan = buildRunPlan({ document: minimalDocument(), approval: fullApproval() })
    expect(plan.status).toBe('ready')
    expect(plan.blockers).toEqual([])
    expect(plan.plan.sessions.map(session => session.caseId + '/' + session.session)).toEqual(['G1/a', 'G1/b', 'T3/a', 'T3/b'])
    expect(plan.plan.evidenceSlots).toHaveLength(4)
    expect(plan.plan.limits.perConversationGenerations).toBe(6)
  })

  it('treats an approval field holding only whitespace as empty', () => {
    const approval = { ...fullApproval(), model: '   ' }
    expect(approvalBlockers(approval)).toContain('model')
  })
})

describe('joint reconciliation: four axes per session, gaps are not passes', () => {
  const report = () => ({
    evidence: { status: 'complete', issues: [] },
    accounting: { totals: { repairs: 1, attempts: 3, inputTokens: 14, outputTokens: 18, usageUnknown: 1 }, requests: [{ accepted: 1 }] },
    toolPath: { tasks: [{ taskId: 'T3', verdict: 'applied-tool-path', provenBypass: [], candidates: [], unknowns: [] }] },
  })

  it('reports declaration, cost and tool path separately, and counts an unrun session as a gap', () => {
    const result = reconcileRun({
      document: minimalDocument(),
      runs: [
        { caseId: 'G1', session: 'a', report: report() },
        { caseId: 'T3', session: 'a', report: report() },
        { caseId: 'T3', session: 'b', report: report() },
      ],
    })
    expect(result.rows).toHaveLength(3)
    expect(result.gaps).toEqual([{ caseId: 'G1', session: 'b', kind: 'session-did-not-run' }])
    const toolRow = result.rows.find(row => row.caseId === 'T3')
    expect(toolRow?.toolPath?.verdict).toBe('applied-tool-path')
    expect(toolRow?.declaration).toMatchObject({ repairs: 1, accepted: 1, issues: 0 })
    expect(toolRow?.cost).toMatchObject({ inputTokens: 14, outputTokens: 18, usageUnknown: 1 })
    const gateRow = result.rows.find(row => row.caseId === 'G1')
    expect(gateRow?.toolPath).toBeNull()
    expect(result.totals).toMatchObject({ rows: 3, gaps: 1, repairs: 3, inputTokens: 42, outputTokens: 54, usageUnknown: 3, toolPathClean: 2 })
  })

  it('keeps a bypass and an unknown verdict apart in the totals', () => {
    const bypass = () => ({ evidence: { status: 'complete', issues: [] }, accounting: { totals: {}, requests: [] }, toolPath: { tasks: [{ taskId: 'T3', verdict: 'bypass', provenBypass: [{ reason: 'shell-touches-target' }], candidates: [], unknowns: [] }] } })
    const unknown = () => ({ evidence: { status: 'incomplete', issues: ['torn-final-frame'] }, accounting: { totals: {}, requests: [] }, toolPath: { tasks: [{ taskId: 'T3', verdict: 'unknown', provenBypass: [], candidates: [{ signal: 'node:fs', mentionsTarget: true }], unknowns: [{ kind: 'unexplained-native-candidate-touching-target' }] }] } })
    const result = reconcileRun({
      document: minimalDocument(),
      runs: [
        { caseId: 'T3', session: 'a', report: bypass() },
        { caseId: 'T3', session: 'b', report: unknown() },
      ],
    })
    expect(result.totals.toolPathBypass).toBe(1)
    expect(result.totals.toolPathUnknown).toBe(1)
    expect(result.rows.find(row => row.session === 'b')?.complete).toBe(false)
  })
})
