/**
 * PTC 与上游能力同步检查（票据 01：本机来源闭环）。
 *
 * 一个手动检查入口：读配置、取来源身份、比较、出报告。模块只用 Node 内建
 * 模块，因此可以从任何工作目录运行，不需要 checkout 里的依赖。
 *
 * 本切片交付：来源选择与身份、本项目基线、覆盖清单、可读报告与结构化记录。
 * PTC、stock read 与引擎发布比较由后续切片补上；没有比较器的区域在覆盖清单里
 * 保持 not-covered，因此报告永远不会把「还没比较」写成「已同步」。
 *
 * 证据边界（写进报告本身）：静态摘要只证明内容变化。版本号相同、文件相同、
 * 补丁标记存在，都不构成语义兼容的结论。
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { collectBaseline, readRepositoryState } from './baseline.mjs'
import { describeConfig, saveConfig, stateDirectory } from './config.mjs'
import { hashOf, stableJson } from './sync-hash.mjs'
import { ENGINES_COMPARATOR, normalizeReleaseSources } from './sync-engines.mjs'
import { captureRunner } from './sync-run.mjs'
import { compareWithHistory, DECISIONS_FILE, readDecisions, readPreviousRound, renderHistorySection } from './sync-history.mjs'
import { PTC_COMPARATOR } from './sync-ptc.mjs'
import { STOCK_READ_COMPARATOR } from './sync-read.mjs'

/** The structured record's own identity; a reader keys on it, not on the file name. */
export const SYNC_TOOL = 'ptc-hashline-operations-sync'

/** The structured record's format version. Bumped when a field changes meaning. */
export const SYNC_VERSION = 1

/** The human-readable report header, so an old file is recognisable as its own round. */
export const REPORT_FORMAT = 'ptc-hashline-upstream-sync/1'

/** Exit codes: 0 complete, 2 stopped or incomplete (written), 3 usage refusal. */
export const SYNC_EXIT = { ok: 0, incomplete: 2, refused: 3 }

/** Comparison areas, in report order. */
export const AREA_IDS = ['source', 'ptc', 'stock-read', 'engines']

/** Human labels per area. */
export const AREA_LABELS = {
  source: '本机来源身份与本项目基线',
  ptc: 'PTC 工具组成、配置、提示及相关契约',
  'stock-read': 'stock read 参数、返回值、截断、大文件与错误处理',
  engines: 'hashline / tool-edit 已发布候选与补丁影响',
}

/** Which ticket delivers each area's comparator. */
export const AREA_TICKETS = { source: '01', ptc: '02', 'stock-read': '03', engines: '04' }

/** The four dispositions a difference may carry. */
export const DISPOSITIONS = ['follow-up', 'keep', 'pending-analysis', 'not-applicable']

/** Source layers in priority order: the first one PRESENT wins, and an unusable one never falls through. */
export const SOURCE_LAYERS = ['explicit', 'environment', 'config']

/** The machine-local configuration namespace this feature owns (config.json -> "sync"). */
export const SETTINGS_NAMESPACE = 'sync'

/**
 * The files whose content is part of THIS slice's identity record.
 *
 * A missing path is reported as missing, never as unchanged: a comparator that
 * added or moved a file must not read as "nothing to compare".
 */
export const DEFAULT_RELEVANT_INPUTS = [
  'packages/bundle/web-app/presets/ptc.patch.yml',
  'packages/fs/tool-fs/src/index.ts',
  'packages/fs/tool-fs/src/read.ts',
  'packages/fs/tool-fs/src/read-render.ts',
  'packages/fs/tool-fs/src/read-target.ts',
  'packages/fs/tool-fs/src/error.ts',
]

/** The specifiers whose declared, locked and installed identity the baseline reports. */
export const WATCHED_SPECIFIERS = [
  '@hy-sde-org/dsh-hashline',
  '@hy-sde-org/dsh-tool-edit',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/cordis',
]

/** The engine anchors this project pins by exact version. */
const ENGINE_ANCHORS = [
  ['hashline', 'packages/hashline/package.json', '@hy-sde-org/dsh-hashline'],
  ['toolEdit', 'packages/tool-edit/package.json', '@hy-sde-org/dsh-tool-edit'],
]

/**
 * The comparators this build ships.
 *
 * An area WITHOUT a comparator stays not-covered in the report. This array is
 * therefore the single place a coverage claim is upgraded, which is what keeps
 * a ticket from silently reading as delivered.
 */
const COMPARATORS = [PTC_COMPARATOR, STOCK_READ_COMPARATOR, ENGINES_COMPARATOR]

/**
 * The comparator registered for one area, if this build ships one.
 * @param {string} area the area id
 * @returns {{area: string, version: number, compare: Function} | undefined} the comparator
 */
export function comparatorFor(area) {
  return COMPARATORS.find((entry) => entry.area === area)
}

// The identities live in their own module (sync-hash.mjs) so a comparator can
// share them without importing this module back; they are re-exported here
// because the record and the callers have always taken them from this surface.
export { hashOf, stableJson }

/**
 * The machine-local settings this feature reads from the operations config store.
 * @param {{values?: Record<string, unknown>}} described a describeConfig result
 * @returns {{dshCheckout?: string}} the settings
 */
export function settingsOf(described) {
  const raw = described?.values?.[SETTINGS_NAMESPACE]
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const checkout = typeof raw.dshCheckout === 'string' && raw.dshCheckout.trim() !== '' ? raw.dshCheckout : undefined
  return checkout === undefined ? {} : { dshCheckout: checkout }
}

/**
 * Save the machine-local DSH source path, or refuse.
 *
 * The path is only stored: whether it is usable is answered by the next check,
 * so a temporarily unavailable directory is reported rather than silently
 * replaced. A relative path is refused because it would silently mean whatever
 * directory the maintainer happened to be in.
 * @param {{directory: string, dshCheckout: string}} options the assignment
 * @returns {Promise<object>} the described configuration afterwards
 * @throws {Error} when the path is not absolute
 */
export async function saveDshCheckout(options) {
  const value = options.dshCheckout
  if (typeof value !== 'string' || value.trim() === '') throw new Error('dshCheckout must be a non-empty path')
  if (!isAbsolute(value)) {
    throw new Error('dshCheckout must be an absolute path (got ' + JSON.stringify(value) + '); a relative path would silently mean the current directory')
  }
  return await saveConfig({ directory: options.directory, dshCheckout: value })
}

