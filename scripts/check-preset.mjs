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
  'personas/orchestrator.md': '902cd50a0b0f2faafeff22a9d2bbacaf177b7dafb30b81d6727e242f6f403cd6',
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
  const stock = byId.get('tool-fs')?.config ?? {}
  for (const [key] of Object.entries(CAPS)) {
    const stockKey = 'read' + key[0].toUpperCase() + key.slice(1)
    if (stock[stockKey] !== entry.config?.[key]) fail('window cap drift: tool-fs.' + stockKey + ' !== tool-read.' + key)
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
