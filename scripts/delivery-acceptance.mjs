/**
 * Real-host delivery acceptance for the operations skills (ticket 08).
 *
 * One run takes the bundle the way a user installs it — packed tarballs, a
 * throwaway DSH_HOME, a profile that has never seen this checkout — then
 * exercises the two workflows through that INSTALLED bundle from a foreign
 * working directory, and finally prints a report keyed by the spec's acceptance
 * IDs (PASS / FAIL / GAP / BLOCKED).
 *
 * Claim boundaries, stated once:
 * - The composition proof is the real launcher (`dsh --profile <p> --dump-config`)
 *   over the packed install; the runtime skill-layer proof mounts the shipped
 *   rows through the real preset registry / loader / skill registry FROM THE
 *   INSTALL, never from this checkout.
 * - The upgrade chain's process runner is INJECTED, so no real dependency
 *   install happens against a candidate tree; every version, marker and digest
 *   it reports is read from real files, and the report says `runner: injected`.
 *   Fixed candidates and a one-off profile are the spec's own acceptance form
 *   (D16 / UPG-13); they are never a daily-upgrade authorization.
 * - Nothing here touches the running host, its profile, another profile or the
 *   official DSH install.
 *
 * This module carries no shebang: the integration spec imports it, and Vite's
 * SSR transform would keep a `#!` line that Node 24 then rejects.
 * @module dsh-tool-hashline/scripts/delivery-acceptance
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The repository this run reads its sources from (never the install under test). */
export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * EVERY acceptance ID the spec defines, in spec order.
 *
 * All of them are listed — not only the ones this run measures. An ID with no row
 * renders as BLOCKED, which is the honest reading: leaving it out of this array
 * would make it invisible instead, and an invisible ID reads as "not applicable".
 * @see docs/specs/2026-10-23-ptc-hashline-operations-skills.md （验收要求）
 */
export const ACCEPTANCE_IDS = [
  'SCOPE-01',
  'SCOPE-02',
  'SCOPE-03',
  'SCOPE-04',
  'SCOPE-05',
  'SCOPE-06',
  'SCOPE-07',
  'PACK-01',
  'INC-01',
  'INC-02',
  'INC-03',
  'INC-04',
  'INC-05',
  'INC-06',
  'INC-07',
  'CONFIG-01',
  'UPG-01',
  'UPG-02',
  'UPG-03',
  'UPG-04',
  'UPG-05',
  'UPG-06',
  'UPG-07',
  'UPG-08',
  'UPG-09',
  'UPG-10',
  'UPG-11',
  'UPG-12',
  'UPG-13',
  'REG-01',
]

/**
 * Why an ID has no row in THIS run.
 *
 * A delivery run measures the assembly, both workflows, and the regression gates.
 * The other acceptance IDs are owned by the source-tree suites (they were closed
 * by tickets 01–07); naming the owner here keeps "no row" from reading as "no
 * evidence anywhere", while still refusing to claim them as this run's result.
 */
export const ID_OWNERS = {
  'INC-02': 'incident 分类与严重度：tests/integration/operations-incidents.spec.ts（票据 02）',
  'INC-03': '成功但结果不对：tests/integration/operations-incidents.spec.ts（票据 02）',
  'INC-04': '日志完整性（torn/seq 缺口/重复）：tests/integration/operations-incidents.spec.ts、tests/integration/extract-runtime-evidence.spec.ts（票据 02）',
  'UPG-02': 'DSH 契约与逐项补丁决策：tests/integration/operations-upgrade-assessment.spec.ts（票据 04）',
  'UPG-05': '版本/目标/基线漂移令旧授权失效：tests/integration/operations-upgrade-proposal-consent.spec.ts、tests/integration/operations-target-switch.spec.ts（票据 05/07）',
  'UPG-08': '官方 DSH 只给人工建议、不修改安装：tests/integration/operations-upgrade-assessment.spec.ts（票据 04）',
  'UPG-09': '方案外改动保留失败、不放宽断言：tests/integration/operations-candidate-validation.spec.ts（票据 06）',
  'UPG-10': '受影响文件有用户改动则停止切换：tests/integration/operations-target-switch.spec.ts（票据 07）',
  'UPG-11': '关键基线 unknown 不切换、不宣告成功：tests/integration/operations-upgrade-assessment.spec.ts 与本轮的 UPG-01 GAP 行（票据 04）',
}

/**
 * The six sections the spec asks a delivery report to separate, each naming the
 * acceptance IDs that carry its evidence. A section whose IDs recorded nothing
 * is reported as unmeasured instead of being dropped, because a missing section
 * reads as "not applicable" while a missing CASE is the fact worth seeing.
 */
