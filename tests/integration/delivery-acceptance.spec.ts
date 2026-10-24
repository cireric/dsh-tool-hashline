/**
 * The delivery-acceptance harness's own invariants (ticket 08).
 *
 * The full run (pack → install → real launcher compose → both workflows) is a
 * gate script, not a unit of this tier: it installs a real profile from the
 * registry. What is worth pinning here is the part a regression would silently
 * break — the verdict rules that decide PASS/GAP/FAIL/BLOCKED, the report's
 * required sections, the boundaries a report must never drop, and the fixture
 * writers the workflows stand on.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  byAcceptanceId,
  redact,
  renderReport,
  renderSummary,
  verdictOf,
} from '../../scripts/delivery-acceptance-report.mjs'
import { ACCEPTANCE_IDS, GATES, REPORT_SECTIONS, boundariesFor, profileNames, reportNames } from '../../scripts/delivery-acceptance-run.mjs'
import { nextVersion, writeMaintenanceRepository, writeTargetProfile } from '../../scripts/delivery-acceptance-workflows.mjs'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('the delivery report never promotes a gap to a pass', () => {
  it('ranks FAIL over GAP over PASS, and never reports an unmeasured id as passing', () => {
    expect(verdictOf([])).toBe('BLOCKED')
    expect(verdictOf([{ ok: true }, { ok: true, gap: true }])).toBe('GAP')
    expect(verdictOf([{ ok: true }, { ok: false }, { ok: true, gap: true }])).toBe('FAIL')
    expect(verdictOf([{ ok: true }, { ok: true }])).toBe('PASS')
  })

  it('keeps every acceptance id in the report, in order, even with no row', () => {
    const run = {
      startedAt: '2026-11-02T00:00:00.000Z',
      rows: [{ id: 'PACK-01', part: 'pack', ok: true, detail: 'packed' }],
      gates: [],
      boundaries: ['a stated boundary'],
      acceptanceIds: ACCEPTANCE_IDS,
    }
    const grouped = byAcceptanceId(run.rows, ACCEPTANCE_IDS)
    expect([...grouped.keys()]).toEqual(ACCEPTANCE_IDS)
    // Every declared id appears in the rendered report, so a missing case reads as
    // BLOCKED rather than silently vanishing.
    const markdown = renderReport(run)
    for (const id of ACCEPTANCE_IDS) expect(markdown).toContain('### ' + id + ' — ')
    expect(markdown).toContain('| PACK-01 | PASS | 1 |')
    expect(markdown).toContain('| SCOPE-01 | BLOCKED | 0 |')
    const summary = renderSummary(run)
    expect(summary.verdicts['SCOPE-01']).toBe('BLOCKED')
    expect(summary.counts.PASS).toBe(1)
  })
})

describe('the report ships without the operator paths', () => {
  it('replaces home and temporary directories in both artifacts', () => {
    // A report and its summary commit to the repository: where the run happened
    // is evidence of the machine, not of the behaviour, so neither may carry it.
    expect(redact('installed into C:\\Users\\someone\\AppData\\Local\\Temp\\delivery-x\\dsh-home')).toBe('installed into <temp>\\dsh-home')
    expect(redact('root /tmp/delivery-y/skills')).toBe('root <temp>/skills')
    expect(redact('a note under C:\\Users\\someone only')).toBe('a note under <home> only')
    expect(redact('unchanged (desktop,node_modules,web)')).toBe('unchanged (desktop,node_modules,web)')
    const run = {
      startedAt: '2026-11-02T00:00:00.000Z',
      rows: [{ id: 'PACK-01', part: 'install', ok: true, detail: 'installed into C:\\Users\\someone\\AppData\\Local\\Temp\\delivery-z' }],
      gates: [],
      boundaries: [],
      acceptanceIds: ACCEPTANCE_IDS,
      install: { bundleRoot: 'C:\\Users\\someone\\AppData\\Local\\Temp\\delivery-z', profile: '/tmp/delivery-z/p' },
    }
    const summary = renderSummary(run)
    expect(JSON.stringify(summary)).not.toContain('someone')
    expect(summary.rows[0].detail).toBe('installed into <temp>')
    expect(renderReport(run)).not.toContain('someone')
  })
})

describe('the report separates the areas the spec asks for', () => {
  it('reports every declared section, and marks an unmeasured one instead of dropping it', () => {
    const run = {
      startedAt: '2026-11-02T00:00:00.000Z',
      rows: [{ id: 'PACK-01', part: 'pack', ok: true, detail: 'packed' }],
      gates: [],
      boundaries: [],
      acceptanceIds: ACCEPTANCE_IDS,
      sections: REPORT_SECTIONS,
    }
    const summary = renderSummary(run)
    // Six areas, in declaration order; only the section whose ID has a row passes,
    // and every other one says so out loud rather than disappearing.
    expect(summary.sections).toHaveLength(REPORT_SECTIONS.length)
    expect(summary.sections[0]).toMatchObject({ verdict: 'PASS', cases: 1 })
    expect(summary.sections.slice(1).every((section) => section.verdict === 'unmeasured' && section.cases === 0)).toBe(true)
    const markdown = renderReport(run)
    for (const section of REPORT_SECTIONS) expect(markdown).toContain(section.title)
    expect(markdown).toContain('| 未测 |')
    // Every declared section must name at least one acceptance id the run reports,
    // so a section can never reference an ID nothing measures.
    for (const section of REPORT_SECTIONS) {
      expect(section.ids.length).toBeGreaterThan(0)
      for (const id of section.ids) expect(ACCEPTANCE_IDS).toContain(id)
    }
  })
})

describe('the installed driver stays aligned with the source-tree harness', () => {
  it('mounts the same host services in the same order as operations-preset-harness', async () => {
    // The driver has to live in the PROFILE (it resolves through the install), so it
    // is a string in this module. That is exactly the kind of copy that drifts: this
    // case pins the mount order both use, so a change to the host contract fails here
    // instead of silently producing two different compositions.
    const [harnessSource, driver] = await Promise.all([
      readFile(path.resolve(process.cwd(), 'tests/integration/operations-preset-harness.ts'), 'utf8'),
      import('../../scripts/delivery-acceptance.mjs').then((module) => module.SKILL_LAYER_DRIVER as string),
    ])
    // ToolRuntime is constructed, not `ctx.plugin`-ed, in both files: it is a
    // runtime object the agent's tools register into, so it is compared separately.
    const order = ['SessionProjectionRegistry', 'SkillRegistry', 'SystemPrompt', 'AgentPresets']
    const positions = (source: string) => order.map((name) => source.indexOf('ctx.plugin(' + name))
    const harnessPositions = positions(harnessSource)
    const driverPositions = positions(driver)
    // Both mount all five, and both mount them in the same declared order.
    expect(harnessPositions.every((value) => value > 0)).toBe(true)
    expect(driverPositions.every((value) => value > 0)).toBe(true)
    const ascending = (values: number[]) => values.every((value, index) => index === 0 || values[index - 1] < value)
    expect(ascending(harnessPositions)).toBe(true)
    expect(ascending(driverPositions)).toBe(true)
    // Both mount the loader first and provide the same structural `agents` stub.
    expect(harnessSource).toContain('await ctx.plugin(Loader)')
    expect(driver).toContain('await ctx.plugin(Loader)')
    expect(harnessSource).toContain('new ToolRuntime(ctx)')
    expect(driver).toContain('new ToolRuntime(ctx)')
    expect(harnessSource).toContain("ctx.provide('agents'")
    expect(driver).toContain("ctx.provide('agents'")
  })
})

describe('the run states its own limits', () => {
  it('declares the injected runner, the one-off profile and the candidate form', () => {
    const boundaries = boundariesFor({ assessed: { value: { verified: false } } }).join('\n')
    expect(boundaries).toContain('INJECTED runner')
    expect(boundaries).toContain('one-off profile')
    expect(boundaries).toContain('fixed candidate')
    expect(boundaries).toContain('never claim "no upgrade"')
    // A verified assessment changes the wording; it does not drop the admission
    // that no dependency was installed and nothing was switched.
    const verified = boundariesFor({ assessed: { value: { verified: true } } }).join('\n')
    expect(verified).toContain('no dependency was installed')
    expect(verified).not.toContain('never claim "no upgrade"')
  })

  it('reports the failure path it actually measured, not the one it did not', () => {
    const restored = boundariesFor({ switchRecord: { conclusion: 'switch-failed-restored' } }).join('\n')
    expect(restored).toContain('FAILURE path')
    const applied = boundariesFor({ switchRecord: { conclusion: 'switch-applied' } }).join('\n')
    expect(applied).not.toContain('FAILURE path')
  })
})

describe('the report names and gate list', () => {
  it('takes its date from the run, never from a fixture', () => {
    expect(reportNames('2026-11-02T03:04:05.000Z')).toEqual({
      report: '2026-11-02-delivery-acceptance-report.md',
      summary: '2026-11-02-delivery-acceptance-summary.json',
    })
  })

  it('covers the gates the repository README documents', () => {
    const commands = GATES.map((gate: { command: string }) => gate.command)
    for (const required of ['pnpm build', 'pnpm test:unit', 'pnpm test:integration', 'pnpm test:ptc', 'pnpm test:compat', 'pnpm check:preset']) {
      expect(commands).toContain(required)
    }
    expect(commands).toContain('pnpm test:profile')
  })

  it('reads a missing host home as no profiles instead of failing', async () => {
    const home = await temp('delivery-home-')
    expect(await profileNames(home)).toEqual([])
  })
})

describe('the workflow fixtures a real run stands on', () => {
  it('bumps a version by semver precedence, including a pre-release tail', () => {
    expect(nextVersion('0.2.1')).toBe('0.2.2')
    expect(nextVersion('0.2.1-alpha.4')).toBe('0.2.1-alpha.5')
    expect(nextVersion('0.2.1-rc.1')).toBe('0.2.1-rc.2')
    expect(() => nextVersion('unknown')).toThrow(/no comparable engine version/u)
  })

  it('writes a maintenance worktree that git accepts and a profile that links it', async () => {
    const home = await temp('delivery-fixture-')
    const repository = path.join(home, 'maintenance')
    await writeMaintenanceRepository(repository, { hashline: '1.2.3', toolEdit: '1.2.3' })
    // The patch name carries the exact version: that coupling is what a switch
    // has to keep in sync, so the fixture must carry it too.
    expect(await stat(path.join(repository, 'patches', '@hy-sde-org__dsh-hashline@1.2.3.patch'))).toBeTruthy()
    expect(await readFile(path.join(repository, 'pnpm-workspace.yaml'), 'utf8')).toContain("'@hy-sde-org/dsh-hashline@1.2.3': patches/@hy-sde-org__dsh-hashline@1.2.3.patch")
    // The worktree gitignores its own evidence, so a ticket is never read back as
    // an uncommitted INPUT of the candidate.
    expect(await readFile(path.join(repository, '.gitignore'), 'utf8')).toContain('.scratch/')
    const profile = await writeTargetProfile(home, repository)
    const manifest = JSON.parse(await readFile(path.join(profile, 'package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('dsh-tool-hashline')
    expect(manifest.dependencies['dsh-tool-hashline']).toBe('link:' + repository.replaceAll('\\', '/'))
    // Idempotent: a second call must not fail a gate with "nothing to commit".
    await expect(writeMaintenanceRepository(repository, { hashline: '1.2.3', toolEdit: '1.2.3' })).resolves.toBeUndefined()
  })
})