/**
 * Baseline collection: real resolved versions, patch evidence from build files,
 * and explicit `unknown` for anything that cannot be established.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { baselineInputsProblem, baselineHashOf, baselineSnapshot, consentDrift, driftSummary } from '../../presets/ptc-hashline/operations/proposals.mjs'
import { collectBaseline, patchEvidence, readChangedInputs, readManifest, readRepositoryState } from '../../presets/ptc-hashline/operations/baseline.mjs'

const dirs: string[] = []
const installationRoot = process.cwd()

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('baseline: the running combination as actually resolved', () => {
  it('reports resolved versions for the host contracts the preset mounts', () => {
    const baseline = collectBaseline({ installationRoot })
    expect(baseline.versions.bundle).toBe('0.0.0')
    for (const key of ['tools', 'fs', 'agent', 'session', 'skill', 'cordis']) {
      expect(baseline.versions[key], key).toMatch(/^\d+\.\d+\.\d+/u)
    }
  })

  it('separates installation, maintenance repository and upgrade target', () => {
    const baseline = collectBaseline({ installationRoot })
    expect(baseline.roles.installation.root).toBe(path.resolve(installationRoot))
    // Unspecified roles stay unknown instead of defaulting to the cwd.
    expect(baseline.roles.maintenanceRepository).toBe('unknown')
    expect(baseline.roles.upgradeTarget).toBe('unknown')
    expect(baseline.unknown).toContain('maintenance repository')
    expect(baseline.unknown).toContain('upgrade target')
  })

  it('records explicit role values when the caller supplies them', async () => {
    // A real worktree, so the repository facts are readable rather than unknown.
    const repository = process.cwd()
    const baseline = collectBaseline({
      installationRoot,
      maintenanceRepository: repository,
      upgradeTarget: '/consented/target',
      provider: 'trae',
      model: 'deepseek-v4.1-flash',
      presetId: 'ptc-hashline',
      presetSource: 'session log',
    })
    expect(baseline.session).toEqual({ provider: 'trae', model: 'deepseek-v4.1-flash', preset: 'ptc-hashline', presetSource: 'session log' })
    // Every named gap must correspond to a version that really is unknown, and
    // every unknown version must be named: the two lists cannot disagree.
    const unknownVersions = Object.entries(baseline.versions).filter(([, version]) => version === 'unknown').map(([label]) => 'version: ' + label)
    expect(baseline.unknown.filter(entry => entry.startsWith('version: ')).sort()).toEqual(unknownVersions.sort())
  })

  it('records the maintenance worktree commit, dirty state and input digests', () => {
    const baseline = collectBaseline({ installationRoot, maintenanceRepository: process.cwd() })
    // This checkout has uncommitted work by construction (the change under
    // test), so the dirty signal must see it: a matching HEAD is not proof.
    expect(baseline.repository.commit).toMatch(/^[0-9a-f]{7,40}$/u)
    expect(baseline.repository.dirty).toBe('dirty')
    expect(baseline.repository.changedPaths.length).toBeGreaterThan(0)
    expect(baseline.repository.lockfileSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(baseline.repository.patchFiles.map(entry => path.basename(entry.path)).sort())
      .toEqual(['@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch', '@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch'])
    for (const entry of baseline.repository.patchFiles) expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('reports a non-repository maintenance path as unknown, with the reason', () => {
    const baseline = collectBaseline({ installationRoot, maintenanceRepository: '/definitely/not/a/repo' })
    expect(baseline.repository.commit).toBe('unknown')
    expect(baseline.repository.dirty).toBe('unknown')
    expect(baseline.repository.detail).toBeDefined()
    expect(baseline.unknown).toContain('maintenance repository commit')
  })

  it('records the physical engine directories the build actually loads', () => {
    const baseline = collectBaseline({ installationRoot })
    expect(baseline.realpaths.hashline).toContain('dsh-hashline')
    expect(baseline.realpaths.toolEdit).toContain('dsh-tool-edit')
    // A physical path, not a resolver's logical answer.
    expect(path.isAbsolute(baseline.realpaths.hashline)).toBe(true)
  })

  it('reads patch evidence from the resolved build, not from a version number', () => {
    const baseline = collectBaseline({ installationRoot })
    expect(baseline.engines.hashline.patch.status).toBe('patched')
    expect(baseline.engines.hashline.patch.present?.length ?? 0).toBeGreaterThan(0)
    expect(baseline.engines.toolEdit.patch.status).toBe('patched')
    expect(baseline.engines.hashline.patch.note).toContain('not evidence')
    // The engine version is the pinned anchor, and patch evidence is a SEPARATE
    // fact: the same version with no markers must never read as patched.
    expect(baseline.engines.hashline.version).toBe('0.2.1-alpha.4')
  })

  it('distinguishes partial, unpatched and unknown patch evidence', async () => {
    const root = await temp('operations-baseline-')
    const pkg = path.join(root, 'node_modules', 'fake-engine')
    await writeFile(path.join(root, 'package.json'), '{"name":"probe"}\n', 'utf8')
    await mkdir(path.join(pkg, 'dist'), { recursive: true })
    await writeFile(path.join(pkg, 'package.json'), '{"name":"fake-engine","version":"1.0.0"}\n', 'utf8')
    const markers = [{ file: ['dist', 'a.js'], marker: 'ALPHA' }, { file: ['dist', 'b.js'], marker: 'BETA' }]
    await writeFile(path.join(pkg, 'dist', 'a.js'), 'ALPHA\n', 'utf8')
    await writeFile(path.join(pkg, 'dist', 'b.js'), 'nothing\n', 'utf8')
    const requireFrom = createRequire(path.join(root, 'package.json'))
    const partial = patchEvidence(requireFrom, 'fake-engine', markers)
    expect(partial.status).toBe('partial')
    expect(partial.present).toEqual(['ALPHA'])
    expect(partial.missing).toEqual(['BETA'])
    await writeFile(path.join(pkg, 'dist', 'a.js'), 'nothing\n', 'utf8')
    expect(patchEvidence(requireFrom, 'fake-engine', markers).status).toBe('unpatched')
    const unknown = patchEvidence(requireFrom, 'not-installed-engine', markers)
    expect(unknown.status).toBe('unknown')
    expect(unknown.detail).toContain('does not resolve')
  })

  it('reports an unknown manifest as unknown, with the reason', () => {
    const requireFrom = createRequire(path.join(installationRoot, 'package.json'))
    const missing = readManifest(requireFrom, 'package-that-is-not-installed')
    expect(missing.version).toBe('unknown')
    expect(missing.detail).toBeDefined()
  })

  it('names a gap only for a version it could not establish', () => {
    // A manifest path outside this workspace still resolves host packages,
    // because Node walks up from the given root — that is real resolution, not
    // a guess. What must hold is the INVARIANT: a version reported as unknown is
    // always named in the gap list, and no package is invented where none
    // exists.
    const emptyRoot = path.join(os.tmpdir(), 'operations-empty-install-' + String(process.pid))
    const empty = collectBaseline({ installationRoot: emptyRoot })
    const unknownVersions = Object.entries(empty.versions).filter(([, version]) => version === 'unknown').map(([label]) => 'version: ' + label)
    expect(empty.unknown.filter(entry => entry.startsWith('version: ')).sort()).toEqual(unknownVersions.sort())
    // The bundle manifest itself is absent there, so its version is unknown and
    // named.
    expect(empty.versions.bundle).toBe('unknown')
    expect(empty.unknown).toContain('version: bundle')
    // The installation root is still reported as itself: an absent install does
    // not become an absent role.
    expect(empty.roles.installation.root).toBe(path.resolve(emptyRoot))
    // Nothing is fabricated: a package that cannot resolve says so.
    const requireFrom = createRequire(path.join(emptyRoot, 'package.json'))
    expect(readManifest(requireFrom, 'package-that-cannot-resolve').version).toBe('unknown')
  })
})

/**
 * R3/D10: the baseline binds the CONTENT of every uncommitted input.
 *
 * A path list is not an input. The same dirty path holding v1 at proposal time and
 * v2 at switch time used to hash identically, so an approval silently covered
 * bytes the user never saw.
 */