export const REPORT_SECTIONS = [
  { title: '技能隔离（打包、装配、入口与调用资格）', ids: ['PACK-01', 'SCOPE-01', 'SCOPE-02', 'SCOPE-03', 'SCOPE-04', 'SCOPE-05', 'SCOPE-06', 'SCOPE-07'] },
  { title: 'incident 可观察性', ids: ['INC-01', 'INC-05', 'INC-06', 'INC-07', 'CONFIG-01'] },
  { title: '升级评估', ids: ['UPG-01'] },
  { title: '同意流程', ids: ['UPG-03', 'UPG-07'] },
  { title: '执行 / 回退', ids: ['UPG-04', 'UPG-06', 'UPG-12', 'UPG-13'] },
  { title: '既有功能回归', ids: ['REG-01'] },
]

/** A run's verdict vocabulary: nothing here is ever inferred from a version number. */
export const STATUS = { pass: 'PASS', fail: 'FAIL', gap: 'GAP', blocked: 'BLOCKED' }

/** The acceptance-only packages the fixture profile installs beside the bundle. */
export const DRIVER_DEPENDENCIES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/dsh-agent-loop-testkit',
  '@deepseek-ai/dsh-agent-preset-registry',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-tools',
  'js-yaml',
]

/** The host bundles a DSH profile boots, at the version this bundle is verified against. */
export const HOST_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless']
export const HOST_VERSION = '0.2.1-rc.2'
/** The four packages this bundle ships. */
export const SHIPPED = [
  { directory: '.', name: 'dsh-tool-hashline' },
  { directory: 'packages/hashline', name: '@dsh-tool-hashline/hashline' },
  { directory: 'packages/tool-read', name: '@dsh-tool-hashline/tool-read' },
  { directory: 'packages/tool-edit', name: '@dsh-tool-hashline/tool-edit' },
]
/** The two delivered skills, in report order. */
export const OPERATIONS_SKILLS = ['ptc-hashline-incident', 'ptc-hashline-upgrade']
export const OPERATIONS_PROVIDER = 'ptc-hashline-operations'

/** A Windows path as a forward-slash path (a `link:`/`file:` specifier needs one). */
export const posix = (value) => value.replaceAll('\\', '/')

/**
 * Run one command and capture everything, never throwing on a non-zero exit.
 * @param {string} command the executable
 * @param {string[]} args its arguments
 * @param {object} [options] cwd, env, timeout
 * @returns {{code: number, stdout: string, stderr: string, signal: string | null}} the outcome
 */
export function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd ?? repo,
      encoding: 'utf8',
      // Windows cannot spawn a `.cmd` shim without a shell; the arguments here are
      // fixed by this module (never user input), so the concatenation is safe.
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env ?? {} },
      timeout: options.timeout ?? 600_000,
      maxBuffer: 32 * 1024 * 1024,
    })
    return { code: 0, stdout, stderr: '', signal: null }
  } catch (error) {
    return {
      code: typeof error?.status === 'number' ? error.status : -1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? '') || String(error?.message ?? ''),
      signal: error?.signal ?? null,
    }
  }
}

/** A fresh temporary directory that the caller removes. */
export async function temp(prefix, roots) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  roots.push(directory)
  return directory
}

/** One JSON file, or a loud failure. */
export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** sha256 of one file's bytes. */
export async function digestOf(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

/** Sorted relative path -> text for every file under one directory (.git excluded). */
export async function snapshot(directory) {
  const entries = []
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      entries.push([path.relative(directory, absolute).split(path.sep).join('/'), await readFile(absolute, 'utf8')])
    }
  }
  if (!existsSync(directory)) return entries
  await walk(directory)
  return entries.sort((left, right) => left[0].localeCompare(right[0]))
}

/**
 * Pack the four shipped packages and install them into a profile that has never
 * seen this checkout.
 *
 * The profile lives under a temporary DSH_HOME with its own store; the installed
 * bundle is reached only through `node_modules`, exactly as a user's install is.
 * @param {string[]} roots temporary directories the caller removes
 * @param {object[]} notes report rows this phase appends to
 * @returns {Promise<object>} the install facts (or a thrown error the caller records)
 */
