#!/usr/bin/env node
/**
 * Install this bundle into a DSH profile (default: `web`), idempotently.
 *
 * It links the four local packages, registers the bundle, and verifies the
 * composed preset. It never restarts the host: the preset is static, so the
 * last step prints the restart command.
 *
 * Usage:
 *   node scripts/install-profile.mjs [--profile web] [--dsh-home <dir>]
 *     [--dsh-checkout <dir>] [--no-build|--force-build] [--dry-run] [--yes]
 */
import { existsSync, readFileSync, realpathSync, writeFileSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const PACKAGES = ['hashline', 'tool-read', 'tool-edit']
const BUNDLE = 'dsh-tool-hashline'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const profileName = value('--profile') ?? 'web'
const dryRun = flag('--dry-run')
const noBuild = flag('--no-build')
const forceBuild = flag('--force-build')

const fail = (code, message) => {
  console.error('FAILED: ' + message)
  process.exit(code)
}
const step = message => console.log('== ' + message)
const ok = message => console.log('  ok ' + message)
const note = message => console.log('  - ' + message)

function run(command, commandArgs, cwd, extraEnv = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    shell: isWin,
    env: { ...process.env, ...extraEnv },
  })
  return {
    code: result.status ?? 1,
    output: [(result.stdout ?? ''), (result.stderr ?? '')].join('').trim(),
    error: result.error,
  }
}

/** Run `pnpm dsh …`; fall back to `pnpm exec dsh …` when the shorthand is unknown. */
function runDsh(commandArgs, cwd) {
  const extraEnv = { DSH_HOME: dshHome }
  let result = run('pnpm', ['dsh', ...commandArgs], cwd, extraEnv)
  if (result.code !== 0 && /Command "dsh" not found|Unknown command: "dsh"|ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL/i.test(result.output)) {
    result = run('pnpm', ['exec', 'dsh', ...commandArgs], cwd, extraEnv)
  }
  return result
}

// ── locate the checkout, home and profile ───────────────────────────────────
function findCheckout() {
  const explicit = value('--dsh-checkout') ?? process.env.DSH_CHECKOUT
  const candidates = [explicit, resolve(repo, '..', '..', 'deepseek-harness'), resolve(repo, '..', 'deepseek-harness')]
  for (const candidate of candidates) {
    if (candidate !== undefined && existsSync(join(candidate, 'apps', 'cli', 'lib', 'bin.js'))) return candidate
  }
  return undefined
}

const checkout = findCheckout()
if (checkout === undefined) fail(1, 'DSH checkout not found; pass --dsh-checkout <dir> or set DSH_CHECKOUT')

const dshHome = value('--dsh-home') ?? process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const manifestPath = join(profileDir, 'package.json')
if (!existsSync(manifestPath)) fail(1, 'profile "' + profileName + '" not found at ' + profileDir + ' (run dsh once to initialise it)')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const bundles = manifest.dsh?.profile?.bundles ?? []

// ── build when an entry is missing ──────────────────────────────────────────
step('check build artifacts')
const missingDist = PACKAGES.filter(name => !existsSync(join(repo, 'packages', name, 'dist', 'index.js')))
if (forceBuild || (missingDist.length > 0 && !noBuild)) {
  if (dryRun) note('would run pnpm build (missing: ' + (missingDist.join(', ') || 'forced') + ')')
  else {
    const build = run('pnpm', ['build'], repo)
    if (build.code !== 0) fail(2, 'pnpm build failed:\n' + build.output)
    ok('built')
  }
} else {
  ok('dist present')
}

// ── detect what is already installed, by resolution ─────────────────────────
const requireFromProfile = createRequire(manifestPath)
const canonical = p => {
  try { return realpathSync.native(p) } catch { return p }
}
const samePath = (a, b) => canonical(a).toLowerCase() === canonical(b).toLowerCase()

function resolvedDir(pkg) {
  try {
    return canonical(dirname(requireFromProfile.resolve(pkg + '/package.json')))
  } catch {
    return undefined
  }
}

const wanted = [
  { spec: 'link:' + repo.replaceAll('\\', '/'), dir: repo, label: BUNDLE },
  ...PACKAGES.map(name => ({
    spec: 'link:' + join(repo, 'packages', name).replaceAll('\\', '/'),
    dir: join(repo, 'packages', name),
    label: '@dsh-tool-hashline/' + name,
  })),
]
const missing = wanted.filter(entry => {
  const installed = resolvedDir(entry.label)
  return installed === undefined || !samePath(installed, entry.dir)
})

step('inspect installed state')
if (missing.length === 0) ok('all four packages resolve to this checkout')
else for (const entry of missing) note('missing or stale: ' + entry.label)

const bundlesMissing = !bundles.includes(BUNDLE)
if (bundlesMissing) note('bundle not registered in dsh.profile.bundles')

// ── back up before any mutation ─────────────────────────────────────────────
const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
function backup() {
  for (const file of ['package.json', 'pnpm-lock.yaml']) {
    const source = join(profileDir, file)
    if (!existsSync(source)) continue
    const target = source + '.bak-' + stamp
    if (!dryRun) copyFileSync(source, target)
    else note('would back up ' + file)
  }
}

