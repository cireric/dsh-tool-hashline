#!/usr/bin/env node
/**
 * Preset drift check: verifies the shipped `ptc-hashline` patch against the
 * frozen `ptc-gate` baseline and the bundle's own resources.
 *
 * Allowed differences are exactly the three declared in
 * `preset/baseline/SOURCES.md`: preset display metadata, the tool-fs/tool-read/
 * tool-edit delta rows, and resource addresses (package.json + watchdog subpath).
 * Any other change, a digest mismatch, or unequal window caps fails the check
 * with a non-zero exit code and a reason. Offline: it never reads the source
 * project.
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
const BASELINE_COMMIT = '3d8f36eb8def861c3f2aa7d5f7b4983d96c92341'
const EXPECTED_DIGESTS = {
  'personas/orchestrator.md': 'ebd083fb4fdfbe1fed2bf9c4996ef7b93729ec816a527866e0d6f5ef3a950125',
  'intent-gate-watchdog.mjs': '566c462730d9b2569494dc67afe8f3f34ef8e4ea696dee0cb03f014687e69236',
}
const CAPS = { limit: 2000, maxLineLength: 2000, maxBytes: 51200 }

const digest = text => createHash('sha256').update(text, 'utf8').digest('hex')
const read = relative => readFileSync(join(repo, relative), 'utf8')
const parsePatch = relative => {
  const text = read(relative)
  // `!!js` expressions are opaque to this structural check; drop the tag so the
  // YAML parser sees plain scalars.
  const cleaned = text.replace(/!!js\s+/gu, '')
  const docs = parse(cleaned)
  if (!Array.isArray(docs)) throw new Error(relative + ': patch is not a YAML array')
  const insert = docs.flatMap(doc => Array.isArray(doc?.insert) ? doc.insert : [])
  return { text, entries: insert }
}

// ── manifest ─────────────────────────────────────────────────────────────────
const manifest = JSON.parse(read('package.json'))
const declared = manifest?.dsh?.bundle?.patch
if (declared !== './preset/ptc-hashline/preset.patch.yml') fail(`dsh.bundle.patch must be ./preset/ptc-hashline/preset.patch.yml, got ${JSON.stringify(declared)}`)
if (!existsSync(join(repo, 'preset/ptc-hashline/preset.patch.yml'))) fail('dsh.bundle.patch target is missing')
for (const subpath of ['./preset/*', './package.json']) {
  if (!(subpath in (manifest.exports ?? {}))) fail(`package.json exports must expose ${subpath} so the profile can resolve preset assets`)
}

// ── patch structure ──────────────────────────────────────────────────────────
const ours = parsePatch('preset/ptc-hashline/preset.patch.yml')
const baseline = parsePatch('preset/baseline/ptc-gate.preset.patch.yml')
const presets = ours.entries.filter(entry => entry?.config?.id === PRESET_ID)
if (presets.length !== 1) fail(`expected exactly one preset with id "${PRESET_ID}", found ${presets.length}`)
const preset = presets[0]
if (preset.id !== 'preset-ptc-hashline') fail('preset entry id must be preset-ptc-hashline')
if (!ours.text.includes(BASELINE_COMMIT)) fail('patch header must name the baseline commit ' + BASELINE_COMMIT)

const plugins = preset?.config?.plugins ?? []
/** Every row, including rows nested inside a group's `config.plugins`. */
const flattenRows = entries => entries.flatMap(entry => {
  const nested = Array.isArray(entry?.config) ? entry.config : entry?.config?.plugins ?? []
  return [entry, ...flattenRows(nested)]
})
const byId = new Map(flattenRows(plugins).map(entry => [entry?.id, entry]))
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
    if (config['read' + key[0].toUpperCase() + key.slice(1)] !== value) fail(`tool-fs.read${key[0].toUpperCase() + key.slice(1)} must be ${value}`)
  }
})
require_('tool-read', entry => {
  if (entry.name !== '@dsh-tool-hashline/tool-read') fail('tool-read row must mount @dsh-tool-hashline/tool-read')
  for (const [key, value] of Object.entries(CAPS)) {
    if (entry.config?.[key] !== value) fail(`tool-read.${key} must be ${value}`)
  }
  if (entry.config?.snapshotMaxBytes !== 4194304) fail('tool-read.snapshotMaxBytes must be 4194304')
  const stock = byId.get('tool-fs')?.config ?? {}
  for (const [key, value] of Object.entries(CAPS)) {
    const stockKey = 'read' + key[0].toUpperCase() + key.slice(1)
    if (stock[stockKey] !== entry.config?.[key]) fail(`window cap drift: tool-fs.${stockKey} !== tool-read.${key}`)
  }
})
require_('tool-edit', entry => {
  if (entry.name !== '@dsh-tool-hashline/tool-edit') fail('tool-edit row must mount @dsh-tool-hashline/tool-edit')
  if (entry.config?.mode !== 'auto') fail('tool-edit.mode must be auto')
})
require_('tool-presentation', entry => {
  if (entry.config?.mode !== 'ptc') fail('tool-presentation.mode must be ptc')
})
require_('intent-gate-watchdog', entry => {
  if (entry.config?.gate !== 'enforce') fail('intent-gate-watchdog.gate must be enforce')
  if (entry.name !== 'dsh-tool-hashline/preset/ptc-hashline/intent-gate-watchdog.mjs') {
    fail('watchdog must load from this bundle: dsh-tool-hashline/preset/ptc-hashline/intent-gate-watchdog.mjs, got ' + JSON.stringify(entry.name))
  }
})
require_('tool-subagent', entry => {
  if (entry.config?.maxDepth !== 1) fail('tool-subagent.maxDepth must be 1')
})
const persona = byId.get('persona')
if (persona === undefined) fail('missing persona row')
else {
  const prefix = String(persona.config?.prefix ?? '')
  if (!prefix.includes("resolve('dsh-tool-hashline/package.json')")) fail('persona must resolve this bundle\'s package.json')
  if (!prefix.includes("'ptc-hashline', 'personas', 'orchestrator.md'")) fail('persona must read this bundle\'s orchestrator.md')
}