describe('baseline: an uncommitted input is bound to its CONTENT, not its name', () => {
  const git = (repository: string, ...args: string[]): string =>
    execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  /** A one-commit worktree, so every later write is genuinely uncommitted. */
  async function seededRepo(): Promise<string> {
    const repository = await temp('baseline-content-')
    await writeFile(path.join(repository, 'source.js'), 'v0\n', 'utf8')
    await writeFile(path.join(repository, 'gone.txt'), 'bye\n', 'utf8')
    await writeFile(path.join(repository, 'old-name.txt'), 'rename me\n', 'utf8')
    git(repository, 'init', '-q')
    git(repository, 'add', '.')
    git(repository, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline')
    return repository
  }

  it('hashes two different contents at the SAME dirty path differently', async () => {
    const repository = await seededRepo()
    await writeFile(path.join(repository, 'source.js'), 'v1\n', 'utf8')
    const first = readRepositoryState(repository)
    const firstHash = baselineHashOf({ repository: first })
    await writeFile(path.join(repository, 'source.js'), 'v2-not-validated\n', 'utf8')
    const second = readRepositoryState(repository)
    const secondHash = baselineHashOf({ repository: second })

    // The NAMES are identical — which is exactly why names alone cannot bind it.
    expect(second.changedPaths).toEqual(first.changedPaths)
    expect(secondHash).not.toBe(firstHash)
    const entry = (second.changedInputs ?? []).find((input) => input.path === 'source.js')
    expect(entry?.state).toBe('modified')
    expect(entry?.kind).toBe('file')
    // The digest is of the bytes on disk, compared with one computed here.
    expect(entry?.sha256).toBe(createHash('sha256').update('v2-not-validated\n').digest('hex'))

    // And an approval that named v1 no longer covers v2.
    const drift = consentDrift({
      // The projection under test, not a whole written proposal: the snapshot is
      // what the drift compares, and the shape is checked by the unit above.
      proposal: { baselineHash: firstHash, baseline: { format: 2, inputs: [] } } as any,
      baseline: { repository: second },
    })
    expect(drift.map((entry2: any) => entry2.field)).toContain('baselineHash')
  })

  it('reads a spaced name, a Unicode name, a rename pair and a deletion exactly, never as an empty file', async () => {
    const repository = await seededRepo()
    await writeFile(path.join(repository, 'a file with spaces.txt'), 'spaced\n', 'utf8')
    await writeFile(path.join(repository, '中文名称.txt'), 'unicode\n', 'utf8')
    await mkdir(path.join(repository, 'nested dir'), { recursive: true })
    await writeFile(path.join(repository, 'nested dir', 'inner.txt'), 'inner\n', 'utf8')
    git(repository, 'mv', 'old-name.txt', 'new-name.txt')
    await rm(path.join(repository, 'gone.txt'))
    const inputs = readChangedInputs(repository).inputs
    const byPath = new Map(inputs.map((entry) => [entry.path, entry]))

    expect(byPath.get('a file with spaces.txt')).toMatchObject({ state: 'untracked', kind: 'file' })
    expect(byPath.get('a file with spaces.txt')?.sha256).toBe(createHash('sha256').update('spaced\n').digest('hex'))
    expect(byPath.get('中文名称.txt')?.sha256).toBe(createHash('sha256').update('unicode\n').digest('hex'))
    // An untracked DIRECTORY is expanded to its files, never one opaque entry.
    expect(byPath.get('nested dir/inner.txt')?.state).toBe('untracked')
    // A rename carries both names, and a deletion is a fact with no bytes.
    expect(byPath.get('new-name.txt')).toMatchObject({ state: 'renamed', from: 'old-name.txt' })
    expect(byPath.get('gone.txt')).toMatchObject({ state: 'deleted', kind: 'absent', sha256: 'missing' })
    // Sorted, so a digest can never depend on git's output order.
    expect(inputs.map((entry) => entry.path)).toEqual([...inputs.map((entry) => entry.path)].sort((left, right) => left.localeCompare(right)))
  })

  it('refuses a proposal written before content binding instead of back-filling it from today\'s files', () => {
    const legacy = { baselineHash: 'a'.repeat(64), baseline: { commit: 'abc1234', dirty: 'dirty', changedPaths: ['source.js'] } }
    expect(String(baselineInputsProblem(legacy))).toContain('upgrade assess')
    const drift = consentDrift({ proposal: legacy as any, baseline: { repository: { commit: 'abc1234', changedPaths: ['source.js'] } } })
    const refused = drift.find((entry: any) => entry.field === 'baseline.inputs')
    expect(refused).toBeDefined()
    expect(String(refused?.note)).toContain('baseline.inputs')
    // The RENDERED refusal must carry that remedy: "null -> null" alone tells the
    // user nothing about what to run next.
    const rendered = driftSummary(drift)
    expect(rendered).toContain('baseline.inputs')
    expect(rendered).toContain('upgrade assess')
    // …and it names WHICH side is missing instead of a bare "null -> null".
    expect(rendered).toContain('content-bound baseline -> absent')
    // A record that DOES carry the content-bound baseline passes the same check.
    expect(baselineInputsProblem({ baseline: { format: 2, inputs: [] } })).toBeUndefined()
  })
})

describe('baseline: an input set that could not be read is not an empty one', () => {
  it('refuses a proposal built while the input list was unreadable', () => {
    // The plain porcelain call works, the content-bound one does not: exactly the
    // shape a half-working worktree produces. `inputs: []` here would be a lie that
    // a clean worktree also produces, so it must not collapse into one.
    const stub = (...args: unknown[]) => {
      const argv = args[1] as string[]
      if (argv.includes('rev-parse')) return 'a'.repeat(40)
      if (argv.includes('-z')) throw new Error('this fixture cannot read a NUL-delimited listing')
      if (argv.includes('status')) return ' M source.js\n'
      return ''
    }
    const state = readRepositoryState(process.cwd(), { execFileSync: stub as any })
    expect(state.changedPaths).toEqual(['source.js'])
    expect(state.changedInputsProblem).toContain('git status could not be read')
    const snapshot = baselineSnapshot({ repository: state })
    expect(snapshot.inputs).toEqual([])
    // The failure is CARRIED, so the digest differs from a genuinely clean worktree.
    expect(snapshot.inputsProblem).toContain('could not be read')
    expect(String(baselineInputsProblem({ baseline: snapshot }))).toContain('could not be read')
    // A clean worktree (no problem, no inputs) is accepted by the same check.
    expect(baselineInputsProblem({ baseline: { format: 2, inputs: [] } })).toBeUndefined()
  })

  it('records a merge conflict as unmerged, never as a deletion', async () => {
    const repository = await temp('baseline-conflict-')
    const git = (...args: string[]): string => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    await writeFile(path.join(repository, 'shared.txt'), 'base\n', 'utf8')
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base')
    git('checkout', '-q', '-b', 'other')
    await writeFile(path.join(repository, 'shared.txt'), 'theirs\n', 'utf8')
    git('commit', '-qam', 'theirs')
    git('checkout', '-q', '-')
    await writeFile(path.join(repository, 'shared.txt'), 'ours\n', 'utf8')
    git('commit', '-qam', 'ours')
    try {
      git('merge', 'other')
    } catch {
      // The merge is EXPECTED to fail: the conflict is the fixture.
    }
    const entry = readChangedInputs(repository).inputs.find((input) => input.path === 'shared.txt')
    expect(entry?.state).toBe('unmerged')
  })
})