export async function installBundle(roots, notes) {
  const root = await temp('delivery-', roots)
  const home = path.join(root, 'dsh-home')
  const profile = path.join(home, 'profiles', 'acceptance')
  const packDir = path.join(root, 'pack')
  await mkdir(profile, { recursive: true })
  await mkdir(packDir, { recursive: true })

  // 1) Pack exactly what each manifest ships. A `files` omission cannot be seen
  //    from the source tree; the tarball is the artifact a user installs.
  const tarballs = {}
  for (const entry of SHIPPED) {
    const packed = run('pnpm', ['pack', '--pack-destination', packDir], { cwd: path.join(repo, entry.directory), timeout: 300_000 })
    if (packed.code !== 0) throw new Error('pnpm pack failed for ' + entry.name + ': ' + (packed.stderr + packed.stdout).slice(-600))
    // The tarball name is derived from the manifest, not matched by prefix: the
    // bundle is `dsh-tool-hashline` and one of its packages is
    // `@dsh-tool-hashline/hashline`, so a prefix search would install the wrong
    // archive as the bundle.
    const version = (await readJson(path.join(repo, entry.directory, 'package.json'))).version
    const name = entry.name.replaceAll('@', '').replaceAll('/', '-') + '-' + version + '.tgz'
    if (!existsSync(path.join(packDir, name))) throw new Error('pnpm pack produced no ' + name + ' (saw ' + (await readdir(packDir)).join(', ') + ')')
    tarballs[entry.name] = 'file:' + posix(path.join(packDir, name))
  }
  notes.push({ id: 'PACK-01', part: 'pack', detail: 'packed ' + Object.keys(tarballs).join(', ') + ' （每个包 manifest 的 files 决定装进 tarball 的内容）' })

  // 2) Install them into a fresh profile. The engine packages are named directly
  //    and pinned through the workspace `overrides` map, because their manifests
  //    declare each other by name (a registry lookup for a private package would
  //    be a 404). The host bundles come from the registry at the verified version.
  // The acceptance-only packages are pinned to what THIS repository already
  // declares (the cordis plugins are not on the host version scheme), so the
  // fixture never invents a version the registry does not publish.
  const declared = {
    ...(await readJson(path.join(repo, 'package.json'))).devDependencies,
    ...(await readJson(path.join(repo, 'package.json'))).dependencies,
  }
  const dependencies = {
    ...tarballs,
    ...Object.fromEntries(DRIVER_DEPENDENCIES.map(name => [name, declared[name] ?? HOST_VERSION])),
    '@deepseek-ai/dsh': HOST_VERSION,
    ...Object.fromEntries(HOST_BUNDLES.map(name => [name, HOST_VERSION])),
    '@deepseek-ai/dsh-fs': HOST_VERSION,
    '@deepseek-ai/dsh-fs-local': HOST_VERSION,
    '@deepseek-ai/dsh-fs-observation-policy': HOST_VERSION,
    '@deepseek-ai/dsh-agent': HOST_VERSION,
    '@deepseek-ai/dsh-session': HOST_VERSION,
    '@deepseek-ai/dsh-util-code-language': HOST_VERSION,
    '@deepseek-ai/dsh-working-directory': HOST_VERSION,
  }
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-acceptance',
    private: true,
    dependencies,
    dsh: { profile: { bundles: [...HOST_BUNDLES, 'dsh-tool-hashline'] } },
  }, null, 2) + '\n', 'utf8')
  // The two engine anchors this repository ships against are PATCHED builds, so a
  // profile that installed them unpatched would be testing a different product.
  // The patch files and their registration travel WITH the profile, which is the
  // delivery rule (patches/ + patchedDependencies, never a node_modules edit).
  await cp(path.join(repo, 'patches'), path.join(profile, 'patches'), { recursive: true })
  const patchFiles = (await readdir(path.join(profile, 'patches'))).filter((name) => name.endsWith('.patch'))
  if (patchFiles.length === 0) throw new Error('this repository ships no patches/, so the acceptance profile would install unpatched engines')
  const registrations = patchFiles.map((name) => {
    const match = /^(.+)@([^@]+)\.patch$/u.exec(name)
    if (match === null) throw new Error('a shipped patch file is not named <package>@<version>.patch: ' + name)
    return '  ' + JSON.stringify(match[1].replaceAll('__', '/') + '@' + match[2]) + ': patches/' + name
  })
  await writeFile(path.join(profile, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    // The host packages declare their peers (dsh-home-paths, the cordis plugins)
    // instead of depending on them, so an acceptance profile resolves them.
    'autoInstallPeers: true',
    'strictDepBuilds: false',
    'ignoredBuiltDependencies:',
    '  - koffi',
    '  - esbuild',
    '',
    'patchedDependencies:',
    ...registrations,
    '',
    'overrides:',
    ...SHIPPED.filter(entry => entry.directory !== '.').map(entry => '  ' + JSON.stringify(entry.name) + ': ' + JSON.stringify(tarballs[entry.name])),
    '',
  ].join('\n'), 'utf8')
  await writeFile(path.join(profile, 'cordis.patch.yml'), '[]\n', 'utf8')

  const installed = run('pnpm', ['install'], { cwd: profile, timeout: 900_000 })
  if (installed.code !== 0) throw new Error('pnpm install in the acceptance profile failed: ' + (installed.stderr + installed.stdout).slice(-1600))
  notes.push({ id: 'PACK-01', part: 'install', detail: 'installed into ' + profile })

  // 3) Resolve from that install only. Nothing below may reach this checkout.
  const bundleManifestPath = path.join(profile, 'node_modules', 'dsh-tool-hashline', 'package.json')
  if (!existsSync(bundleManifestPath)) throw new Error('the installed profile does not carry the bundle manifest')
  const bundleRoot = realpathSync(path.dirname(bundleManifestPath))
  // A `link:` install would satisfy every assertion below while still loading
  // this checkout's own files, which is exactly the independence PACK-01 claims.
  // The delivered artifact must be a real copy inside the profile.
  if (lstatSync(path.dirname(bundleManifestPath)).isSymbolicLink()) {
    throw new Error('the installed bundle is a symlink back to its source (' + bundleRoot + '), so this run would not prove a detached install')
  }
  if (bundleRoot.startsWith(repo + path.sep) || bundleRoot === repo) {
    throw new Error('the installed bundle resolves inside this checkout (' + bundleRoot + '), so nothing here measured a detached install')
  }
  const manifest = await readJson(bundleManifestPath)
  const patchRelative = manifest?.dsh?.bundle?.patch
  if (patchRelative !== './presets/ptc-hashline/preset.patch.yml') throw new Error('the installed bundle does not declare the preset patch')
  const resolveOrThrow = (subpath) => {
    const file = path.join(bundleRoot, subpath)
    if (!existsSync(file)) throw new Error('the installed bundle does not carry ' + subpath)
    return file
  }
  const facts = {
    root,
    home,
    profile,
    bundleRoot,
    dshBin: path.join(profile, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    presetPatch: resolveOrThrow('presets/ptc-hashline/preset.patch.yml'),
    persona: resolveOrThrow('presets/ptc-hashline/personas/orchestrator.md'),
    watchdog: resolveOrThrow('presets/ptc-hashline/intent-gate-watchdog.mjs'),
    operationsEntry: resolveOrThrow('presets/ptc-hashline/operations/cli.mjs'),
    skillsDir: path.join(bundleRoot, 'presets', 'ptc-hashline', 'skills'),
  }
  // The references/manual-asset slice of PACK-01: every module the skills name.
  for (const name of ['cli.mjs', 'context.mjs', 'config.mjs', 'baseline.mjs', 'session-log.mjs', 'incidents.mjs', 'proposals.mjs', 'candidates.mjs', 'switch.mjs', 'upgrades.mjs', 'text.mjs']) {
    resolveOrThrow('presets/ptc-hashline/operations/' + name)
  }
  for (const skill of OPERATIONS_SKILLS) {
    const body = path.join(facts.skillsDir, skill, 'SKILL.md')
    if (!existsSync(body)) throw new Error('the installed bundle does not carry ' + skill)
  }
  if (!existsSync(facts.dshBin)) throw new Error('the acceptance profile does not carry the DSH launcher')

  // No personal absolute path may survive the delivery. Every shipped artifact is
  // scanned — not just the patch and the operations modules — because a skill body
  // is exactly what names the operations entry, and a persona or the watchdog could
  // just as easily carry a machine-specific path.
  const leaked = []
  const scanTree = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await scanTree(absolute)
        continue
      }
      const body = await readFile(absolute, 'utf8')
      if (body.includes(repo) || body.includes(posix(repo))) leaked.push(path.relative(bundleRoot, absolute))
    }
  }
  for (const shipped of ['presets/ptc-hashline/preset.patch.yml', 'presets/ptc-hashline/personas', 'presets/ptc-hashline/skills', 'presets/ptc-hashline/operations', 'presets/ptc-hashline/intent-gate-watchdog.mjs']) {
    const target = path.join(bundleRoot, shipped)
    if (!existsSync(target)) throw new Error('the installed bundle does not carry ' + shipped)
    if ((await stat(target)).isDirectory()) await scanTree(target)
    else {
      const body = await readFile(target, 'utf8')
      if (body.includes(repo) || body.includes(posix(repo))) leaked.push(shipped)
    }
  }
  if (leaked.length > 0) throw new Error('the installed bundle still names this checkout: ' + leaked.join(', '))
  // The two engine anchors must be the PATCHED builds: an unpatched engine under
  // the same version number is exactly what "version equality is no evidence"
  // forbids reading as delivered.
  const require_ = createRequire(path.join(profile, 'package.json'))
  const markerOf = async (specifier, file, marker) => {
    const manifest = realpathSync(require_.resolve(specifier + '/package.json'))
    const body = await readFile(path.join(path.dirname(manifest), file), 'utf8')
    return body.includes(marker)
  }
  const patched = {
    hashline: await markerOf('@hy-sde-org/dsh-hashline', 'dist/patcher.js', 'authorizes the snapshot migration'),
    toolEdit: await markerOf('@hy-sde-org/dsh-tool-edit', 'dist/session.js', 'async readTextPreservingBom(target, signal)'),
  }
  if (!patched.hashline || !patched.toolEdit) {
    throw new Error('the acceptance profile installed an UNPATCHED engine (hashline=' + patched.hashline + ', tool-edit=' + patched.toolEdit + '), so its build is not the one this repository ships')
  }
  notes.push({ id: 'PACK-01', part: 'engine-patches', detail: 'both anchors installed from patches/ + patchedDependencies and carry their marker (hashline=' + patched.hashline + ', tool-edit=' + patched.toolEdit + ')' })
  notes.push({ id: 'PACK-01', part: 'resolve', detail: 'bundle root ' + bundleRoot + '; no checkout path in any shipped artifact (patch, personas, skills, operations, watchdog)' })
  return facts
}