// ── ordered plugin-list diff against the baseline ────────────────────────────
const baselineIds = baseline.entries[0]?.config?.plugins?.map(entry => entry?.id) ?? []
const oursIds = plugins.map(entry => entry?.id)
const allowedAdded = new Set(['tool-read', 'tool-edit'])
const stripped = oursIds.filter(id => !allowedAdded.has(id))
if (JSON.stringify(stripped) !== JSON.stringify(baselineIds)) {
  fail('plugin order/ids differ from the baseline beyond tool-read/tool-edit\n  baseline: ' + baselineIds.join(',') + '\n  ours: ' + oursIds.join(','))
}

const ALLOWED_CONFIG_DRIFT = new Set(['tool-fs', 'persona', 'intent-gate-watchdog'])
const baselineById = new Map((baseline.entries[0]?.config?.plugins ?? []).map(entry => [entry?.id, entry]))
for (const id of baselineIds) {
  if (ALLOWED_CONFIG_DRIFT.has(id) || allowedAdded.has(id)) continue
  const before = baselineById.get(id)
  const after = byId.get(id)
  if (JSON.stringify(before) !== JSON.stringify(after)) fail('row "' + id + '" changed beyond the allowed deltas')
}
for (const id of ['tool-read', 'tool-edit']) {
  if (baselineById.has(id)) fail('row "' + id + '" is not a declared delta (already in baseline)')
}

// ── resources ────────────────────────────────────────────────────────────────
for (const [relative, expected] of Object.entries(EXPECTED_DIGESTS)) {
  const path = join(repo, 'preset/ptc-hashline', relative)
  const value = readFileSync(path, 'utf8')
  if (digest(value) !== expected) fail(`${relative} digest drifted: ${digest(value)}`)
  const baselineCopy = readFileSync(join(repo, 'preset/baseline', relative.split('/').at(-1)), 'utf8')
  if (value !== baselineCopy) fail(`${relative} is not byte-identical to preset/baseline/`)
}

// ── report ───────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error('check:preset FAILED')
  for (const message of failures) console.error('  - ' + message)
  process.exit(1)
}
console.log('check:preset OK: ptc-hashline matches the frozen ptc-gate baseline (allowed deltas only), caps equal, resources verified')
