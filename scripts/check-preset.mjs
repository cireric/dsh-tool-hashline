#!/usr/bin/env node
/**
 * Preset check: enforces the shape of the `ptc-hashline` preset and the
 * integrity of its two gate assets. Offline; no external copy is consulted.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const fail = (message) => failures.push(message)

const PRESET_ID = 'ptc-hashline'
const CAPS = { limit: 2000, maxLineLength: 2000, maxBytes: 51200 }
const EXPECTED_DIGESTS = {
  'personas/orchestrator.md': 'b60c1846157504db50514aae9ac8730a381bbc92c36d3dce7af07ade938d8c3e',
  'intent-gate-watchdog.mjs': 'a7c4b4aabfb8c32b4d44a03c0bc4168b7e05c42f56d3f9cb320c3e71b6800b50',
}

const read = relative => readFileSync(join(repo, relative), 'utf8')
const normalizeEndings = text => text.replace(/\r\n/gu, '\n')
const digest = text => createHash('sha256').update(normalizeEndings(text), 'utf8').digest('hex')
const parsePatch = relative => {
  const text = read(relative)
  const docs = parse(text.replace(/!!js\s+/gu, ''))
  if (!Array.isArray(docs)) throw new Error(relative + ': patch is not a YAML array')
  return { text, entries: docs.flatMap(doc => Array.isArray(doc?.insert) ? doc.insert : []) }
}

// ── manifest ─────────────────────────────────────────────────────────────────
const manifest = JSON.parse(read('package.json'))
if (manifest?.dsh?.bundle?.patch !== './presets/ptc-hashline/preset.patch.yml') {
  fail('dsh.bundle.patch must be ./presets/ptc-hashline/preset.patch.yml')
}
if (!existsSync(join(repo, 'presets/ptc-hashline/preset.patch.yml'))) fail('dsh.bundle.patch target is missing')
for (const subpath of ['./presets/*', './package.json']) {
  if (!(subpath in (manifest.exports ?? {}))) fail('package.json exports must expose ' + subpath)
}

// ── patch shape ─────────────────────────────────────────────────────────────
const ours = parsePatch('presets/ptc-hashline/preset.patch.yml')
const presets = ours.entries.filter(entry => entry?.config?.id === PRESET_ID)
if (presets.length !== 1) fail('expected exactly one preset with id "' + PRESET_ID + '", found ' + presets.length)
const preset = presets[0]
if (preset.id !== 'preset-ptc-hashline') fail('preset entry id must be preset-ptc-hashline')

const plugins = preset?.config?.plugins ?? []
const flattenRows = entries => entries.flatMap(entry => {
  const nested = Array.isArray(entry?.config) ? entry.config : entry?.config?.plugins ?? []
  return [entry, ...flattenRows(nested)]
})
const byId = new Map(flattenRows(plugins).map(entry => [entry?.id, entry]))
const ids = plugins.map(entry => entry?.id)
const require_ = (id, check) => {
  const entry = byId.get(id)
  if (entry === undefined) { fail('missing plugin row: ' + id); return }
  check?.(entry)
}

require_('tool-fs', entry => {
  const config = entry.config ?? {}
  if (config.read !== false) fail('tool-fs.read must be false (two read providers collide)')
  if (config.edit !== false) fail('tool-fs.edit must be false (tool-edit takes over)')
  for (const [key, value] of Object.entries(CAPS)) {
    if (config['read' + key[0].toUpperCase() + key.slice(1)] !== value) fail('tool-fs.read' + key[0].toUpperCase() + key.slice(1) + ' must be ' + value)
  }
})
require_('tool-read', entry => {
  if (entry.name !== '@dsh-tool-hashline/tool-read') fail('tool-read row must mount @dsh-tool-hashline/tool-read')
  for (const [key, value] of Object.entries(CAPS)) {
    if (entry.config?.[key] !== value) fail('tool-read.' + key + ' must be ' + value)
  }
  if (entry.config?.snapshotMaxBytes !== 4194304) fail('tool-read.snapshotMaxBytes must be 4194304')
  if (entry.config?.defaultEditPolicyGuidance !== true) fail('tool-read.defaultEditPolicyGuidance must be true for the managed preset')
  const stock = byId.get('tool-fs')?.config ?? {}
  for (const [key] of Object.entries(CAPS)) {
    const stockKey = 'read' + key[0].toUpperCase() + key.slice(1)
    if (stock[stockKey] !== entry.config?.[key]) fail('window cap drift: tool-fs.' + stockKey + ' !== tool-read.' + key)
  }
})
require_('tool-edit', entry => {
  if (entry.name !== '@dsh-tool-hashline/tool-edit') fail('tool-edit row must mount @dsh-tool-hashline/tool-edit')
  if (entry.config?.mode !== 'auto') fail('tool-edit.mode must be auto')
  // The default-edit policy is enabled HERE and nowhere else, and it must be
  // addressed through this bundle's own manifest: a packed install resolves it
  // from the install root, and a personal absolute path must never appear.
  const policy = String(entry.config?.contentPolicyModule?.__jsExpr ?? entry.config?.contentPolicyModule ?? '')
  if (policy === '') fail('tool-edit.contentPolicyModule must mount the default-edit policy (SRS 2026-10-24)')
  else {
    if (!policy.includes("resolve('dsh-tool-hashline/package.json')")) fail("the policy module must resolve through this bundle's manifest, not a personal path")
    if (!policy.includes("'presets', 'ptc-hashline', 'policy', 'default-edit-policy.mjs'")) fail("the policy module must point at this bundle's policy file")
  }
})
require_('tool-presentation', entry => {
  if (entry.config?.mode !== 'ptc') fail('tool-presentation.mode must be ptc')
})
require_('intent-gate-watchdog', entry => {
  if (entry.config?.gate !== 'enforce') fail('intent-gate-watchdog.gate must be enforce')
  if (entry.name !== 'dsh-tool-hashline/presets/ptc-hashline/intent-gate-watchdog.mjs') fail('watchdog must load from this bundle')
})
require_('tool-subagent', entry => {
  if (entry.config?.maxDepth !== 1) fail('tool-subagent.maxDepth must be 1')
})
const persona = byId.get('persona')
if (persona === undefined) fail('missing persona row')
else {
  const prefix = String(persona.config?.prefix ?? '')
  if (!prefix.includes("resolve('dsh-tool-hashline/package.json')")) fail("persona must resolve this bundle's package.json")
  if (!prefix.includes("'ptc-hashline', 'personas', 'orchestrator.md'")) fail("persona must read this bundle's orchestrator.md")
  const suffix = String(persona.config?.suffix ?? '')
  for (const match of suffix.matchAll(/\{\{(\w+)\}\}/gu)) {
    if (!['provider', 'model'].includes(match[1])) fail('persona suffix uses an unregistered prompt variable: ' + match[0])
  }
}

// The two delta rows are INSERTED immediately after tool-fs (§4.1 #2/#3).
const toolFsIndex = ids.indexOf('tool-fs')
if (toolFsIndex < 0 || ids[toolFsIndex + 1] !== 'tool-read' || ids[toolFsIndex + 2] !== 'tool-edit') {
  fail('tool-read and tool-edit must be inserted immediately after tool-fs')
}

// ── operations skills (this feature's explicit preset delta) ────────────────
// The two operations skills are delivered by a SECOND filesystem provider with
// its own name and ONE private root. The checks below are the contract that
// keeps the delta narrow: no default roots, no watcher, one root resolved
// through this bundle's own manifest, and both skills present with the
// user-only invocation policy. Everything else in the preset stays as it was.
const OPERATIONS_SKILLS = ['ptc-hashline-incident', 'ptc-hashline-upgrade']
const operations = byId.get('ptc-hashline-operations-skills')
if (operations === undefined) fail('missing operations skill provider row: ptc-hashline-operations-skills')
else {
  if (operations.name !== '@deepseek-ai/dsh-skill-filesystem') fail('operations provider must mount @deepseek-ai/dsh-skill-filesystem')
  const config = operations.config ?? {}
  if (config.providerName !== 'ptc-hashline-operations') fail('operations provider name must be ptc-hashline-operations (a second same-named provider collides)')
  if (config.includeDefaultRoots !== false) fail('operations provider must not add default roots')
  if (config.watch !== false) fail('operations provider must not watch the delivered skills')
  const dirs = Array.isArray(config.customSkillDirs) ? config.customSkillDirs : []
  if (dirs.length !== 1) fail('operations provider must declare exactly one custom skill root, found ' + dirs.length)
  for (const entry of dirs) {
    const expression = String(entry?.__jsExpr ?? entry ?? '')
    if (!expression.includes("resolve('dsh-tool-hashline/package.json')")) fail('operations skill root must resolve through this bundle\'s manifest, not a personal path')
    if (!expression.includes("'presets', 'ptc-hashline', 'skills'")) fail('operations skill root must point at this bundle\'s preset skills directory')
  }
  // The row must sit beside the general skill rows, after them.
  const toolSkillIndex = ids.indexOf('tool-skill')
  if (toolSkillIndex < 0 || ids.indexOf('ptc-hashline-operations-skills') < toolSkillIndex) {
    fail('operations provider must be inserted after the general skill rows')
  }
}
for (const skill of OPERATIONS_SKILLS) {
  const file = join('presets/ptc-hashline/skills', skill, 'SKILL.md')
  if (!existsSync(join(repo, file))) { fail('missing shipped skill body: ' + file); continue }
  // Normalize line endings: a Windows checkout hands back CRLF and the
  // frontmatter assertions below are anchored on \n like the digest helper.
  const text = read(file).replace(/\r\n/gu, '\n')
  if (!/^---\n/u.test(text)) fail(file + ' must start with YAML frontmatter')
  if (!/^disable-model-invocation:\s*true$/mu.test(text)) fail(file + ' must set disable-model-invocation: true')
  if (!/^user-invocable:\s*true$/mu.test(text)) fail(file + ' must set user-invocable: true')
  if (!/^name:\s*/mu.test(text)) fail(file + ' must declare a name')
  if (!/^description:\s*\S/mu.test(text)) fail(file + ' must declare a description')
}
// The operations runtime ships inside the bundle, so a packed install resolves
// it without a checkout: every module the skills and the maintenance entry
// reference must exist and use only Node builtins plus its own siblings.
for (const module of ['cli.mjs', 'context.mjs', 'config.mjs', 'baseline.mjs', 'session-log.mjs', 'incidents.mjs', 'upgrades.mjs', 'proposals.mjs', 'candidates.mjs', 'switch.mjs', 'text.mjs', 'sync.mjs', 'sync-hash.mjs', 'sync-yaml.mjs', 'sync-ptc.mjs', 'sync-read.mjs', 'sync-engines.mjs', 'sync-run.mjs', 'sync-history.mjs']) {
  const file = join('presets/ptc-hashline/operations', module)
  if (!existsSync(join(repo, file))) { fail('missing operations module: ' + file); continue }
  const text = read(file)
  for (const match of text.matchAll(/from '([^']+)'/gu)) {
    const specifier = match[1]
    if (specifier.startsWith('./')) continue
    if (!specifier.startsWith('node:')) fail(file + ' imports a non-builtin module: ' + specifier)
  }
}
// The policy module ships inside the bundle and is loaded from the install root,
// so it must exist and stay on the same builtin-only surface as the operations
// runtime: a policy that imported a host package would break a packed install.
const policyFile = join('presets/ptc-hashline/policy', 'default-edit-policy.mjs')
const userSourceFile = join('presets/ptc-hashline/policy', 'user-source.mjs')
if (!existsSync(join(repo, userSourceFile))) fail('missing user-source policy helper: ' + userSourceFile)
else {
  for (const match of read(userSourceFile).matchAll(/from '([^']+)'/gu)) {
    if (!match[1].startsWith('node:') && !match[1].startsWith('./')) fail(userSourceFile + ' imports a non-builtin module: ' + match[1])
  }
}
if (!existsSync(join(repo, policyFile))) fail('missing default-edit policy module: ' + policyFile)
else {
  const text = read(policyFile)
  for (const match of text.matchAll(/from '([^']+)'/gu)) {
    const specifier = match[1]
    if (specifier.startsWith('./')) continue
    if (!specifier.startsWith('node:')) fail(policyFile + ' imports a non-builtin module: ' + specifier)
  }
  for (const marker of ['createPolicy', 'snapshot-limit', 'window-limit', 'user-override']) {
    if (!text.includes(marker)) fail(policyFile + ' must declare ' + marker)
  }
}
// ── resources ───────────────────────────────────────────────────────────────
for (const [relative, expected] of Object.entries(EXPECTED_DIGESTS)) {
  const value = read(join('presets/ptc-hashline', relative))
  if (digest(value) !== expected) fail(relative + ' digest drifted: ' + digest(value))
}

// ── report ──────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('check:preset FAILED')
  for (const message of failures) console.error('  - ' + message)
  process.exit(1)
}
console.log('check:preset OK: ptc-hashline invariants hold, caps equal, gates enforced, resource digests verified')