/**
 * Probe one named candidate path.
 *
 * Nothing here scans a disk or guesses a sibling: the maintainer names a path and
 * this reports exactly what that path is. A link is RESOLVED and both ends are
 * kept, because "which directory did I actually check" is the question the
 * report has to answer.
 * @param {string} raw the named path
 * @param {string} origin which layer named it
 * @returns {object} the probe result with a status
 */
export function probeCheckoutPath(raw, origin) {
  const base = { origin, inputPath: raw, layer: origin }
  if (!isAbsolute(raw)) {
    return { ...base, status: 'not-absolute', reason: 'the ' + origin + ' source must be an absolute path (got ' + JSON.stringify(raw) + '); a relative path would silently mean the current directory' }
  }
  const named = resolve(raw)
  let link
  try {
    link = lstatSync(named)
  } catch (error) {
    return { ...base, inputPath: named, status: 'missing-path', reason: 'the ' + origin + ' source does not exist: ' + named + ' (' + String(error?.code ?? error) + ')' }
  }
  let resolvedPath
  try {
    resolvedPath = realpathSync(named)
  } catch (error) {
    // A link whose target is gone is its own state: the path "exists" as a link
    // while reading through it fails, and that must not become a silent skip.
    return {
      ...base,
      inputPath: named,
      status: link.isSymbolicLink() ? 'broken-link' : 'unreadable',
      reason: 'the ' + origin + ' source cannot be resolved to a directory: ' + named + ' (' + String(error?.code ?? error) + ')'
        + (link.isSymbolicLink() ? '; the link target is missing — fix the link yourself, this check never creates or repairs one' : ''),
    }
  }
  let info
  try {
    info = statSync(resolvedPath)
  } catch (error) {
    return { ...base, inputPath: named, resolvedPath, status: 'unreadable', reason: 'the ' + origin + ' source cannot be stat-ed: ' + resolvedPath + ' (' + String(error?.code ?? error) + ')' }
  }
  if (!info.isDirectory()) {
    return { ...base, inputPath: named, resolvedPath, status: 'not-a-directory', reason: 'the ' + origin + ' source is not a directory: ' + resolvedPath }
  }
  const manifestPath = join(resolvedPath, 'package.json')
  if (!existsSync(manifestPath)) {
    return { ...base, inputPath: named, resolvedPath, status: 'not-a-dsh-checkout', reason: 'the ' + origin + ' source has no package.json at ' + manifestPath + ': name a DSH source tree, not any directory' }
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { ...base, inputPath: named, resolvedPath, status: 'not-a-dsh-checkout', reason: 'the ' + origin + ' source manifest is not valid JSON: ' + manifestPath + ' (' + (error instanceof Error ? error.message : String(error)) + ')' }
  }
  const name = typeof manifest?.name === 'string' ? manifest.name : ''
  if (!name.startsWith('@deepseek-ai/dsh')) {
    return { ...base, inputPath: named, resolvedPath, status: 'not-a-dsh-checkout', reason: 'the ' + origin + ' source manifest names ' + JSON.stringify(name) + '; expected an @deepseek-ai/dsh* package (DSH root), so this is not a DSH source tree' }
  }
  return {
    status: 'usable',
    origin,
    layer: origin,
    inputPath: named,
    resolvedPath,
    // A maintainer-maintained link is a supported input, not an anomaly: both
    // ends are recorded so the report says which directory was really read.
    link: relative(resolvedPath, named) !== '',
    declaration: {
      name,
      version: typeof manifest.version === 'string' ? manifest.version : 'unknown',
      packageManager: typeof manifest.packageManager === 'string' ? manifest.packageManager : 'unknown',
    },
  }
}

/**
 * Resolve the DSH source by the documented priority.
 *
 * The first PRESENT layer decides: if it is unusable the answer names it and
 * stops, because silently checking a different tree than the one asked for is
 * exactly the failure this ordering exists to prevent.
 * @param {{explicit?: string, environment?: string, configured?: string}} options the named layers
 * @returns {object} the resolution: resolved, or a named reason and every attempt
 */
export function resolveDshSource(options = {}) {
  const attempts = []
  for (const layer of SOURCE_LAYERS) {
    const raw = layer === 'explicit' ? options.explicit
      : layer === 'environment' ? options.environment
        : options.configured
    if (typeof raw !== 'string' || raw.trim() === '') {
      attempts.push({ layer, status: 'absent', reason: 'not provided by ' + layer })
      continue
    }
    const probe = probeCheckoutPath(raw, layer)
    attempts.push(probe)
    if (probe.status !== 'usable') {
      return {
        status: probe.status,
        origin: layer,
        attempts,
        reason: probe.reason,
        next: layer === 'config'
          ? 'save a usable path once with: node presets/ptc-hashline/operations/cli.mjs config --set-dsh-checkout <absolute path>'
          : 'fix the named path, or drop it and let the next layer decide; this check never falls through to another source on its own',
      }
    }
    // The spread comes FIRST: the probe's own status ('usable') must not win
    // over the resolution's, or a resolved source would read as a refusal.
    return { ...probe, status: 'resolved', origin: layer, attempts }
  }
  return {
    status: 'missing',
    origin: null,
    attempts,
    reason: 'no DSH source was provided by any layer (explicit --checkout, DSH_CHECKOUT, machine-local configuration); this check does not scan the disk for one',
    next: 'run with --checkout <absolute path>, or save it once with --set-checkout <absolute path>',
  }
}

// The runner lives in sync-run.mjs (the engine comparator needs it too); it is
// re-exported here because this module's public surface has always carried it.
export { captureRunner } from './sync-run.mjs'

/**
 * Read one checkout's VCS facts.
 * @param {string} directory the resolved checkout directory
 * @param {{execFileSync?: Function}} [deps] injectable runner (tests pass a stub)
 * @returns {object} commit, dirty state and the changed paths
 */