/**
 * Compose the installed profile with the REAL launcher and read the result.
 * @param {object} facts the install facts
 * @param {object[]} notes report rows this phase appends to
 * @returns {Promise<string>} the composed config dump
 */
export async function composeProfile(facts, notes) {
  const composed = run(process.execPath, [facts.dshBin, '--profile', 'acceptance', '--dump-config'], {
    cwd: facts.profile,
    env: { DSH_HOME: facts.home },
    timeout: 300_000,
  })
  if (composed.code !== 0) throw new Error('the real launcher could not compose the profile: ' + (composed.stderr || composed.stdout).slice(-1200))
  const dump = composed.stdout
  const required = [
    ['ptc-hashline-preset', 'ptc-hashline'],
    ['ptc-hashline name', 'PTC Hashline Mode'],
    ['tool-read', '@dsh-tool-hashline/tool-read'],
    ['tool-edit', '@dsh-tool-hashline/tool-edit'],
    ['operations provider', OPERATIONS_PROVIDER],
    ['watchdog', 'intent-gate-watchdog'],
  ]
  for (const [label, needle] of required) {
    if (!dump.includes(needle)) throw new Error('the composed profile is missing ' + label + ' (' + needle + ')')
  }
  for (const retired of ['ptc-gate']) {
    if (dump.includes(retired)) throw new Error('the composed profile still references the retired ' + retired + ' preset')
  }
  const personalised = dump.includes(posix(repo))
  if (personalised) throw new Error('the composed profile leaks this checkout\'s path')
  notes.push({ id: 'PACK-01', part: 'compose', detail: 'dsh --profile acceptance --dump-config exit 0; preset, read/edit, operations provider and watchdog present; no checkout path' })
  return dump
}

