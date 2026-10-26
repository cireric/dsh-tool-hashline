/** Read resolved bytes, not just declared versions. No installs or provider I/O. */
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { release } from 'node:os'
import { protocolHash } from './protocol.mjs'
import { patchEvidence, HASHLINE_PATCH_MARKERS, TOOL_EDIT_PATCH_MARKERS, sha256File } from '../../presets/ptc-hashline/operations/baseline.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
export const ARMS = ['stock-edit', 'hashline-default', 'hashline-fallback']

export function armRows(rows, arm) {
  if (!ARMS.includes(arm)) throw new Error('unknown arm: ' + arm)
  const result = structuredClone(rows)
  const byId = id => result.find(row => row.id === id)
  if (!byId('tool-fs') || !byId('tool-edit') || !byId('tool-read')) throw new Error('missing filesystem preset rows')
  if (arm === 'stock-edit') {
    byId('tool-fs').config.read = true
    byId('tool-fs').config.edit = true
    return result.filter(row => !['tool-read', 'tool-edit'].includes(row.id))
  }
  // Same managed policy in both Hashline arms. Strict arm has no non-Hashline dispatch.
  byId('tool-edit').config.mode = arm === 'hashline-default' ? 'hashline' : 'auto'
  return result
}

export function captureIdentity(profile, providerPlugin) {
  const req = createRequire(join(resolve(profile), 'package.json'))
  const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-agent-loop-testkit', '@deepseek-ai/dsh-agent-preset-registry', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-ptc-runtime', '@deepseek-ai/dsh-tool-fs', '@dsh-tool-hashline/tool-read', '@dsh-tool-hashline/tool-edit', '@hy-sde-org/dsh-tool-edit', '@hy-sde-org/dsh-hashline']
  if (providerPlugin) names.push(providerPlugin)
  const critical = new Set([...names, '@deepseek-ai/dsh-session'])
  const modules = join(profile, 'node_modules')
  for (const item of readdirSync(modules)) {
    if (item.startsWith('.')) continue
    if (item.startsWith('@')) names.push(...readdirSync(join(modules, item)).map(child => item + '/' + child))
    else names.push(item)
  }
  const packages = Object.fromEntries([...new Set(names)].sort().map(name => {
    try {
      let manifest
      try { manifest = realpathSync(req.resolve(name + '/package.json')) }
      catch { manifest = realpathSync(join(modules, name, 'package.json')) } // some third-party export maps hide the manifest
      let entry
      try { entry = realpathSync(req.resolve(name)) } catch { entry = manifest } // composition-only packages have no JS main
      const runtimeFiles = {}
      const visit = (dir, prefix = '') => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          if (item.name === 'node_modules' || item.name === '.git') continue
          if (item.isSymbolicLink()) continue
          const relative = prefix + item.name, file = join(dir, item.name)
          if (item.isDirectory()) visit(file, relative + '/')
          else if (/\.(?:js|mjs|cjs|json|node|dll|so|dylib|ya?ml|md|txt)$/u.test(item.name)) runtimeFiles[relative] = sha256File(file)
        }
      }
      if (critical.has(name)) visit(dirname(manifest))
      return [name, { version: JSON.parse(readFileSync(manifest, 'utf8')).version, manifest, entry, entryHash: sha256File(entry), manifestHash: sha256File(manifest), runtimeHash: protocolHash(runtimeFiles) }]
    } catch { return [name, 'unknown'] }
  }))
  const bundle = dirname(req.resolve('dsh-tool-hashline/package.json'))
  const files = ['preset.patch.yml', 'intent-gate-watchdog.mjs', 'personas/orchestrator.md', 'policy/default-edit-policy.mjs']
  const resources = Object.fromEntries(files.map(file => [file, sha256File(join(bundle, 'presets/ptc-hashline', file))]))
  const inputs = Object.fromEntries(['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch', 'patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch', 'presets/ptc-hashline/policy/default-edit-policy.mjs', 'presets/ptc-hashline/policy/user-source.mjs'].map(file => [file, sha256File(join(repository, file))]))
  const profileInputs = Object.fromEntries(['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml'].map(file => [file, existsSync(join(profile, file)) ? sha256File(join(profile, file)) : 'absent']))
  const driverInputs = Object.fromEntries(readdirSync(join(repository, 'scripts/evaluation')).filter(f => f.endsWith('.mjs')).map(file => [file, sha256File(join(repository, 'scripts/evaluation', file))]))
  const engine = entry => realpathSync(createRequire(entry).resolve('@hy-sde-org/dsh-hashline'))
  const readEngine = engine(req.resolve('@dsh-tool-hashline/tool-read'))
  const editEngine = engine(req.resolve('@hy-sde-org/dsh-tool-edit'))
  return {
    environment: { node: process.version, platform: process.platform, osRelease: release(), arch: process.arch },
    packages, resources, inputs, profileInputs, driverInputs, readEngine, editEngine,
    patches: {
      hashline: patchEvidence(req, '@hy-sde-org/dsh-hashline', HASHLINE_PATCH_MARKERS),
      edit: patchEvidence(req, '@hy-sde-org/dsh-tool-edit', TOOL_EDIT_PATCH_MARKERS),
    },
  }
}

export function assertIdentity(expected, actual) {
  if (protocolHash(expected) !== protocolHash(actual)) throw new Error('EVAL_IDENTITY_DRIFT: resolved environment/configuration changed')
  if (actual.readEngine !== actual.editEngine) throw new Error('EVAL_ENGINE_IDENTITY: read/edit differ')
  if (Object.values(actual.packages).includes('unknown') || Object.values(actual.patches).some(p => p.status !== 'patched')) throw new Error('EVAL_IDENTITY_UNKNOWN: missing package or patch')
}