export function readCheckoutVcs(directory, deps = {}) {
  const runner = deps.execFileSync ?? captureRunner
  const git = (args) => String(runner('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  try {
    const commit = git(['rev-parse', 'HEAD']).trim()
    // Porcelain is the only dirty signal that covers staged, unstaged AND
    // untracked content; equal HEADs cannot prove a file did not change.
    const status = git(['status', '--porcelain=v1'])
    const changedPaths = status.split('\n').filter((line) => line.trim() !== '').map((line) => line.slice(3).trim().replaceAll('\\', '/'))
    return { commit, dirty: changedPaths.length === 0 ? 'clean' : 'dirty', changedPaths }
  } catch (error) {
    return { commit: 'unknown', dirty: 'unknown', changedPaths: [], detail: 'git could not read this directory: ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * Digest one file's bytes, or say why it could not be read.
 * @param {string} absolute the file path
 * @returns {{state: string, sha256: string, bytes?: number, detail?: string}} the file facts
 */
export function fileIdentity(absolute) {
  try {
    const info = statSync(absolute)
    if (!info.isFile()) return { state: 'not-a-file', sha256: 'unreadable' }
    return { state: 'present', sha256: createHash('sha256').update(readFileSync(absolute)).digest('hex'), bytes: info.size }
  } catch (error) {
    const missing = error?.code === 'ENOENT'
    return { state: missing ? 'missing' : 'unreadable', sha256: missing ? 'missing' : 'unreadable', detail: String(error?.code ?? error) }
  }
}

/**
 * Collect one DSH source's identity.
 *
 * A locally modified tree is a SNAPSHOT of this machine, never an upstream
 * release, and an unresolvable field is unknown with its reason attached.
 * @param {object} options
 * @param {object} options.source a resolved resolveDshSource result
 * @param {string} [options.now] collection timestamp (tests pin it)
 * @param {string[]} [options.inputs] the relevant files to digest
 * @param {{execFileSync?: Function}} [options.deps] injectable runner
 * @returns {object} the identity record
 */
export function inspectCheckout(options) {
  if (typeof options.source?.resolvedPath !== 'string') {
    throw new Error('inspectCheckout needs a RESOLVED source (got ' + String(options.source?.status) + '): an unresolved path has no directory to read')
  }
  const directory = resolve(options.source.resolvedPath)
  const inputs = options.inputs ?? DEFAULT_RELEVANT_INPUTS
  const files = inputs.map((path) => ({ path, ...fileIdentity(join(directory, ...path.split('/'))) }))
  const vcs = readCheckoutVcs(directory, options.deps ?? {})
  const snapshot = vcs.dirty === 'clean' ? 'clean-checkout' : vcs.dirty === 'dirty' ? 'local-modified' : 'unknown'
  const unknown = []
  if (vcs.commit === 'unknown') unknown.push('DSH commit: ' + (vcs.detail ?? 'git could not read it'))
  if (vcs.dirty === 'unknown') unknown.push('DSH working-tree state')
  if (options.source.declaration?.version === undefined || options.source.declaration.version === 'unknown') unknown.push('DSH version declaration')
  for (const file of files) {
    if (file.state !== 'present') unknown.push('relevant input ' + file.path + ' is ' + file.state)
  }
  return {
    role: 'dsh-checkout',
    origin: options.source.origin,
    inputPath: options.source.inputPath,
    resolvedPath: directory,
    link: options.source.link === true,
    declaration: options.source.declaration ?? { name: 'unknown', version: 'unknown', packageManager: 'unknown' },
    vcs,
    // A dirty tree is reported as what it is. Nothing here calls it published.
    snapshot,
    snapshotNote: snapshot === 'local-modified'
      ? '本机工作树含未提交改动：这是一份本地修改后的内容快照，不是上游已发布版本。'
      : snapshot === 'clean-checkout' ? '工作树干净：内容对应该 commit。' : '工作树状态未知：不能按已发布内容对待。',
    files,
    collectedAt: options.now ?? new Date().toISOString(),
    unknown,
  }
}

/**
 * Read this project's exact dependency declarations.
 * @param {string} repository the maintenance worktree
 * @returns {object} the anchors and the host contracts this project pins
 */
export function readDeclarations(repository) {
  const anchors = {}
  const problems = []
  for (const [role, file, specifier] of ENGINE_ANCHORS) {
    const absolute = join(repository, ...file.split('/'))
    const identity = fileIdentity(absolute)
    if (identity.state !== 'present') {
      anchors[role] = { path: file, state: identity.state, specifier, declaredVersion: 'unknown' }
      problems.push(file + ' is ' + identity.state + ': the engine anchor cannot be read')
      continue
    }
    try {
      const manifest = JSON.parse(readFileSync(absolute, 'utf8'))
      const declared = manifest?.dependencies?.[specifier] ?? manifest?.devDependencies?.[specifier]
      anchors[role] = {
        path: file,
        state: 'present',
        sha256: identity.sha256,
        specifier,
        declaredVersion: typeof declared === 'string' ? declared : 'unknown',
        exact: typeof declared === 'string' && /^\d+\.\d+\.\d+/u.test(declared),
      }
      if (typeof declared !== 'string') problems.push(file + ' does not declare ' + specifier)
    } catch (error) {
      anchors[role] = { path: file, state: 'unreadable', specifier, declaredVersion: 'unknown' }
      problems.push(file + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const rootManifest = join(repository, 'package.json')
  const host = {}
  const rootIdentity = fileIdentity(rootManifest)
  if (rootIdentity.state === 'present') {
    try {
      const manifest = JSON.parse(readFileSync(rootManifest, 'utf8'))
      for (const specifier of WATCHED_SPECIFIERS) {
        const declared = manifest?.devDependencies?.[specifier] ?? manifest?.dependencies?.[specifier]
        if (typeof declared === 'string') host[specifier] = declared
      }
    } catch (error) {
      problems.push('package.json is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
    }
  } else {
    problems.push('package.json is ' + rootIdentity.state)
  }
  return { anchors, host, sha256: rootIdentity.sha256, problems }
}

/**
 * Read the versions the lockfile pins for the watched specifiers.
 *
 * A pnpm lockfile's importer keys carry the version, so this scans whole lines
 * instead of loading YAML: the shipped bundle carries no parser. A miss is
 * reported with its method, never as "no locked version exists".
 * @param {string} repository the maintenance worktree
 * @returns {{entries: object[], sha256: string, method: string, problems: string[]}} the locked versions
 */
export function readLockedVersions(repository) {
  const absolute = join(repository, 'pnpm-lock.yaml')
  const identity = fileIdentity(absolute)
  const method = 'pnpm-lock.yaml key scan'
  if (identity.state !== 'present') {
    return { entries: [], sha256: identity.sha256, method, problems: ['pnpm-lock.yaml is ' + identity.state + ': no locked version can be reported'] }
  }
  const lines = readFileSync(absolute, 'utf8').split('\n')
  const entries = []
  const problems = []
  for (const specifier of WATCHED_SPECIFIERS) {
    const prefix = "  '" + specifier + '@'
    const line = lines.find((entry) => entry.startsWith(prefix))
    if (line === undefined) {
      problems.push('the lockfile has no key for ' + specifier + ' (' + method + ')')
      continue
    }
    const rest = line.slice(prefix.length)
    const end = Math.min(...[rest.indexOf("'"), rest.indexOf('(')].filter((index) => index >= 0))
    entries.push({ specifier, version: Number.isFinite(end) ? rest.slice(0, end) : rest.trim() })
  }
  return { entries, sha256: identity.sha256, method, problems }
}

/**
 * Read the patch identity: the files and the exact version each one is bound to.
 *
 * The digests are computed HERE from the patches directory itself rather than
 * inherited from the VCS read: patch identity is a local fact, so a git that
 * cannot answer must not turn "these are the bytes" into "there are none".
 * @param {string} repository the maintenance worktree
 * @param {object} repositoryState a readRepositoryState result (its list corroborates)
 * @returns {{files: object[], bound: object[], source: string, problems: string[]}} the patch identity
 */
export function readPatchIdentity(repository, repositoryState) {
  const problems = []
  const absolute = join(repository, 'pnpm-workspace.yaml')
  const identity = fileIdentity(absolute)
  const bound = []
  if (identity.state !== 'present') {
    problems.push('pnpm-workspace.yaml is ' + identity.state + ': the patchedDependencies binding cannot be reported')
  } else {
    let inSection = false
    for (const line of readFileSync(absolute, 'utf8').split('\n')) {
      if (/^patchedDependencies:/u.test(line)) { inSection = true; continue }
      if (!inSection) continue
      if (/^\S/u.test(line)) break
      const match = /^\s+'?([^':]+@[^']+)'?:\s*(\S+)\s*$/u.exec(line)
      if (match !== null) bound.push({ specifier: match[1], patch: match[2] })
    }
    if (bound.length === 0) problems.push('pnpm-workspace.yaml lists no patchedDependencies entry (section scan)')
  }
  const directory = join(repository, 'patches')
  let names
  try {
    names = readdirSync(directory).filter((name) => name.endsWith('.patch')).sort()
  } catch (error) {
    names = undefined
    problems.push('the patches directory could not be listed (' + String(error?.code ?? error) + '): no patch digest can be reported')
  }
  const files = names === undefined
    ? []
    : names.map((name) => {
      const file = join(directory, name)
      const fileState = fileIdentity(file)
      if (fileState.state !== 'present') problems.push(file + ' is ' + fileState.state)
      return { path: file, name, state: fileState.state, sha256: fileState.sha256 }
    })
  // Only a VCS read that actually SUCCEEDED can corroborate anything: a git that
  // failed reports an empty list, and comparing against it would turn "could not
  // read" into a contradiction the maintainer cannot act on.
  const carried = repositoryState?.commit === 'unknown' || !Array.isArray(repositoryState?.patchFiles)
    ? undefined
    : repositoryState.patchFiles.length
  if (carried !== undefined && names !== undefined && carried !== names.length) {
    problems.push('the VCS read reported ' + carried + ' patch file(s) while the patches directory carries ' + names.length)
  }
  return {
    files,
    bound,
    source: 'patches/*.patch digests read from the directory + pnpm-workspace.yaml patchedDependencies keys',
    problems,
  }
}

/**
 * Collect this project's baseline: declarations, locked versions, patch identity
 * and whatever the installed resolution can prove.
 *
 * The installed view is reported SEPARATELY and its absence never blocks the
 * source check — but a missing installation is also never called verified.
 * @param {object} options
 * @param {string} options.repository the maintenance worktree
 * @param {string} options.installationRoot the bundle install root
 * @param {string} [options.now] collection timestamp
 * @param {{execFileSync?: Function, readRepositoryState?: Function, collectBaseline?: Function}} [options.deps] injectable seams (tests)
 * @returns {object} the baseline record
 */
export function projectBaseline(options) {
  const repository = resolve(options.repository)
  const readState = options.deps?.readRepositoryState ?? readRepositoryState
  const collect = options.deps?.collectBaseline ?? collectBaseline
  const runner = options.deps?.execFileSync ?? captureRunner
  const repositoryState = readState(repository, { execFileSync: runner })
  const declarations = readDeclarations(repository)
  const locked = readLockedVersions(repository)
  const patches = readPatchIdentity(repository, repositoryState)
  let installed
  try {
    installed = collect({
      installationRoot: options.installationRoot,
      maintenanceRepository: repository,
      ...options.now === undefined ? {} : { now: options.now },
    })
  } catch (error) {
    installed = { status: 'unavailable', detail: error instanceof Error ? error.message : String(error) }
  }
  const unknown = []
  if (repositoryState.commit === 'unknown') unknown.push('本项目 commit: ' + (repositoryState.detail ?? 'git could not read it'))
  if (repositoryState.dirty === 'unknown') unknown.push('本项目工作树状态')
  for (const problem of declarations.problems) unknown.push('依赖声明: ' + problem)
  for (const problem of locked.problems) unknown.push('锁定依赖: ' + problem)
  for (const problem of patches.problems) unknown.push('补丁身份: ' + problem)
  if (installed?.status === 'unavailable') unknown.push('实际安装解析: ' + installed.detail)
  return {
    role: 'maintenance-repository',
    path: repository,
    repository: repositoryState,
    declarations,
    locked,
    patches,
    installed,
    installedNote: '实际解析信息只证明「本机这份安装解析到了什么」；它不等于补丁语义已验证，也不证明运行中的宿主加载了它。',
    collectedAt: options.now ?? new Date().toISOString(),
    unknown,
  }
}

/**
 * Assemble one check round.
 * @param {object} options
 * @param {object} options.source the DSH identity
 * @param {object} options.project the project baseline
 * @param {object[]} options.areas the per-area results
 * @param {string} options.now the check timestamp
 * @returns {object} the structured record
 */
export function buildSyncCheck(options) {
  const differences = options.areas.flatMap((area) => area.differences ?? [])
  const areaGaps = options.areas.flatMap((area) => area.gaps ?? [])
  const contentHash = hashOf({
    source: {
      resolvedPath: options.source.resolvedPath,
      declaration: options.source.declaration,
      commit: options.source.vcs.commit,
      dirty: options.source.vcs.dirty,
      files: options.source.files,
    },
    project: {
      commit: options.project.repository.commit,
      lockfileSha256: options.project.locked.sha256,
      patches: options.project.patches,
      anchors: options.project.declarations.anchors,
    },
    areas: options.areas,
    differences,
  })
  const stamp = stampOf(options.now)
  const uncovered = options.areas.filter((area) => area.status !== 'covered')
  const blocked = areaGaps.filter((gap) => gap.status === 'BLOCKED')
  const status = uncovered.length === 0 && blocked.length === 0 ? 'complete' : 'incomplete'
  return {
    tool: SYNC_TOOL,
    version: SYNC_VERSION,
    reportFormat: REPORT_FORMAT,
    // Content-addressed, so "same inputs" is checkable and a changed input is a
    // different round rather than a rewritten one.
    checkId: stamp + '-' + contentHash.slice(0, 12),
    contentHash,
    checkedAt: options.now,
    status,
    statusReason: status === 'complete'
      ? '全部比较区域已覆盖，且没有阻塞来源'
      : '未覆盖区域：' + (uncovered.length === 0 ? '无' : uncovered.map((area) => area.area).join('、'))
        + (blocked.length === 0 ? '' : '；阻塞来源：' + blocked.length + ' 项')
        + '；本报告不得读作全范围已同步',
    source: options.source,
    project: options.project,
    coverage: options.areas.map((area) => ({
      area: area.area,
      label: AREA_LABELS[area.area] ?? area.area,
      status: area.status,
      detail: area.detail,
      checks: area.checks ?? 0,
      differences: (area.differences ?? []).length,
      ticket: area.ticket ?? AREA_TICKETS[area.area],
    })),
    differences,
    releaseQueries: options.areas.flatMap((area) => area.releaseQueries ?? []),
    // The repeat-check section: how each difference relates to the previous round
    // and to the maintainer's decisions. It is NOT part of the content hash above,
    // so identical current inputs keep an identical checkId with or without one.
    history: options.history ?? null,
    // Per-area checkpoints: the object list each comparator actually walked, so a
    // reader can see WHAT was compared instead of trusting a summary line.
    checkpoints: Object.fromEntries(options.areas
      .filter((area) => Array.isArray(area.checklist))
      .map((area) => [area.area, area.checklist])),
    recommendations: options.areas.flatMap((area) => area.recommendations ?? []),
    gaps: [
      ...areaGaps,
      // A field that could not be established is a GAP, not a silent 'unknown':
      // the reader has to see which claim lost its evidence and why.
      ...options.source.unknown.map((detail) => ({ id: 'source-identity', status: 'GAP', detail })),
      ...options.project.unknown.map((detail) => ({ id: 'project-baseline', status: 'GAP', detail })),
    ],
  }
}

/**
 * The UTC stamp used in directory and check ids.
 * @param {string} at an ISO timestamp
 * @returns {string} YYYYMMDD-HHMMSS
 */
export function stampOf(at) {
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) throw new Error('the check timestamp must be a valid date')
  const pad = (value) => String(value).padStart(2, '0')
  return String(when.getUTCFullYear()) + pad(when.getUTCMonth() + 1) + pad(when.getUTCDate())
    + '-' + pad(when.getUTCHours()) + pad(when.getUTCMinutes()) + pad(when.getUTCSeconds())
}

/**
 * The human-readable report for one check round.
 * @param {object} check a buildSyncCheck result
 * @returns {string} markdown
 */
export function renderSyncReport(check) {
  const quoted = (value) => '\x60' + (value === undefined || value === null || value === '' ? 'unknown' : String(value)) + '\x60'
  // One place that turns a checkpoint status into prose, so the checklist and any
  // later section cannot describe the same status differently.
  const STATUS_TEXT = { same: '相同', changed: '不同', 'only-upstream': '仅来源有', 'only-local': '仅本项目有', unreadable: '读不出' }
  const lines = []
  lines.push('# PTC 与上游能力同步检查 — ' + check.checkedAt)
  lines.push('')
  lines.push('- 检查编号：' + quoted(check.checkId) + '（报告格式 ' + quoted(check.reportFormat) + '）')
  lines.push('- 状态：**' + (check.status === 'complete' ? '完整' : '不完整') + '** —— ' + check.statusReason)
  lines.push('- 本轮不修改来源、依赖、补丁、profile 或链接；检查只写本目录。')
  lines.push('')
  lines.push('## 本机 DSH 来源')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('|---|---|')
  lines.push('| 来源层 | ' + quoted(check.source.origin) + ' |')
  lines.push('| 输入路径 | ' + quoted(check.source.inputPath) + ' |')
  lines.push('| 实际解析目录 | ' + quoted(check.source.resolvedPath) + ' |')
  lines.push('| 是否用户链接 | ' + (check.source.link ? '是（链接由用户维护，本检查不创建、不修复）' : '否') + ' |')
  lines.push('| 版本声明 | ' + quoted(check.source.declaration.name) + ' ' + quoted(check.source.declaration.version) + ' |')
  lines.push('| commit | ' + quoted(check.source.vcs.commit) + ' |')
  lines.push('| 工作树 | ' + quoted(check.source.vcs.dirty) + '（' + check.source.vcs.changedPaths.length + ' 个改动路径） |')
  lines.push('| 快照性质 | ' + check.source.snapshotNote + ' |')
  lines.push('| 取证时间 | ' + quoted(check.source.collectedAt) + ' |')
  lines.push('')
  lines.push('### 相关输入摘要')
  lines.push('')
  lines.push('| 路径 | 状态 | sha256 |')
  lines.push('|---|---|---|')
  for (const file of check.source.files) lines.push('| ' + quoted(file.path) + ' | ' + file.state + ' | ' + quoted(file.sha256) + ' |')
  lines.push('')
  lines.push('摘要只证明内容；同一版本号、同一文件都不构成语义兼容的结论。缺失的路径按缺失记录，不按「无变化」记录。')
  lines.push('')
  lines.push('## 本项目基线')
  lines.push('')
  lines.push('| 项 | 值 |')
  lines.push('|---|---|')
  lines.push('| 维护仓库 | ' + quoted(check.project.path) + ' |')
  lines.push('| commit | ' + quoted(check.project.repository.commit) + ' |')
  lines.push('| 工作树 | ' + quoted(check.project.repository.dirty) + '（' + (check.project.repository.changedPaths ?? []).length + ' 个改动路径，含未提交输入的摘要） |')
  lines.push('| 锁文件 sha256（直接读取） | ' + quoted(check.project.locked.sha256) + ' |')
  lines.push('')
  lines.push('### 精确依赖声明')
  lines.push('')
  lines.push('| 角色 | 文件 | 声明 | 精确 |')
  lines.push('|---|---|---|---|')
  for (const [role, anchor] of Object.entries(check.project.declarations.anchors)) {
    lines.push('| ' + role + ' | ' + quoted(anchor.path) + ' | ' + quoted(anchor.specifier) + ' ' + quoted(anchor.declaredVersion) + ' | ' + (anchor.exact === true ? '是' : '否/unknown') + ' |')
  }
  lines.push('')
  lines.push('### 锁定依赖（' + check.project.locked.method + '）')
  lines.push('')
  lines.push('| 包 | 锁定版本 |')
  lines.push('|---|---|')
  if (check.project.locked.entries.length === 0) lines.push('| （未取得） | unknown |')
  for (const entry of check.project.locked.entries) lines.push('| ' + quoted(entry.specifier) + ' | ' + quoted(entry.version) + ' |')
  lines.push('')
  lines.push('### 补丁身份')
  lines.push('')
  lines.push('| 补丁文件 | sha256 |')
  lines.push('|---|---|')
  if ((check.project.patches.files ?? []).length === 0) lines.push('| （无） | — |')
  for (const file of check.project.patches.files ?? []) lines.push('| ' + quoted(file.path) + ' | ' + quoted(file.sha256) + ' |')
  lines.push('')
  if ((check.project.patches.bound ?? []).length > 0) {
    lines.push('| patchedDependencies 键 | 补丁 |')
    lines.push('|---|---|')
    for (const entry of check.project.patches.bound) lines.push('| ' + quoted(entry.specifier) + ' | ' + quoted(entry.patch) + ' |')
    lines.push('')
  }
  lines.push('### 实际安装解析（可取得的部分）')
  lines.push('')
  lines.push(check.project.installedNote)
  lines.push('')
  const engines = check.project.installed?.engines
  if (engines === undefined) {
    lines.push('- 未取得实际安装解析信息。')
  } else {
    for (const [role, engine] of Object.entries(engines)) {
      lines.push('- ' + quoted(role) + '：版本 ' + quoted(engine?.version) + '，补丁证据 ' + quoted(engine?.patch?.status)
        + (engine?.patch?.missing?.length ? '（缺少标记 ' + engine.patch.missing.length + ' 项）' : ''))
    }
    lines.push('- 解析路径：' + quoted(check.project.installed?.realpaths?.hashline) + ' / ' + quoted(check.project.installed?.realpaths?.toolEdit))
  }
  lines.push('')
  lines.push('## 覆盖范围')
  lines.push('')
  lines.push('| 区域 | 状态 | 检查点 | 差异 | 说明 |')
  lines.push('|---|---|---|---|---|')
  for (const area of check.coverage) {
    lines.push('| ' + area.label + ' | ' + area.status + ' | ' + area.checks + ' | ' + area.differences + ' | ' + area.detail + ' |')
  }
  lines.push('')
  if (check.differences.length === 0) {
    lines.push('本轮没有差异记录：这不是「已同步」的结论 —— 未覆盖区域根本没有比较过（见上表）。')
  } else {
    lines.push('| 差异标识 | 区域 | 影响 | 对象 | 本项目身份 | 来源身份 | 处置 | 依据 | 复查条件 |')
    lines.push('|---|---|---|---|---|---|---|---|---|')
    for (const item of check.differences) {
      lines.push('| ' + quoted(item.id) + ' | ' + item.area + ' | ' + (item.impact ?? 'unknown') + ' | ' + quoted(item.object) + ' | ' + quoted(item.left?.identity) + ' | ' + quoted(item.right?.identity) + ' | ' + item.disposition + ' | ' + (item.basis === undefined ? '—' : item.basis) + ' | ' + (item.recheckWhen ?? '—') + ' |')
    }
    lines.push('')
    lines.push('身份是内容摘要：两端不同只证明内容不同。「保留」表示本项目有意保留并已引用依据；「待分析」表示静态摘要不足以下结论，取得行为依据后再判。')
  }
  // The repeat-check section sits right after the difference list: a reader who
  // just learned what changed wants to know which of it is actually new.
  lines.push(...renderHistorySection(check.history))
  lines.push('')
  const checkpointAreas = Object.entries(check.checkpoints ?? {})
  if (checkpointAreas.length > 0) {
    lines.push('## 检查点（逐对象，不只是整文件摘要）')
    lines.push('')
    for (const [area, items] of checkpointAreas) {
      lines.push('### ' + (AREA_LABELS[area] ?? area))
      lines.push('')
      lines.push('| 检查点 | 对象 | 影响 | 本项目 | 来源 | 状态 |')
      lines.push('|---|---|---|---|---|---|')
      for (const item of items) {
        lines.push('| ' + quoted(item.id) + ' | ' + quoted(item.object) + ' | ' + (item.impact ?? 'unknown') + ' | ' + quoted(item.left?.identity) + ' | ' + quoted(item.right?.identity) + ' | ' + (STATUS_TEXT[item.status] ?? item.status) + ' |')
      }
      lines.push('')
    }
    lines.push('「相同」只表示两端内容摘要一致：它不证明行为兼容，也不证明本机宿主加载了这份内容。')
    lines.push('')
  }
  lines.push('')
  if (check.recommendations.length > 0) {
    lines.push('## 建议与待办')
    lines.push('')
    for (const item of check.recommendations) lines.push('- ' + item.text)
    lines.push('')
  }
  if (check.gaps.length > 0) {
    lines.push('## 缺口（unknown / GAP / BLOCKED）')
    lines.push('')
    for (const gap of check.gaps) lines.push('- [' + gap.status + '] ' + quoted(gap.id) + '：' + gap.detail)
    lines.push('')
  }
  lines.push('## 边界与未做')
  lines.push('')
  lines.push('- 未调用付费模型；DSH 来源从本机目录读取。')
  for (const query of check.releaseQueries ?? []) {
    const mode = query.mode === 'fixed-response' ? '固定响应（本轮未为该包发起发布查询）'
      : query.mode === 'injected-runner' ? '注入的发布查询 runner（是否联网由 runner 决定）'
        : '默认 npm 发布查询（可能访问网络，失败也不等于未联网）'
    lines.push('- ' + quoted(query.package) + '：' + mode + '。')
  }
  lines.push('- 未修改来源源码、依赖声明、锁文件、补丁、日常 profile 或任何用户链接；未安装、未切换目标。')
  lines.push('- 检查止于报告与建议；跟进项的候选验证与目标切换沿用既有受控流程，报告不是同意记录。')
  lines.push('')
  return lines.join('\n')
}

/**
 * The evidence directory for one round: <evidence>/sync/<checkId>/.
 * @param {string} evidenceDirectory the configured evidence root
 * @param {object} check the check
 * @returns {string} the round directory
 */
export function syncDirectory(evidenceDirectory, check) {
  return join(evidenceDirectory, 'sync', check.checkId)
}

/**
 * A FREE round directory for this check.
 *
 * The id is content-addressed, so two runs over unchanged inputs in the same
 * second would collide — and a round that overwrites the previous round is
 * exactly how a history comparison starts reading its own output. A suffix
 * keeps every round, while the id still says which inputs it saw.
 * @param {string} evidenceDirectory the configured evidence root
 * @param {object} check the check
 * @returns {string} a directory no earlier round occupies
 */
export function roundDirectory(evidenceDirectory, check) {
  const base = syncDirectory(evidenceDirectory, check)
  if (!existsSync(base)) return base
  for (let index = 2; index < 100; index += 1) {
    const candidate = base + '-' + String(index)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error('no free round directory beside ' + base + ': move or archive the earlier rounds first')
}

/**
 * Write the two round artifacts.
 *
 * The report is rendered BEFORE the directory is created, so a render failure
 * cannot leave an empty round behind (the ADR-0004 partial-write lesson).
 * @param {{directory: string, check: object}} options the round
 * @returns {Promise<{record: string, report: string}>} the written paths
 */
export async function writeSyncCheck(options) {
  const report = renderSyncReport(options.check)
  await mkdir(options.directory, { recursive: true })
  const files = { record: join(options.directory, 'sync.json'), report: join(options.directory, 'report.md') }
  await writeFile(files.record, JSON.stringify(options.check, null, 2) + '\n', 'utf8')
  await writeFile(files.report, report + '\n', 'utf8')
  return files
}

/**
 * The source area's coverage entry, derived from what was actually recorded.
 *
 * A count of recorded identity points, not a promise: the unknowns stay in the
 * gaps list, so "covered" here means "the identities were taken", never "the two
 * sides agree".
 * @param {{source: object, project: object}} facts the round's identities
 * @returns {object} the area result
 */
export function sourceCoverage(facts) {
  const anchors = Object.keys(facts.project.declarations.anchors ?? {}).length
  const checks = 1 + facts.source.files.length + anchors + facts.project.locked.entries.length + facts.project.patches.files.length + facts.project.patches.bound.length
  return {
    area: 'source',
    status: 'covered',
    ticket: '01',
    detail: '已记录来源身份（来源层、输入路径、实际解析目录、版本声明、commit、工作树、相关输入摘要）与本项目基线（精确声明、锁定依赖、补丁身份、实际安装解析）；无法取得的字段逐条记入缺口',
    checks,
    differences: [],
  }
}

/**
 * The identity record for a source that WAS named but cannot be read.
 *
 * It keeps the shape of a real identity so the report has one place to look, and
 * says in its own note that nothing was read: an unreadable source must never
 * come out looking like an unchanged one.
 * @param {object} resolution the failed resolution
 * @param {string} now the check timestamp
 * @returns {object} the identity record
 */
export function unavailableSource(resolution, now) {
  return {
    role: 'dsh-checkout',
    origin: resolution.origin ?? 'config',
    inputPath: resolution.inputPath ?? 'unspecified',
    resolvedPath: 'unavailable',
    link: false,
    declaration: { name: 'unknown', version: 'unknown', packageManager: 'unknown' },
    vcs: { commit: 'unknown', dirty: 'unknown', changedPaths: [], detail: resolution.reason },
    snapshot: 'unknown',
    snapshotNote: '来源不可用：本轮没有读取任何来源内容，因此没有内容可以作为「未变化」的依据。',
    files: [],
    collectedAt: now,
    unknown: ['DSH source: ' + (resolution.reason ?? 'unusable')],
  }
}

/**
 * An area that could not run because the source tree it reads is unavailable.
 * @param {{area: string, ticket: string, gapId: string, reason: string}} options the area and why
 * @returns {object} the area result
 */
export function unavailableArea(options) {
  return {
    area: options.area,
    ticket: options.ticket,
    status: 'incomplete',
    detail: '该区域需要所选来源的源码树，而来源不可用：本轮没有比较，不能读作已同步或无变化',
    checks: 0,
    differences: [],
    gaps: [{ id: options.gapId, status: 'GAP', detail: '来源不可用：' + options.reason }],
  }
}

/**
 * Run one check round through the public entry.
 *
 * Everything a test needs to pin is injected (host home, config store,
 * maintenance repository, timestamp, git runner), so an automated test
 * exercises the SAME path a maintainer does.
 * @param {object} [options] the run's inputs
 * @returns {Promise<{code: number, value: object}>} the exit code and the CLI value
 */
export async function runSyncCheck(options = {}) {
  const env = options.env ?? {}
  const now = options.now ?? new Date().toISOString()
  if (Number.isNaN(Date.parse(now))) throw new Error('--now must be an ISO-8601 timestamp')
  const stateDir = options.stateDir ?? stateDirectory(env.DSH_HOME ?? join(homedir(), '.dsh'))
  const described = await describeConfig(stateDir)
  const settings = settingsOf(described)
  const resolution = resolveDshSource({
    explicit: options.checkout,
    environment: env.DSH_CHECKOUT,
    configured: settings.dshCheckout,
  })
  // TWO different failures, deliberately not collapsed:
  //   - nothing was named by any layer: there is no maintenance action to take,
  //     so this stops before writing anything (ticket 01, SYNC-01);
  //   - a named source is unusable: that is reported for the source-dependent
  //     areas, while the engines comparison still runs because it needs no source
  //     tree at all. The overall status says incomplete, never "complete" and
  //     never "no update" (spec: partial sources continue, the run is not whole).
  if (resolution.status === 'missing') {
    return {
      code: SYNC_EXIT.incomplete,
      value: {
        command: 'sync check',
        status: 'stopped',
        reason: resolution.reason,
        next: resolution.next,
        origin: resolution.origin,
        attempts: resolution.attempts.map((attempt) => ({ layer: attempt.layer, status: attempt.status, ...attempt.reason === undefined ? {} : { reason: attempt.reason } })),
        configuration: { path: described.path, exists: described.exists, settings },
        written: [],
      },
    }
  }
  const sourceUsable = resolution.status === 'resolved'
  const source = sourceUsable
    ? inspectCheckout({ source: resolution, now, ...options.deps === undefined ? {} : { deps: options.deps } })
    : unavailableSource(resolution, now);
  const project = projectBaseline({
    repository: options.repository ?? process.cwd(),
    installationRoot: options.installationRoot ?? options.repository ?? process.cwd(),
    now,
    ...options.deps === undefined ? {} : { deps: options.deps },
  })
  // The release-source fixture seam is normalised ONCE, before any comparator
  // runs: a malformed record is a usage error, not an area that quietly reads as
  // "nothing published".
  const releaseSources = options.sources === undefined ? undefined : normalizeReleaseSources(options.sources)
  const compareOptions = { ...options, ...releaseSources === undefined ? {} : { releaseSources } }
  const areas = []
  for (const area of AREA_IDS) {
    // The source area IS this slice's deliverable: its identity record and the
    // baseline ARE the checks, so it is covered by the same run that writes it —
    // and it says so only while the identities are actually recorded.
    if (area === 'source') {
      areas.push(sourceUsable
        ? sourceCoverage({ source, project })
        : unavailableArea({
          area,
          ticket: AREA_TICKETS[area],
          gapId: 'source',
          reason: resolution.reason ?? 'the DSH source is unusable',
        }))
      continue
    }
    if (!sourceUsable && area !== 'engines') {
      // ptc and stock-read read the selected source tree: without it there is
      // nothing to compare, and the area says so instead of reading as unchanged.
      areas.push(unavailableArea({
        area,
        ticket: AREA_TICKETS[area],
        gapId: 'source:' + area,
        reason: resolution.reason ?? 'the DSH source is unusable',
      }))
      continue
    }
    const comparator = comparatorFor(area)
    if (comparator === undefined) {
      areas.push({
        area,
        status: 'not-covered',
        ticket: AREA_TICKETS[area],
        detail: '票据 ' + AREA_TICKETS[area] + ' 尚未交付该区域的比较器：本轮没有比较，报告不得视为该区域已同步',
        checks: 0,
        differences: [],
      })
      continue
    }
    try {
      const result = await comparator.compare({ source, project, now, options: compareOptions })
      areas.push({ area, ticket: AREA_TICKETS[area], ...result })
    } catch (error) {
      // A comparator that cannot finish leaves its area NAMED, not silently green.
      const detail = error instanceof Error ? error.message : String(error)
      areas.push({
        area,
        ticket: AREA_TICKETS[area],
        status: 'incomplete',
        detail: '该区域的比较未完成：' + detail,
        checks: 0,
        differences: [],
        gaps: [{ id: 'comparator:' + area, status: 'GAP', detail: '比较器未能完成：' + detail }],
      })
    }
  }
  // Where this round will be written decides what history it can read, so the
  // evidence location is resolved BEFORE the record is built.
  const evidenceEntry = described.roles?.evidenceDirectory
  const evidence = options.evidenceDirectory
    ?? (evidenceEntry?.configured === true && evidenceEntry.usable === true ? resolve(evidenceEntry.path) : undefined)
  const differences = areas.flatMap((area) => area.differences ?? [])
  const decisionsPath = options.decisions ?? (evidence === undefined ? undefined : join(evidence, 'sync', DECISIONS_FILE))
  const decisions = decisionsPath === undefined
    ? { status: 'absent', path: '', decisions: new Map(), detail: '没有指定决定记录，也没有可用的证据目录：本轮所有差异按未决定处理' }
    : await readDecisions({ path: decisionsPath })
  const previous = evidence === undefined
    ? { status: 'absent', previous: null, detail: '证据目录不可用：本轮无法读取上一轮记录，不做历史比较' }
    : readPreviousRound({ evidenceDirectory: evidence, format: REPORT_FORMAT })
  const history = compareWithHistory({
    differences,
    decisions: decisions.decisions,
    history: previous,
    decisionsPath: decisions.path,
    decisionsStatus: decisions.status,
    decisionsDetail: decisions.detail,
  })
  const check = buildSyncCheck({ source, project, areas, now, history })
  if (evidence === undefined) {
    const reason = evidenceEntry?.detail ?? 'the evidence directory is not configured'
    return {
      code: SYNC_EXIT.incomplete,
      value: {
        command: 'sync check',
        status: 'read-only',
        reason: '证据目录不可用（' + reason + '）：本轮分析已完成，但没有可写的位置，因此没有生成报告与结构化记录',
        next: 'node presets/ptc-hashline/operations/cli.mjs config --set-evidence-dir <absolute path>',
        check: summariseCheck(check),
        written: [],
      },
    }
  }
  const directory = roundDirectory(evidence, check)
  let files
  try {
    files = await writeSyncCheck({ directory, check })
  } catch (error) {
    return {
      code: SYNC_EXIT.incomplete,
      value: {
        command: 'sync check',
        status: 'incomplete',
        reason: '报告未能写入 ' + directory + '：' + (error instanceof Error ? error.message : String(error)),
        check: summariseCheck(check),
        written: [],
      },
    }
  }
  return {
    code: check.status === 'complete' ? SYNC_EXIT.ok : SYNC_EXIT.incomplete,
    value: {
      command: 'sync check',
      status: check.status,
      check: summariseCheck(check),
      evidence: { directory, files },
      written: [files.record, files.report],
    },
  }
}

/**
 * The CLI-shaped projection of one check: what a caller relays without parsing markdown.
 * @param {object} check the full record
 * @returns {object} the narrowed value
 */
export function summariseCheck(check) {
  return {
    checkId: check.checkId,
    contentHash: check.contentHash,
    checkedAt: check.checkedAt,
    reportFormat: check.reportFormat,
    status: check.status,
    statusReason: check.statusReason,
    source: {
      origin: check.source.origin,
      inputPath: check.source.inputPath,
      resolvedPath: check.source.resolvedPath,
      link: check.source.link,
      commit: check.source.vcs.commit,
      dirty: check.source.vcs.dirty,
      snapshot: check.source.snapshot,
      version: check.source.declaration.version,
    },
    project: {
      path: check.project.path,
      commit: check.project.repository.commit,
      dirty: check.project.repository.dirty,
      lockfileSha256: check.project.repository.lockfileSha256,
      anchors: check.project.declarations.anchors,
    },
    coverage: check.coverage,
    differences: check.differences.length,
    gaps: check.gaps.length,
    // The repeat-check verdict travels with the summary so a caller can say "no new
    // changes" or "a decision needs review" without parsing the markdown.
    history: check.history === null || check.history === undefined
      ? null
      : {
        verdict: check.history.verdict,
        status: check.history.historyStatus,
        previousCheckId: check.history.previous?.checkId ?? null,
        decisions: check.history.decisions,
        summary: check.history.summary,
      },
  }
}
