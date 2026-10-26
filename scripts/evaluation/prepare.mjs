/** Turn editable experiment settings + actual installation identity into a frozen protocol. No model I/O. */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { freezeProtocol, protocolHash } from './protocol.mjs'
import { captureIdentity } from './identity.mjs'
import { captureTools } from './host.mjs'

export function experimentProvider(config) {
  const provider = config?.provider
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new Error('provider must declare plugin, credentialEnv and config')
  for (const field of ['plugin', 'credentialEnv']) if (typeof provider[field] !== 'string' || !provider[field].trim()) throw new Error('provider.' + field + ' must be non-empty')
  if (!provider.config || typeof provider.config !== 'object' || Array.isArray(provider.config)) throw new Error('provider.config must be an object')
  if (provider.plugin === '@deepseek-ai/dsh-llm-pi-ai') {
    const route = provider.config.providers?.[config.model?.provider]
    if (!route || typeof route !== 'object' || Array.isArray(route)) throw new Error('provider.config.providers must contain model.provider route')
    if (route.apiKeyEnv !== undefined && route.apiKeyEnv !== provider.credentialEnv) throw new Error('selected route apiKeyEnv must equal provider.credentialEnv')
    if (Object.hasOwn(route, 'baseURL')) {
      let endpoint
      try { if (typeof route.baseURL !== 'string' || !route.baseURL.trim()) throw new Error(); endpoint = new URL(route.baseURL) } catch { throw new Error('selected provider baseURL must be an absolute HTTP(S) URL') }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash || [...endpoint.searchParams.keys()].some(k => /key|token|secret|password|authorization/iu.test(k))) throw new Error('selected provider baseURL must use HTTP(S) without embedded credentials or fragment')
    }
    if (route.models !== undefined) {
      if (!Array.isArray(route.models) || !route.models.length || route.models.some(m => typeof m?.id !== 'string' || !m.id.trim()) || new Set(route.models.map(m => m.id)).size !== route.models.length) throw new Error('selected provider models must have distinct non-empty ids')
      if (typeof config.model?.model === 'string' && !route.models.some(m => m.id === config.model.model)) throw new Error('model.model must match a selected provider models[].id')
      for (const model of route.models) for (const key of ['contextWindow', 'maxTokens']) if (Object.hasOwn(model, key) && (!Number.isSafeInteger(model[key]) || model[key] < 1)) throw new Error('selected provider model.' + key + ' must be positive')
    }
  }
  return provider
}

export function buildExperiment(config, identity, now = new Date().toISOString()) {
  experimentProvider(config)
  const { provider, ...body } = config
  for (const field of ['tools', 'dependencies', 'protocolHash', 'frozenAt']) {
    if (field in body) throw new Error(field + ' is generated; remove it from the editable config')
  }
  if (identity.tools.providerPlugin !== provider.plugin || identity.tools.credentialEnv !== provider.credentialEnv || protocolHash(identity.tools.providerConfig) !== protocolHash(provider.config)) throw new Error('provider configuration differs from captured identity')
  return freezeProtocol({ ...body, createdAt: body.createdAt ?? now, dependencies: identity.dependencies, tools: identity.tools })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [configPath, profileArg, out, ...extra] = process.argv.slice(2)
  try {
    if (!configPath || !profileArg || !out || extra.length) throw new Error('usage: prepare.mjs <experiment.json> <disposable-profile> <new-frozen.json>')
    const config = JSON.parse(readFileSync(configPath, 'utf8')), provider = experimentProvider(config), profile = path.resolve(profileArg)
    if (JSON.parse(readFileSync(path.join(profile, 'package.json'), 'utf8')).name !== 'dsh-profile-acceptance') throw new Error('disposable acceptance profile required')
    const identity = { dependencies: captureIdentity(profile, provider.plugin), tools: await captureTools(profile, provider.plugin, provider.credentialEnv, provider.config) }
    const frozen = buildExperiment(config, identity)
    writeFileSync(out, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' })
    console.log('frozen ' + out + ' (' + frozen.protocolHash.slice(0, 12) + '); no model requests made')
  } catch (error) { console.error('prepare refused: ' + error.message); process.exitCode = 2 }
}
