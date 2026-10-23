/**
 * Baseline collection: real resolved versions, patch evidence from build files,
 * and explicit `unknown` for anything that cannot be established.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectBaseline, patchEvidence, readManifest } from '../../presets/ptc-hashline/operations/baseline.mjs'

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