// ── install ─────────────────────────────────────────────────────────────────
if (missing.length > 0) {
  backup()
  // Install the whole set: pnpm dedupes, and the bundle's plugin rows name the
  // anchor packages by package name, so a partial link would leave them unresolved.
  const specs = wanted.map(entry => entry.spec)
  if (dryRun) {
    note('would run: pnpm dsh plugin --profile ' + profileName + ' add ' + specs.join(' '))
  } else {
    step('install with the source dsh CLI')
    const install = runDsh(['plugin', '--profile', profileName, 'add', ...specs], checkout)
    if (install.code !== 0) fail(3, 'dsh plugin add failed:\n' + install.output)
    ok('installed ' + specs.length + ' package(s)')
  }
}

// ── register the bundle if the plugin manager did not ───────────────────────
if (bundlesMissing) {
  if (dryRun) note('would add "' + BUNDLE + '" to dsh.profile.bundles')
  else {
    const current = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const currentBundles = current.dsh?.profile?.bundles ?? []
    if (!currentBundles.includes(BUNDLE)) {
      current.dsh = current.dsh ?? {}
      current.dsh.profile = current.dsh.profile ?? {}
      current.dsh.profile.bundles = [...currentBundles, BUNDLE]
      writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n')
      ok('registered ' + BUNDLE + ' in dsh.profile.bundles')
    }
  }
}

if (dryRun) {
  step('dry run complete; nothing was changed')
  process.exit(0)
}

// ── verification ────────────────────────────────────────────────────────────
step('verify the composed preset')
const dump = runDsh(['--profile', profileName, '--dump-config'], checkout)
if (dump.code !== 0) fail(4, 'dsh --dump-config failed:\n' + dump.output)
for (const needle of ['ptc-hashline', '@dsh-tool-hashline/tool-read', '@dsh-tool-hashline/tool-edit', 'intent-gate-watchdog']) {
  if (!dump.output.includes(needle)) fail(4, 'composed profile is missing ' + needle)
}
// Profiles may provide other selectable presets (for example, ptc-gate from
// dsh-ptc-roles). The install target is the presence of this bundle's preset;
// users choose PTC Hashline Mode in a new session after restarting the host.
ok('ptc-hashline preset, read/edit/watchdog present')

function resolveAsset(pkg, subpath, label) {
  // pnpm may finish linking a moment after the command returns on Windows;
  // retry briefly instead of failing on a transient ENOENT.
  let lastError
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return canonical(requireFromProfile.resolve(subpath === undefined ? pkg : pkg + '/' + subpath))
    } catch (error) {
      lastError = error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    }
  }
  fail(4, 'cannot resolve ' + label + ' from the profile: ' + (lastError instanceof Error ? lastError.message : String(lastError)))
}
const bundleManifest = resolveAsset(BUNDLE, 'package.json', 'the bundle manifest')
const watchdog = resolveAsset(BUNDLE, 'presets/ptc-hashline/intent-gate-watchdog.mjs', 'the watchdog')
const readEntry = resolveAsset('@dsh-tool-hashline/tool-read', undefined, 'the read entry')
const editEntry = resolveAsset('@dsh-tool-hashline/tool-edit', undefined, 'the edit entry')
for (const [label, file] of [['bundle', bundleManifest], ['watchdog', watchdog], ['read', readEntry], ['edit', editEntry]]) {
  if (!samePath(dirname(file), repo) && !canonical(file).toLowerCase().startsWith(canonical(repo).toLowerCase())) {
    fail(4, label + ' resolves outside this checkout: ' + file)
  }
}
ok('bundle, watchdog and both entries resolve inside ' + repo)

function hashlineFor(entry) {
  try {
    const req = createRequire(entry)
    return canonical(dirname(req.resolve('@hy-sde-org/dsh-hashline/package.json')))
  } catch {
    return undefined
  }
}
const readHashline = hashlineFor(join(repo, 'packages', 'tool-read', 'package.json'))
const editHashline = hashlineFor(join(repo, 'packages', 'tool-edit', 'package.json'))
if (readHashline === undefined || editHashline === undefined || !samePath(readHashline, editHashline)) {
  fail(4, 'read and edit do not share one physical hashline instance')
}
ok('read and edit share one hashline instance')

// ── summary ─────────────────────────────────────────────────────────────────
console.log('')
console.log('install:profile OK')
console.log('  profile:  ' + profileDir)
console.log('  installed: ' + (missing.length === 0 ? 'nothing (already installed)' : missing.map(entry => entry.label).join(', ')))
console.log('  next:')
console.log('    1. stop the running host for this profile, then start it again:')
console.log('       cd ' + checkout)
console.log('       pnpm dsh --profile ' + profileName + ' web --port <port>')
console.log('    2. create a new session and pick "PTC Hashline Mode".')
console.log('  rollback: restore package.json.bak-' + stamp + ' (and pnpm-lock.yaml.bak-' + stamp + ')')
