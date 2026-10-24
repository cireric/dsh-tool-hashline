/**
 * Actual runtime baseline collection (the ticket's baseline requirement).
 *
 * Three roles are reported separately and never collapsed, because a linked
 * development checkout makes them coincide today while an installed copy
 * separates them:
 *
 *   - `installation`         the resource root of the running bundle;
 *   - `maintenanceRepository` the worktree that maintains dependencies/patches;
 *   - `upgradeTarget`       the location a consented upgrade would change.
 *
 * Anything that cannot be established is `'unknown'`, never a guess, and a
 * matching version number is never evidence that a local patch is in effect:
 * patch evidence is a marker string found in the RESOLVED build file.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/baseline
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/** Marker text that only the local hashline patch introduces. */
export const HASHLINE_PATCH_MARKERS = [
  { file: ['dist', 'patcher.js'], marker: 'authorizes the snapshot migration' },
  { file: ['dist', 'patcher.js'], marker: 'bookkeeping did not complete' },
]

/** Marker text that only the local tool-edit patch introduces. */
export const TOOL_EDIT_PATCH_MARKERS = [
  { file: ['dist', 'session.js'], marker: "const intent = { kind: 'createIfAbsent' }" },
  { file: ['dist', 'session.js'], marker: 'async readTextPreservingBom(target, signal)' },
  { file: ['dist', 'hashline', 'filesystem.js'], marker: 'readTextPreservingBom' },
  { file: ['dist', 'constants.js'], marker: 'PATHS: both the section PATH' },
  { file: ['dist', 'index.js'], marker: 'not one atomic step for the whole call' },
]

/** Host packages whose installed version is part of the running combination. */
const HOST_PACKAGES = [
  ['@deepseek-ai/cordis', 'cordis'],
  ['@deepseek-ai/dsh-tools', 'tools'],
  ['@deepseek-ai/dsh-fs', 'fs'],
  ['@deepseek-ai/dsh-agent', 'agent'],
  ['@deepseek-ai/dsh-session', 'session'],
  ['@deepseek-ai/dsh-ptc-runtime', 'ptc'],
  ['@deepseek-ai/dsh-skill', 'skill'],
  ['@deepseek-ai/dsh-agent-preset-registry', 'presetRegistry'],
  // The DSH product version, which a host upgrade changes; a preset may load
  // without it (a bundle install carries no host), so it reports unknown then.
  ['@deepseek-ai/dsh', 'dsh'],
]

/**
 * Digest one file's bytes.
 * @param {string} path file to hash
 * @returns {string} the hex SHA-256
 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Read a package manifest through a resolver, or `'unknown'`.
 * @param {NodeRequire} requireFrom resolver anchored at the bundle
 * @param {string} specifier package name or subpath to resolve
 * @returns {{version?: string, path?: string, detail?: string}} the manifest facts
 */
