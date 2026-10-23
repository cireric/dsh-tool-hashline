/**
 * PACK-01 (entry slice): the delivered assets resolve from a PACKED install,
 * with a changed working directory, and with no dependency on this checkout.
 *
 * A source-path test cannot see a `files`/exports omission: the packed tarball
 * is the artifact a user installs. This case packs the bundle, installs the
 * tarball into a throwaway project, then resolves the preset patch, both skill
 * bodies and every operations module from that install while running in an
 * unrelated directory.
 *
 * Claim boundary: this proves the asset slice of PACK-01 (provider, skills,
 * operations modules). The full clean-profile assembly is the delivery ticket.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const repo = process.cwd()
const SKILLS = ['ptc-hashline-incident', 'ptc-hashline-upgrade']
const MODULES = ['cli.mjs', 'context.mjs', 'config.mjs', 'baseline.mjs', 'session-log.mjs']
const roots: string[] = []
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

afterAll(async () => {
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('PACK-01: the installed bundle carries the operations assets', () => {
  it('packs, installs, and resolves every asset from an unrelated cwd', async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'operations-pack-'))
    roots.push(work)
    // 1) Pack exactly what the manifest ships.
    const packDir = path.join(work, 'pack')
    await mkdir(packDir, { recursive: true })
    execFileSync(PNPM, ['pack', '--pack-destination', packDir], { cwd: repo, stdio: 'pipe', timeout: 180_000 })
    const tarballs = (await readdir(packDir)).filter(name => name.endsWith('.tgz'))
    expect(tarballs).toHaveLength(1)
    const tarball = path.join(packDir, tarballs[0]!)

    // 2) Install it into a throwaway project. This is a real install: if the
    //    manifest forgot an asset, nothing below can find it. Only the bundle is
    //    installed here on purpose — its engine packages use the workspace
    //    protocol and are linked by the documented profile installer, so this
    //    case proves the BUNDLE's own assets, and the baseline must then report
    //    the absent engine as unknown rather than as patched.
    const project = path.join(work, 'project')
    await mkdir(project, { recursive: true })
    await writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'pack-probe', private: true, type: 'module' }, null, 2) + '\n')
    await writeFile(path.join(project, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    execFileSync(PNPM, ['add', tarball, '--ignore-workspace'], { cwd: project, stdio: 'pipe', timeout: 300_000 })

    // 3) Resolve from that install, in a directory that is NOT this checkout.
    const unrelated = path.join(work, 'elsewhere')
    await mkdir(unrelated, { recursive: true })
    const script = [
      "import { createRequire } from 'node:module'",
      "import { readFileSync, existsSync } from 'node:fs'",
      "import { dirname, join } from 'node:path'",
      "const requireFrom = createRequire(" + JSON.stringify(path.join(project, 'package.json')) + ")",
      "const manifestPath = requireFrom.resolve('dsh-tool-hashline/package.json')",
      "const root = dirname(manifestPath)",
      "const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))",
      "const patch = manifest.dsh.bundle.patch",
      "const skills = " + JSON.stringify(SKILLS) + ".map(name => ({ name, path: join(root, 'presets', 'ptc-hashline', 'skills', name, 'SKILL.md') }))",
      "const modules = " + JSON.stringify(MODULES) + ".map(name => ({ name, path: join(root, 'presets', 'ptc-hashline', 'operations', name) }))",
      "const operationsEntry = requireFrom.resolve('dsh-tool-hashline/presets/ptc-hashline/operations/cli.mjs')",
      "console.log(JSON.stringify({ root, patch, patchExists: existsSync(join(root, patch)), skills, modules, operationsEntry }))",
    ].join('\n')
    const driverPath = path.join(unrelated, 'resolve.mjs')
    await writeFile(driverPath, script + '\n', 'utf8')
    const stdout = execFileSync(process.execPath, [driverPath], { cwd: unrelated, encoding: 'utf8', timeout: 120_000 })
    const facts = JSON.parse(String(stdout.trim().split('\n').at(-1))) as {
      root: string
      patch: string
      patchExists: boolean
      skills: { name: string; path: string }[]
      modules: { name: string; path: string }[]
      operationsEntry: string
    }
    expect(facts.root).toContain('node_modules')
    expect(facts.root).not.toBe(repo)
    expect(facts.patchExists).toBe(true)
    for (const skill of facts.skills) {
      expect(skill.path.startsWith(String(facts.root)), skill.name).toBe(true)
      expect(existsSync(skill.path), skill.name).toBe(true)
    }
    for (const module of facts.modules) {
      expect(module.path.startsWith(facts.root), module.name).toBe(true)
      expect(existsSync(module.path), module.name).toBe(true)
    }
    expect(facts.operationsEntry).toContain('node_modules')

    // 4) The installed CLI actually runs there: no checkout, no .scratch, no
    //    root scripts, and a cwd that has nothing to do with this repository.
    const cliOutput = execFileSync(process.execPath, [facts.operationsEntry, 'baseline'], {
      cwd: unrelated,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, DSH_HOME: path.join(unrelated, 'dsh-home') },
    })
    const report = JSON.parse(cliOutput)
    expect(report.baseline.roles.installation.root).toBe(facts.root)
    expect(report.baseline.roles.installation.root).not.toBe(repo)
    // The bundle install carries no engine packages (they are linked by the
    // profile installer), so the baseline must say UNKNOWN for them instead of
    // claiming a patch it cannot read. This is the difference the ticket asks
    // for: a matching version is never evidence, and an absent build is not a
    // patched build.
    expect(report.baseline.engines.hashline.patch.status).toBe('unknown')
    expect(report.baseline.engines.toolEdit.patch.status).toBe('unknown')
    expect(report.baseline.engines.hashline.version).toBe('unknown')
    // The provider root expression in the installed patch points at the install.
    const patchText = await readFile(path.join(facts.root, facts.patch), 'utf8')
    expect(patchText).toContain("resolve('dsh-tool-hashline/package.json')")
    expect(patchText).not.toContain(repo)
  }, 600_000)
})
