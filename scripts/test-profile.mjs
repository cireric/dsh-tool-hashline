#!/usr/bin/env node
/**
 * Clean-profile acceptance for the `ptc-hashline` bundle.
 *
 * Builds the workspace, installs the bundle into a throwaway DSH profile that
 * has never seen `ptc-roles`, registers it in `dsh.profile.bundles`, asks the
 * real `dsh` launcher to compose the profile (`--dump-config`), and finally
 * runs a read→edit through the profile-installed, built packages on disk.
 *
 * Fails non-zero with a reason on any step. No API key and no network model are
 * needed; the model-facing PTC leg lives in `pnpm test:ptc`.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dshCli = (() => {
  if (process.env.DSH_CLI) return process.env.DSH_CLI
  // Portable default: the DSH checkout this workspace sits beside.
  const sibling = resolve(repo, '..', '..', 'deepseek-harness', 'apps', 'cli', 'lib', 'bin.js')
  return existsSync(sibling) ? sibling : undefined
})()
const gaps = []
const root = join(repo, '.tmp', 'profile-' + Date.now())
const home = join(root, 'dsh-home')
const profileDir = join(home, 'profiles', 'ptc-hashline')
const failures = []
const step = message => console.log('== ' + message)
const fail = message => { failures.push(message); console.error('  x ' + message) }
const gap = message => { gaps.push(message); console.log('  GAP ' + message) }
const ok = message => console.log('  ok ' + message)

const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: options.cwd ?? repo, encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, ...options.env } })

try {
  step('build workspace')
  run(PNPM, ['build'], { stdio: 'inherit' })
  for (const pkg of ['hashline', 'tool-edit', 'tool-read']) {
    if (!existsSync(join(repo, 'packages', pkg, 'dist', 'index.js'))) fail('missing build output for ' + pkg)
  }
  if (failures.length > 0) throw new Error('build incomplete')

  step('create clean profile at ' + profileDir)
  mkdirSync(profileDir, { recursive: true })
  const link = relative => 'link:' + join(repo, relative).replaceAll('\\', '/')
  const manifest = {
    name: 'dsh-profile-ptc-hashline',
    private: true,
    dependencies: {
      'dsh-tool-hashline': link('.'),
      '@dsh-tool-hashline/hashline': link('packages/hashline'),
      '@dsh-tool-hashline/tool-read': link('packages/tool-read'),
      '@dsh-tool-hashline/tool-edit': link('packages/tool-edit'),
      '@deepseek-ai/cordis': '4.0.5-alpha.2',
      '@deepseek-ai/dsh-tools': '0.2.1-rc.2',
      '@deepseek-ai/dsh-fs': '0.2.1-rc.2',
      '@deepseek-ai/dsh-fs-local': '0.2.1-rc.2',
      '@deepseek-ai/dsh-system-prompt': '0.2.1-rc.2',
    },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-tool-hashline'] } },
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), ['packages:', '  - .', '', 'nodeLinker: hoisted', 'autoInstallPeers: false', 'strictDepBuilds: false', 'ignoredBuiltDependencies:', '  - koffi', '  - esbuild', ''].join('\n'))
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  // A stale copy from a previous run must never satisfy the checks.
  if (existsSync(join(profileDir, 'node_modules', 'dsh-tool-hashline'))) rmSync(join(profileDir, 'node_modules'), { recursive: true, force: true })

  step('pnpm install in the profile')
  try {
    run(PNPM, ['install'], { cwd: profileDir, timeout: 300_000 })
    ok('installed')
  } catch (error) {
    fail('pnpm install failed: ' + String(error.stdout ?? error.message).slice(-800))
    throw new Error('install failed')
  }

  step('resolve the bundle and its assets from the profile')
  const require_ = createRequire(join(profileDir, 'package.json'))
  const resolveOrFail = (spec, label) => {
    try { const hit = require_.resolve(spec); ok(label + ' -> ' + hit); return hit }
    catch (error) { fail(label + ' does not resolve: ' + error.message); return undefined }
  }
  const bundleManifestPath = resolveOrFail('dsh-tool-hashline/package.json', 'bundle package.json')
  const watchdogPath = resolveOrFail('dsh-tool-hashline/presets/ptc-hashline/intent-gate-watchdog.mjs', 'watchdog module')
  const readEntry = resolveOrFail('@dsh-tool-hashline/tool-read', 'tool-read entry')
  const editEntry = resolveOrFail('@dsh-tool-hashline/tool-edit', 'tool-edit entry')
  const bundleManifest = bundleManifestPath === undefined ? {} : JSON.parse(readFileSync(bundleManifestPath, 'utf8'))
  if (bundleManifest?.dsh?.bundle?.patch !== './presets/ptc-hashline/preset.patch.yml') fail('bundle manifest does not declare the preset patch')
  if (!bundleManifestPath?.includes('node_modules') && !bundleManifestPath?.includes('dsh-tool-hashline')) fail('bundle resolved outside the profile: ' + bundleManifestPath)
  if (readEntry === undefined || editEntry === undefined) throw new Error('plugin packages do not resolve')

  // FR-8: both sides must reach one physical hashline module inside this profile.
  const fromRead = realpathSync(createRequire(readEntry).resolve('@hy-sde-org/dsh-hashline'))
  const fromEdit = realpathSync(createRequire(createRequire(editEntry).resolve('@hy-sde-org/dsh-tool-edit/package.json')).resolve('@hy-sde-org/dsh-hashline'))
  if (fromRead !== fromEdit) fail('two hashline module instances in the profile: ' + fromRead + ' vs ' + fromEdit)
  else ok('one physical hashline instance for read and edit')

  // Same version numbers are not evidence that a local patch loaded. Read the
  // resolved files this profile actually imports and look for the patch markers.
  const hashlinePkg = realpathSync(createRequire(readEntry).resolve('@hy-sde-org/dsh-hashline/package.json'))
  const editorPkg = realpathSync(createRequire(editEntry).resolve('@hy-sde-org/dsh-tool-edit/package.json'))
  ok('resolved hashline package -> ' + hashlinePkg)
  ok('resolved tool-edit package -> ' + editorPkg)
  const patchMarkers = [
    [join(dirname(hashlinePkg), 'dist', 'patcher.js'), 'authorizes the snapshot migration', 'hashline MV relocates the snapshot only after the disk move'],
    [join(dirname(editorPkg), 'dist', 'session.js'), "const intent = { kind: 'createIfAbsent' }", 'tool-edit MV creates its target through createIfAbsent'],
  ]
  for (const [markerFile, marker, label] of patchMarkers) {
    const text = existsSync(markerFile) ? readFileSync(markerFile, 'utf8') : ''
    if (!text.includes(marker)) fail('local patch is not in the resolved build: ' + label + ' (' + markerFile + ')')
    else ok('patch marker present: ' + label)
  }
  // The repository lockfile must register both patches, not just the version.
  const lockfile = readFileSync(join(repo, 'pnpm-lock.yaml'), 'utf8')
  for (const packageName of ['@hy-sde-org/dsh-hashline@0.2.1-alpha.4', '@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4']) {
    const registered = new RegExp("'" + packageName.replaceAll('/', '\\/') + "\\(patch_hash=", 'u').test(lockfile)
    if (!registered) fail('lockfile does not register a patch hash for ' + packageName)
    else ok('lockfile registers a patch hash for ' + packageName)
  }

  step('compose the profile with the real dsh launcher (--dump-config)')
  let dump = ''
  if (dshCli === undefined) {
    gap('dsh CLI not found; set DSH_CLI to <dsh>/apps/cli/lib/bin.js to run the composition check')
  } else try {
    dump = run(process.execPath, [dshCli, '--profile', 'ptc-hashline', '--dump-config'], { env: { DSH_HOME: home }, timeout: 180_000 })
    ok('dsh --dump-config exited 0')
  } catch (error) {
    fail('dsh --dump-config failed: ' + String(error.stdout ?? '') + String(error.stderr ?? error.message).slice(-800))
  }
  const presetHits = (dump.match(/(^|[^\w-])ptc-hashline([^\w-]|$)/gu) ?? []).length
  if (presetHits === 0) fail('composed profile does not mention the ptc-hashline preset')
  if (dump.includes('ptc-gate')) fail('composed profile still references the retired ptc-gate preset')
  for (const needle of ['@dsh-tool-hashline/tool-read', '@dsh-tool-hashline/tool-edit', 'intent-gate-watchdog']) {
    if (!dump.includes(needle)) fail('composed profile is missing ' + needle)
    else ok('composed profile carries ' + needle)
  }

  step('read -> PUT -> read -> MV -> read -> REM through the profile-installed build, policy mounted')
  const driver = join(profileDir, 'read-edit.mjs')
  writeFileSync(driver, `import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolRead from '@dsh-tool-hashline/tool-read'
import * as ToolEdit from '@dsh-tool-hashline/tool-edit'

const dir = mkdtempSync(join(tmpdir(), 'ptc-hashline-profile-'))
const file = join(dir, 'target.txt')
writeFileSync(file, 'one\\ntwo\\nthree\\n')
const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(LocalFileSystem, { cwd: dir })
// The deployment mounts this policy; without it an MV can look green here and
// still be rejected in a real session (the original regression).
await ctx.plugin(FsPolicy)
ctx.provide('workingDirectory', { defaultDirectory: dir, get: session => session.header?.cwd ?? dir, ensure: agent => Promise.resolve(agent.session.header?.cwd ?? dir) })
const runtime = new ToolRuntime(ctx)
await ctx.plugin(ToolRead, {})
await ctx.plugin(ToolEdit, { mode: 'auto' })
const session = { cwd: dir, header: { cwd: dir } }
const agent = { session }
const signal = new AbortController().signal
const read = await runtime.execute({ callId: 'c1', name: 'read', arguments: { file_path: 'target.txt' }, signal, agent })
if (read.isError) throw new Error('read failed: ' + read.error.message)
const tag = read.value.tag
if (typeof tag !== 'string' || !/^[0-9A-F]{4}$/u.test(tag)) throw new Error('read did not mint a tag: ' + JSON.stringify(read.value))
// 1) relative header PUT through the profile-installed edit.
const put = await runtime.execute({ callId: 'c2', name: 'edit', arguments: { input: '[' + read.value.path + '#' + tag + ']\\nPUT 2.=2:\\n+TWO' }, signal, agent })
if (put.isError) throw new Error('put failed: ' + put.error.message)
const afterPut = readFileSync(file, 'utf8')
if (afterPut !== 'one\\nTWO\\nthree\\n') throw new Error('disk text after PUT unexpected: ' + JSON.stringify(afterPut))
// 2) relative MV to a target this session never observed, under the real policy.
const reread = await runtime.execute({ callId: 'c3', name: 'read', arguments: { file_path: 'target.txt' }, signal, agent })
if (reread.isError) throw new Error('re-read failed: ' + reread.error.message)
const mv = await runtime.execute({ callId: 'c4', name: 'edit', arguments: { input: '[' + reread.value.path + '#' + reread.value.tag + ']\\nMV moved.txt' }, signal, agent })
if (mv.isError) throw new Error('mv failed: ' + mv.error.message)
if (existsSync(file)) throw new Error('the source survived the move: ' + file)
// 3) read the moved target, then REM it.
const movedRead = await runtime.execute({ callId: 'c5', name: 'read', arguments: { file_path: 'moved.txt' }, signal, agent })
if (movedRead.isError) throw new Error('read of the moved file failed: ' + movedRead.error.message)
const disk = readFileSync(join(dir, 'moved.txt'), 'utf8')
if (disk !== 'one\\nTWO\\nthree\\n') throw new Error('disk text after MV unexpected: ' + JSON.stringify(disk))
const rem = await runtime.execute({ callId: 'c6', name: 'edit', arguments: { input: '[' + movedRead.value.path + '#' + movedRead.value.tag + ']\\nREM' }, signal, agent })
if (rem.isError) throw new Error('rem failed: ' + rem.error.message)
if (existsSync(join(dir, 'moved.txt'))) throw new Error('REM left the moved file in place')
console.log(JSON.stringify({ tag, path: read.value.path, disk, moved: true, removed: true }))
`)
  try {
    const out = run(process.execPath, [driver], { cwd: profileDir, timeout: 120_000 })
    const result = JSON.parse(out.trim().split('\n').at(-1))
    ok('read minted #' + result.tag + ', relative PUT wrote, MV landed and REM removed: ' + JSON.stringify(result.disk))
  } catch (error) {
    fail('profile read->MV->read->edit failed: ' + String(error.stdout ?? '') + String(error.stderr ?? error.message).slice(-800))
  }

  step('intent gate over the profile-installed watchdog asset')
  const gateDriver = join(profileDir, 'gate.mjs')
  writeFileSync(gateDriver, `import { Context } from '@deepseek-ai/cordis'
import * as Watchdog from ${JSON.stringify(pathToFileURL(watchdogPath ?? '').href)}

const allow = () => Promise.resolve({ kind: 'allow' })
const session = { id: 'gate-check', header: { cwd: process.cwd() }, append: () => 1 }
async function decisionFor(text) {
  const ctx = new Context()
  await ctx.plugin(Watchdog, { gate: 'enforce' })
  const agent = { ctx, session, options: {} }
  await ctx.waterfall('agent/pre-step', {
    agent,
    messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] }],
    turn: 1,
    step: 1,
  }, () => Promise.resolve({ kind: 'enter', messages: [] }))
  ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } })
  ctx.emit('session/event', session, { type: 'assistant/message', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text }] } } })
  ctx.emit('session/event', session, { type: 'tool/call', data: { turn: 1, step: 1, callId: 'root-1', name: 'run_code', arguments: '{}' } })
  ctx.emit('session/event', session, { type: 'tool/ptc-dispatch-start', data: { rootCallId: 'root-1', name: 'edit' } })
  const decision = await ctx.waterfall('tools/pre-execute', { name: 'edit', agent, parent: {} }, allow)
  await ctx.fiber.dispose()
  return decision
}
const denied = await decisionFor('I will edit the file now.')
if (denied.kind !== 'deny' || !String(denied.reason).includes('Intent')) {
  throw new Error('gate did not deny a missing intent line: ' + JSON.stringify(denied))
}
const allowed = await decisionFor('Intent: fix — adjust the file; I will patch it.')
if (allowed.kind !== 'allow') throw new Error('gate denied a valid intent line: ' + JSON.stringify(allowed))
console.log(JSON.stringify({ denied: denied.kind, allowed: allowed.kind }))
`)
  try {
    const out = run(process.execPath, [gateDriver], { cwd: profileDir, timeout: 120_000 })
    const result = JSON.parse(out.trim().split('\n').at(-1))
    ok('gate denied without a line and allowed with one: ' + JSON.stringify(result))
  } catch (error) {
    fail('profile gate check failed: ' + String(error.stdout ?? '') + String(error.stderr ?? error.message).slice(-800))
  }
} catch (error) {
  if (failures.length === 0) fail(String(error?.stack ?? error))
} finally {
  if (!process.env.DSH_KEEP_PROFILE) rmSync(root, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error('test:profile FAILED')
  for (const message of failures) console.error('  - ' + message)
  process.exit(1)
}
console.log('test:profile OK: clean profile installs the bundle, composes one ptc-hashline preset, resolves read/edit/persona/watchdog, both local patches are present in the resolved builds, and read -> PUT -> read -> MV -> read -> REM lands under the observation policy' + (gaps.length > 0 ? ` (${gaps.length} gap(s) reported above)` : ''))
