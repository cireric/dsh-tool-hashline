import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { rehearsal, REHEARSAL_CASES } from '../../scripts/evaluation/joint-rehearsal.mjs'

/**
 * DRY-RUN rehearsal of the joint acceptance pipeline.
 *
 * It proves the plumbing the collection guide describes: a session artifact is read by the
 * shipped decoder, the extractor writes the three-part report (declaration / cost / tool path),
 * runs.json is accepted, and the reconciliation separates the two cases while listing the 38
 * conversations that did not run as GAPS.
 *
 * It proves nothing about a model: the artifacts are fixed fixtures written by the rehearsal.
 */
describe('joint acceptance pipeline: dry-run rehearsal', () => {
  it('runs artifact → report → runs.json → reconciliation and stays consistent', async () => {
    const root = path.join(process.cwd(), '.tmp', 'joint-rehearsal-spec')
    const summary = await rehearsal({ root })
    expect(summary.extractExits).toEqual({ G1: 0, T3: 0 })
    expect(summary.reconcileExit).toBe(0)
    expect(summary.rows).toBe(2)
    expect(summary.gaps).toBe(38) // the other 38 conversations did not run: GAPS, not passes
    expect(summary.consistent).toBe(true)
    expect(REHEARSAL_CASES).toEqual(['G1', 'T3'])
    // the tool case used the declared path; the gate case has no tool task of its own
    expect(summary.toolCase?.toolPath?.verdict).toBe('applied-tool-path')
    expect(summary.gateCase?.toolPath).toBeNull()
    // the gate case really went through one repair, and the cost of the withheld attempt survived
    expect(summary.gateCase?.declaration).toMatchObject({ repairs: 1, accepted: 1, issues: 0 })
    expect(summary.totals.usageUnknown).toBeGreaterThan(0)
  })

  it('writes the report shapes the collection guide tells a maintainer to produce', async () => {
    const root = path.join(process.cwd(), '.tmp', 'joint-rehearsal-shape')
    await rehearsal({ root })
    const report = JSON.parse(await readFile(path.join(root, 'case-T3', 'a', 'report.json'), 'utf8'))
    expect(report.evidence.status).toBe('complete')
    expect(report.accounting.totals.requests).toBe(1)
    expect(Array.isArray(report.toolPath.tasks)).toBe(true)
    expect(report.toolPath.tasks.map((task: { taskId: string }) => task.taskId)).toContain('T3')
    // no arguments, bodies or program source leak into the tool-path block
    const serialised = JSON.stringify(report.toolPath)
    expect(serialised).not.toContain('tools.read')
    expect(serialised).not.toContain('retries')
  })
})