/**
 * The runtime skill-layer proof, driven INSIDE the installed profile.
 *
 * A separate child process runs with its cwd inside the profile, so every import
 * it makes resolves through the profile's own `node_modules`: the real preset
 * registry, the real Cordis loader, the real skill registry and the real
 * filesystem provider, mounted from the INSTALLED `preset.patch.yml`. Nothing in
 * this driver reads this checkout — that is the difference between this case and
 * the source-tree suites.
 */
/** The driver source, exported so a test can pin its mount order against the source harness. */
export const SKILL_LAYER_DRIVER = `import { readFileSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Group from '@deepseek-ai/cordis-plugin-group'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SkillRegistry, { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'

const skillsDir = process.argv[2]
const bundleRoot = process.argv[3]
const presetPath = process.argv[4]
const result = { dirs: [], rows: 0, presence: {}, modelToolRefusal: null, otherPreset: null, remount: null, duplicateRejected: null, survivesAgentDispose: null, generalProvider: null, bodyPaths: {} }

const text = readFileSync(presetPath, 'utf8')
const documents = yaml.load(text, { schema: entryListSchema })
const entries = documents.flatMap(document => Array.isArray(document?.insert) ? document.insert : [])
const preset = entries.find(entry => entry?.config?.id === 'ptc-hashline')
if (preset === undefined) throw new Error('the installed preset patch declares no ptc-hashline preset')
const rows = preset.config.plugins
result.rows = rows.length
const byId = new Map()
const walk = list => { for (const row of list) { if (typeof row.id === 'string') byId.set(row.id, row); if (Array.isArray(row.config)) walk(row.config) } }
walk(rows)
const SKILL_ROWS = ['skill-filesystem', 'tool-skill', 'ptc-hashline-operations-skills']
const skillRows = SKILL_ROWS.map(id => {
  const row = byId.get(id)
  if (row === undefined) throw new Error('the installed preset declares no row ' + id)
  return row
})
// The operations provider root must resolve through the INSTALL, from any cwd.
const operationsRow = byId.get('ptc-hashline-operations-skills')
const expression = operationsRow?.config?.customSkillDirs?.[0]?.__jsExpr
if (typeof expression !== 'string') throw new Error('the installed operations row does not carry a loader expression')
const baseUrl = pathToFileURL(path.join(path.dirname(presetPath)) + path.sep).href
const evaluated = new Function('baseUrl', 'return (' + expression + ')')(baseUrl)
if (path.resolve(evaluated) !== path.resolve(skillsDir)) throw new Error('the installed row resolves ' + evaluated + ', not ' + skillsDir)
result.presence.skillRoot = evaluated
result.presence.skillRootStartsWithInstall = path.resolve(evaluated).startsWith(path.resolve(bundleRoot))

const workspace = mkdtempSync(path.join(tmpdir(), 'delivery-skills-'))
result.dirs.push(workspace)

async function host() {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(path.join(path.dirname(presetPath)) + path.sep).href
  await ctx.plugin(Loader)
  ctx.loader.builtins.group = Group
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '', includeRuntimeContext: false, includeHarnessIdentity: false })
  const runtime = new ToolRuntime(ctx)
  await ctx.plugin(AgentPresets, { default: 'ptc-hashline' })
  provideWorkingDirectoryFixture(ctx, workspace)
  ctx.provide('agents', { list: () => [] })
  return { ctx, runtime }
}

async function mount(ctx, id, selectedRows) {
  const unregister = await ctx.agentPresets.register({ id, plugins: selectedRows })
  const lease = await ctx.agentPresets.acquireScope(id)
  const agents = []
  const create = async agentId => {
    const session = { id: agentId, cwd: workspace, header: { cwd: workspace, id: agentId }, append: () => 0 }
    const agent = { id: agentId, session }
    const scope = createScope(ctx, agent)
    agent.ctx = scope.ctx
    agent.dispose = () => scope.dispose()
    await ctx.agentPresets.mount(agent.ctx, id)
    agents.push(agent)
    return agent
  }
  return {
    id,
    create,
    async unregister() { await unregister(); await lease[Symbol.asyncDispose]() },
    async cleanup() { for (const agent of agents.splice(0)) await agent.dispose() },
  }
}

const lookup = agent => ({ cwd: workspace, scope: agent })
const OPERATIONS = ['ptc-hashline-incident', 'ptc-hashline-upgrade']

// SCOPE-01: both skills are listed for the preset agent, loadable, user-invocable,
// model-invisible, and their loaded body carries a resource base inside the install.
{
  const { ctx, runtime } = await host()
  const mounted = await mount(ctx, 'ptc-hashline', skillRows)
  const agent = await mounted.create('delivery-scope-01')
  const catalog = await ctx.skills.list(lookup(agent))
  const names = catalog.map(skill => skill.name)
  for (const name of OPERATIONS) {
    const summary = catalog.find(skill => skill.name === name)
    result.presence[name] = {
      listed: names.includes(name),
      provider: summary?.provider ?? null,
      userInvocable: summary === undefined ? null : isUserInvocable(summary),
      modelInvocable: summary === undefined ? null : isModelInvocable(summary),
    }
    const loaded = await ctx.skills.get(name, lookup(agent))
    result.bodyPaths[name] = loaded?.resourceBase?.kind === 'directory' ? loaded.resourceBase.path : null
    result.presence[name].bodyLength = loaded?.content?.length ?? 0
  }
  result.generalProvider = catalog.some(skill => skill.provider === 'filesystem')
  // SCOPE-07: the real model-facing skill tool must refuse, with the policy's
  // exact message — a generic "unknown skill" would pass for a missing row.
  const rejected = await runtime.execute({
    callId: 'delivery-model-skill',
    name: 'skill',
    arguments: { name: OPERATIONS[0] },
    signal: new AbortController().signal,
    agent,
  })
  result.modelToolRefusal = {
    toolVisible: runtime.get('skill', agent) !== undefined,
    isError: rejected.isError === true,
    message: String(rejected.error?.message ?? ''),
  }
  // SCOPE-03 (不重复注册): a SECOND provider with the same name in ONE revision must
  // be rejected. This is the only shape that can falsify the claim: a fresh preset
  // id would let "already registered" never fire, so it would prove nothing.
  // The collision surfaces at MOUNT (that is when the row's plugin activates and
  // the provider registers into the revision's layer), so this drives the same
  // path a real preset takes — not register alone, which would never throw.
  const duplicated = [...skillRows, { ...byId.get('ptc-hashline-operations-skills'), id: 'ptc-hashline-operations-skills-again' }]
  result.duplicateRejected = await mount(ctx, 'ptc-hashline-duplicate', duplicated)
    .then(async (extra) => { await extra.cleanup().catch(() => undefined); return { rejected: false, message: '' } })
    .catch((error) => ({ rejected: true, message: String(error?.message ?? error).slice(0, 200) }))
  // SCOPE-03 (不串层): one agent's scope must not own the provider — disposing it
  // leaves the revision's provider serving the next agent on that revision.
  await agent.dispose()
  const sibling = await mounted.create('delivery-scope-03-sibling')
  result.survivesAgentDispose = (await ctx.skills.list(lookup(sibling))).filter(skill => skill.provider === 'ptc-hashline-operations').map(skill => skill.name).sort()
  // SCOPE-03 (不残留): retiring the definition and releasing the revision removes it,
  // and a NEW revision can register the same provider name again — which is only
  // possible if nothing leaked.
  await sibling.dispose()
  await mounted.unregister()
  const again = await mount(ctx, 'ptc-hashline-remount', skillRows)
  const second = await again.create('delivery-scope-03-remount')
  result.remount = (await ctx.skills.list(lookup(second))).filter(skill => skill.provider === 'ptc-hashline-operations').map(skill => skill.name).sort()
  await again.cleanup()
  await ctx.fiber.dispose()
}

// SCOPE-02: a DIFFERENT preset, as a genuinely separate row list — not "the target
// preset minus one row", which would let the fixture write the expected value.
// The ids come from a preset that never declared the operations provider.
{
  const { ctx } = await host()
  // The row list is stated LITERALLY for this preset: the general filesystem
  // provider and the model-facing tool, and nothing else. Deriving it by removing
  // the operations row from the target's list would let the fixture write the
  // answer this case reads back.
  const standardRows = skillRows.filter(row => row.id === 'skill-filesystem' || row.id === 'tool-skill')
  const mounted = await mount(ctx, 'standard', standardRows)
  const agent = await mounted.create('delivery-scope-02')
  const hostCatalog = await ctx.skills.list(lookup(agent))
  result.otherPreset = {
    names: hostCatalog.map(skill => skill.name),
    generalProvider: hostCatalog.some(skill => skill.provider === 'filesystem'),
    loadable: await Promise.all(OPERATIONS.map(async name => (await ctx.skills.get(name, lookup(agent))) !== undefined)),
    declaredRows: ['skill-filesystem', 'tool-skill'],
  }
  await mounted.cleanup()
  await ctx.fiber.dispose()
}

// SCOPE-01/03: the delivered skills are exactly the two directories, and each
// skill body names the operations entry through its own resource base.
const shipped = readdirSync(skillsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
result.presence.shippedSkills = shipped
result.presence.bodyCommands = Object.fromEntries(OPERATIONS.map(name => [name, readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8').split('operations/cli.mjs ').length - 1]))
console.log(JSON.stringify(result))
`;
/**
 * Run the shipped skill-layer driver inside the installed profile.
 *
 * The driver is written NEXT TO the profile and executed with the profile's own
 * `node_modules` as its resolution root, so every import it makes is the
 * installed host, never this checkout.
 * @param {object} facts the install facts
 * @returns {Promise<object>} the driver's structured result
 */