export function readManifest(requireFrom, specifier) {
  try {
    const manifestPath = requireFrom.resolve(specifier + '/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    return { version: typeof manifest.version === 'string' ? manifest.version : 'unknown', path: manifestPath }
  } catch (error) {
    return { version: 'unknown', detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * The realpath of one resolved package directory.
 *
 * `readManifest().path` is the resolver's answer; a linked (workspace or
 * `link:`) install can make it differ from the physical location that actually
 * loads, and a patch applies to the physical copy.
 * @param {NodeRequire} requireFrom resolver anchored at the bundle
 * @param {string} specifier package name
 * @returns {string} the physical package directory, or an `unknown: ` reason
 */
export function realpathOf(requireFrom, specifier) {
  try {
    return dirname(realpathSync(requireFrom.resolve(specifier + '/package.json')))
  } catch (error) {
    // Not an empty catch: the reason is returned so a reader (and the skill
    // body relaying it) can say WHY the physical path is unknown.
    return 'unknown: ' + (error instanceof Error ? error.message : String(error))
  }
}

/**
 * Report whether a package's RESOLVED build carries the local patch markers.
 * @param {NodeRequire} requireFrom resolver anchored at the bundle
 * @param {string} specifier the engine package
 * @param {{file: string[], marker: string}[]} markers expected marker strings
 * @returns {{status: string, packagePath?: string, present?: string[], missing?: string[], detail?: string, note?: string}} the patch verdict
 */
export function patchEvidence(requireFrom, specifier, markers) {
  let packagePath
  try {
    packagePath = realpathSync(requireFrom.resolve(specifier + '/package.json'))
  } catch (error) {
    return { status: 'unknown', detail: 'the package does not resolve: ' + (error instanceof Error ? error.message : String(error)) }
  }
  const root = dirname(packagePath)
  const present = []
  const missing = []
  for (const { file, marker } of markers) {
    const target = join(root, ...file)
    const text = existsSync(target) ? readFileSync(target, 'utf8') : ''
    if (text.includes(marker)) present.push(marker)
    else missing.push(marker)
  }
  return {
    status: missing.length === 0 ? 'patched' : present.length === 0 ? 'unpatched' : 'partial',
    packagePath,
    present,
    missing,
    note: 'A matching version number is not evidence: this reads the resolved build files.',
  }
}

/**
 * Read the maintenance repository's VCS facts: commit, dirty state and digests
 * of the files an upgrade would touch.
 *
 * Everything is read from the configured worktree itself, so an absent or
 * unreadable repository reports `unknown` rather than inheriting the
 * installation root's identity.
 * @param {string | undefined} repository absolute maintenance worktree
 * @param {{execFileSync?: Function}} [deps] injectable runner (tests pass a stub)
 * @returns {object} the repository facts
 */
export function readRepositoryState(repository, deps = {}) {
  const runner = deps.execFileSync ?? execFileSync
  const unknown = { commit: 'unknown', dirty: 'unknown', changedPaths: [], lockfileSha256: 'unknown', patchFiles: [] }
  if (typeof repository !== 'string' || repository === '') return unknown
  // A worktree that is not a git repository is an expected `unknown`, not a
  // message the skill's own output should inherit, so stderr is captured.
  const git = (args) => runner('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const commit = String(git(['rev-parse', 'HEAD'])).trim()
    // Porcelain is the only dirty signal that covers staged, unstaged AND
    // untracked input; HEAD equality alone cannot prove a file did not change.
    const status = String(git(['status', '--porcelain=v1']))
    const changedPaths = status.split('\n').filter(line => line.trim() !== '').map(line => line.slice(3).trim())
    const lockPath = join(repository, 'pnpm-lock.yaml')
    const lockfileSha256 = existsSync(lockPath) ? sha256File(lockPath) : 'unknown'
    const patchDir = join(repository, 'patches')
    const patchFiles = existsSync(patchDir)
      ? readdirSync(patchDir).filter(name => name.endsWith('.patch')).sort()
        .map(name => ({ path: join(patchDir, name), sha256: sha256File(join(patchDir, name)) }))
      : []
    return { commit, dirty: changedPaths.length === 0 ? 'clean' : 'dirty', changedPaths, lockfileSha256, patchFiles }
  } catch (error) {
    return { ...unknown, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Collect the running combination from one installation root.
 *
 * @param {object} options
 * @param {string} options.installationRoot absolute resource root of the bundle
 * @param {string} [options.maintenanceRepository] explicitly configured worktree
 * @param {string} [options.upgradeTarget] a consented upgrade target, if any
 * @param {string} [options.provider] provider reported by the session log
 * @param {string} [options.model] model reported by the session log
 * @param {string} [options.presetId] preset identity reported by the caller
 * @param {string} [options.presetSource] where the preset projection was read
 * @param {string} [options.now] collection timestamp (tests pin it)
 * @returns {object} the baseline report
 */
export function collectBaseline(options) {
  const installationRoot = resolve(options.installationRoot)
  const requireFrom = createRequire(join(installationRoot, 'package.json'))
  const bundle = readManifest(requireFrom, 'dsh-tool-hashline')
  const packages = {}
  const resolvedPaths = { bundle: bundle.path ?? 'unknown' }
  for (const [specifier, label] of HOST_PACKAGES) {
    const manifest = readManifest(requireFrom, specifier)
    packages[label] = manifest.version ?? 'unknown'
    resolvedPaths[label] = manifest.path ?? 'unknown'
  }
  const repositoryState = readRepositoryState(options.maintenanceRepository)
  return {
    tool: 'ptc-hashline-operations-baseline',
    version: 1,
    collectedAt: options.now ?? new Date().toISOString(),
    roles: {
      installation: { root: installationRoot, packagePath: bundle.path ?? 'unknown' },
      maintenanceRepository: options.maintenanceRepository ?? 'unknown',
      upgradeTarget: options.upgradeTarget ?? 'unknown',
      note: 'These three roles are distinct even when a development link makes the paths coincide.',
    },
    versions: {
      bundle: bundle.version ?? 'unknown',
      ...packages,
    },
    // Where each version above was read from: a version number alone cannot
    // show WHICH copy is running when several installs exist.
    resolvedPaths,
    // The physical directory each engine actually loads from.
    realpaths: {
      hashline: realpathOf(requireFrom, '@hy-sde-org/dsh-hashline'),
      toolEdit: realpathOf(requireFrom, '@hy-sde-org/dsh-tool-edit'),
    },
    engines: {
      hashline: {
        version: readManifest(requireFrom, '@hy-sde-org/dsh-hashline').version ?? 'unknown',
        patch: patchEvidence(requireFrom, '@hy-sde-org/dsh-hashline', HASHLINE_PATCH_MARKERS),
      },
      toolEdit: {
        version: readManifest(requireFrom, '@hy-sde-org/dsh-tool-edit').version ?? 'unknown',
        patch: patchEvidence(requireFrom, '@hy-sde-org/dsh-tool-edit', TOOL_EDIT_PATCH_MARKERS),
      },
    },
    // The maintenance worktree's own VCS facts. Uncommitted input counts: a
    // matching HEAD cannot prove a file did not change.
    repository: repositoryState,
    session: {
      provider: options.provider ?? 'unknown',
      model: options.model ?? 'unknown',
      preset: options.presetId ?? 'unknown',
      presetSource: options.presetSource ?? 'unknown',
    },
    // Explicit gaps, so a reader never has to infer them from absent fields.
    // Each unknown VERSION is named exactly once, by the same predicate that
    // decided the version itself — the two lists cannot disagree.
    unknown: [
      ...options.maintenanceRepository === undefined ? ['maintenance repository'] : [],
      ...options.upgradeTarget === undefined ? ['upgrade target'] : [],
      ...options.provider === undefined ? ['provider'] : [],
      ...options.model === undefined ? ['model'] : [],
      ...repositoryState.commit === 'unknown' ? ['maintenance repository commit'] : [],
      ...Object.entries({ bundle: bundle.version ?? 'unknown', ...packages })
        .filter(([, version]) => version === 'unknown')
        .map(([label]) => 'version: ' + label),
    ],
  }
}