export async function runSkillLayer(facts) {
  const driverPath = path.join(facts.profile, 'delivery-skill-layer.mjs')
  await writeFile(driverPath, SKILL_LAYER_DRIVER, 'utf8')
  const outcome = run(process.execPath, [driverPath, facts.skillsDir, facts.bundleRoot, facts.presetPatch], {
    cwd: facts.profile,
    env: { DSH_HOME: facts.home },
    timeout: 300_000,
  })
  if (outcome.code !== 0) throw new Error('the installed skill-layer driver failed: ' + (outcome.stderr || outcome.stdout).slice(-1600))
  const line = outcome.stdout.trim().split('\n').filter(Boolean).at(-1)
  return JSON.parse(line)
}

/**
 * Turn the driver's facts into acceptance rows (SCOPE-01/02/03/07).
 * @param {object} layer the driver result
 * @param {(id: string, part: string, ok: boolean, detail: string) => void} record row writer
 * @returns {void}
 */
export function recordSkillLayerRows(layer, record) {
  const presence = layer.presence
  const both = OPERATIONS_SKILLS.every((name) => presence[name]?.listed === true)
  const bornInstalled = OPERATIONS_SKILLS.every((name) => (layer.bodyPaths[name] ?? '').startsWith(layer.presence.skillRoot))
  // The row set the driver actually mounted is the INSTALLED preset's own list, so
  // the number of rows is evidence that the full shipped row list was read.
  record('SCOPE-01', 'the installed preset row list is what the driver mounts', (layer.rows ?? 0) > 10
    && presence.skillRootStartsWithInstall === true,
  'the installed preset declares ' + String(layer.rows) + ' rows; the operations skill root resolves inside the install: ' + String(presence.skillRootStartsWithInstall))
  record('SCOPE-01', 'the shipped skill bodies still name the operations entry', OPERATIONS_SKILLS.every((name) => (presence.bodyCommands?.[name] ?? 0) > 0),
  'operations/cli.mjs mentions per body: ' + JSON.stringify(presence.bodyCommands))
  record('SCOPE-01', 'the installed preset lists both skills for its own agent', both
    && OPERATIONS_SKILLS.every((name) => presence[name]?.provider === OPERATIONS_PROVIDER),
  'catalog entries ' + JSON.stringify(OPERATIONS_SKILLS.map((name) => name + '@' + String(presence[name]?.provider))))
  record('SCOPE-01', 'each body loads with a resource base inside the install', bornInstalled
    && OPERATIONS_SKILLS.every((name) => (presence[name]?.bodyLength ?? 0) > 0),
  'body paths ' + JSON.stringify(layer.bodyPaths) + '; root ' + String(presence.skillRoot))
  record('SCOPE-01', 'the general skill provider still works beside the operations one', layer.generalProvider === true,
    'a `filesystem` provider entry is present in the same catalog')
  record('SCOPE-01', 'the installed bundle ships exactly the two delivered skills', JSON.stringify(presence.shippedSkills) === JSON.stringify([...OPERATIONS_SKILLS].sort()),
    'shipped ' + JSON.stringify(presence.shippedSkills))
  record('SCOPE-07', 'the model-facing skill tool refuses, and the user path still resolves', layer.modelToolRefusal?.toolVisible === true
    && layer.modelToolRefusal?.isError === true
    && layer.modelToolRefusal?.message === 'skill "' + OPERATIONS_SKILLS[0] + '" is not available for model invocation'
    && OPERATIONS_SKILLS.every((name) => presence[name]?.modelInvocable === false && presence[name]?.userInvocable === true),
  'skill tool refusal ' + JSON.stringify(layer.modelToolRefusal?.message) + '; user-invocable ' + JSON.stringify(OPERATIONS_SKILLS.map((name) => presence[name]?.userInvocable)))
  record('SCOPE-02', 'a preset that never declared the provider cannot see or load them', layer.otherPreset !== null
    && JSON.stringify(layer.otherPreset.declaredRows) === JSON.stringify(['skill-filesystem', 'tool-skill'])
    && OPERATIONS_SKILLS.every((name) => layer.otherPreset.names.includes(name) === false)
    && layer.otherPreset.loadable.every((value) => value === false)
    && layer.otherPreset.generalProvider === true,
  'other preset declared rows ' + JSON.stringify(layer.otherPreset?.declaredRows) + '; catalog ' + String(layer.otherPreset?.names?.length ?? 0)
    + ' entries, operations loadable ' + JSON.stringify(layer.otherPreset?.loadable) + ', general provider ' + String(layer.otherPreset?.generalProvider))
  // SCOPE-03 is three claims, and each has a shape that could falsify it.
  record('SCOPE-03', 'a second provider with the same name in ONE revision is rejected', layer.duplicateRejected?.rejected === true
    && String(layer.duplicateRejected?.message ?? '').includes('already registered'),
  'duplicate registration: ' + JSON.stringify(layer.duplicateRejected))
  record('SCOPE-03', 'one agent scope does not own the provider', JSON.stringify(layer.survivesAgentDispose) === JSON.stringify([...OPERATIONS_SKILLS].sort()),
  'after disposing the first agent the revision still lists ' + JSON.stringify(layer.survivesAgentDispose))
  record('SCOPE-03', 'a retired revision leaves nothing behind, so the name is reusable', JSON.stringify(layer.remount) === JSON.stringify([...OPERATIONS_SKILLS].sort()),
  'after unregister + release, a new revision lists ' + JSON.stringify(layer.remount))
}

/**
 * The versions this machine actually resolves, read from the installed profile.
 * @param {object} facts the install facts
 * @returns {Promise<{hashline: string, toolEdit: string, dsh: string}>} the versions
 */
export async function resolveVersions(facts) {
  const require_ = createRequire(path.join(facts.profile, 'package.json'))
  const read = (specifier) => {
    try {
      // `resolve`, not `require`: requiring a .json subpath returns the parsed
      // object, and the physical path is what the baseline reports.
      const manifest = require_.resolve(specifier + '/package.json')
      return JSON.parse(readFileSync(manifest, 'utf8')).version
    } catch {
      return 'unknown'
    }
  }
  return {
    hashline: read('@hy-sde-org/dsh-hashline'),
    toolEdit: read('@hy-sde-org/dsh-tool-edit'),
    dsh: read('@deepseek-ai/dsh'),
  }
}

/**
 * One maintenance worktree and one one-off target profile for the workflows.
 * @param {string} home the fixture DSH home
 * @param {{hashline: string, toolEdit: string}} versions the resolved engine pair
 * @returns {Promise<string>} the target profile directory
 */
export async function prepareTarget(home, versions) {
  const workflows = await import('./delivery-acceptance-workflows.mjs')
  const repository = path.join(home, 'maintenance')
  await mkdir(repository, { recursive: true })
  await workflows.writeMaintenanceRepository(repository, versions)
  return await workflows.writeTargetProfile(home, repository)
}