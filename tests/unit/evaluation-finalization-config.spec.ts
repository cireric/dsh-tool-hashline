import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain ESM module
import { finalizationConfig } from '../../scripts/evaluation/finalization-config.mjs'
// @ts-expect-error plain ESM module
import { buildExperiment, experimentProvider } from '../../scripts/evaluation/prepare.mjs'
// @ts-expect-error plain ESM module
import { REQUIRED_TASK_FAMILIES } from '../../scripts/evaluation/protocol.mjs'
// @ts-expect-error plain ESM module
import { defaultTasks } from '../../scripts/evaluation/task-suite.mjs'

const settings = () => {
  const c = JSON.parse(readFileSync(new URL('../../scripts/evaluation/experiment.gateway.example.json', import.meta.url), 'utf8'))
  c.provider.config.providers['custom-gateway'].baseURL = 'https://example.invalid/v1'
  c.provider.config.providers['custom-gateway'].models[0].id = 'custom-model'
  c.provider.config.providers['custom-gateway'].models[0].contextWindow = 262144
  c.model.model = 'custom-model'
  c.budget.maxModelRequests = 300; c.budget.maxTotalTokens = 100000
  c.passConditions.minFirstCandidateCorrect = 1; c.passConditions.maxTotalTokensPerTask = 10000
  return c
}
const identity = (c: ReturnType<typeof settings>) => ({
  dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  tools: { providerPlugin: c.provider.plugin, credentialEnv: c.provider.credentialEnv, providerConfig: c.provider.config, presetHash: 'fixture', arms: Object.fromEntries(c.comparison.map((arm: string) => [arm, 'fixture'])) },
})

describe('bounded finalization configuration and user gateway', () => {
  it('keeps endpoint, selected route and model explicit and freezes the upstream provider configuration', () => {
    const c = settings(), p = buildExperiment(c, identity(c))
    expect(p.tools.providerConfig.providers['custom-gateway'].baseURL).toBe('https://example.invalid/v1')
    expect(p.model.model).toBe('custom-model')
    expect(p.tools.providerConfig.providers['custom-gateway'].apiKeyEnv).toBe('EVAL_API_KEY')
  })
  it('leaves all real connection and budget decisions unfilled in the gateway template', () => {
    const c = JSON.parse(readFileSync(new URL('../../scripts/evaluation/experiment.gateway.example.json', import.meta.url), 'utf8'))
    expect(c.model.model).toBeNull(); expect(c.provider.config.providers['custom-gateway'].baseURL).toBeNull()
    expect(c.budget.maxModelRequests).toBeNull(); expect(c.budget.maxTotalTokens).toBeNull()
    expect(() => buildExperiment(c, identity(c))).toThrow()
  })
  it.each(['route', 'credential', 'model', 'capacity', 'duplicate-model'])('rejects inconsistent %s before capture or execution', kind => {
    const c = settings(), route = c.provider.config.providers['custom-gateway']
    if (kind === 'route') c.model.provider = 'other'
    if (kind === 'credential') route.apiKeyEnv = 'OTHER_KEY'
    if (kind === 'model') c.model.model = 'other'
    if (kind === 'capacity') route.models[0].contextWindow = null
    if (kind === 'duplicate-model') route.models.push({ ...route.models[0] })
    expect(() => experimentProvider(c)).toThrow()
  })
  it.each(['', 'example.com', 'file:///tmp/key', 'https://user:password@example.com', 'https://example.com/?api_key=secret', 'https://example.com/?api_token=secret', 'https://example.com/#fragment'])('rejects invalid or credential-bearing endpoint %s', baseURL => {
    const c = settings(); c.provider.config.providers['custom-gateway'].baseURL = baseURL
    expect(() => experimentProvider(c)).toThrow()
  })
  it('preserves existing installed-catalog pi-ai routes without forcing a custom model catalog', () => {
    const c = settings(); c.provider.config.providers['custom-gateway'] = { apiKeyEnv: 'EVAL_API_KEY' }
    expect(() => experimentProvider(c)).not.toThrow()
  })
  it('permits numeric model capacity without weakening literal-credential rejection', () => {
    const c = settings(), route = c.provider.config.providers['custom-gateway']
    route.defaultMaxTokens = 4096
    expect(() => buildExperiment(c, identity(c))).not.toThrow()
    route.apiKey = 'forbidden'
    expect(() => buildExperiment(c, identity(c))).toThrow('literal credentials')
    delete route.apiKey; route.defaultMaxTokens = 'forbidden'
    expect(() => buildExperiment(c, identity(c))).toThrow('literal credentials')
  })
  it.each(['max_tokens', 'max_completion_tokens'])('freezes the upstream output-cap field spelling %s', maxTokensField => {
    const c = settings(), model = c.provider.config.providers['custom-gateway'].models[0]
    model.compat = { maxTokensField }
    expect(buildExperiment(c, identity(c)).tools.providerConfig.providers['custom-gateway'].models[0].compat.maxTokensField).toBe(maxTokensField)
  })
  it.each(['credential-value', null, { apiKey: 'forbidden' }])('does not exempt arbitrary token-field values %j', maxTokensField => {
    const c = settings(), model = c.provider.config.providers['custom-gateway'].models[0]
    model.compat = { maxTokensField }
    expect(() => buildExperiment(c, identity(c))).toThrow('literal credentials')
  })
  it('authors S0 as nine planned ordinary samples, preserving connection settings without executing', () => {
    const c = settings()
    delete c.editPayloadVersion
    const p = finalizationConfig(c, 'probe')
    expect(p.editPayloadVersion).toBe(2)
    expect(p.tasks.map((t: { id: string }) => t.id)).toEqual(['single', 'repeated', 'multi'])
    expect(p.samples.repetitions * p.tasks.length * p.comparison.length).toBe(9)
    expect(p.model).toEqual(c.model); expect(p.provider).toEqual(c.provider)
    expect(p.requestEvidence).toEqual({ version: 1 })
    expect(() => buildExperiment(p, identity(p))).not.toThrow()
  })
  it('authors formal family coverage and prospective first scope while retaining staged, conflict and exception final targets', () => {
    const p = finalizationConfig(settings(), 'formal'), frozen = buildExperiment(p, identity(p))
    expect(frozen.tasks.map((t: { family: string }) => t.family)).toEqual(REQUIRED_TASK_FAMILIES)
    expect(frozen.tasks).toEqual(defaultTasks())
    expect(frozen.samples.repetitions * frozen.tasks.length * frozen.comparison.length).toBe(117)
    expect(frozen.passConditions.firstCandidateScope.include).toEqual(['single', 'repeated', 'multi', 'unrelated-long', 'rewrite'])
    expect(frozen.passConditions.firstCandidateScope.exclude).toHaveLength(8)
    expect(frozen.passConditions.firstCandidateScope.exclude.map((e: { taskId: string }) => e.taskId)).toContain('consecutive')
    expect(frozen.passConditions.firstCandidateScope.exclude.map((e: { taskId: string }) => e.taskId)).toContain('drift')
  })
  it('rejects generated identity reuse and does not silently select missing user budgets', () => {
    expect(() => finalizationConfig({ ...settings(), tools: {} }, 'probe')).toThrow()
    expect(() => finalizationConfig(settings(), 'invalid')).toThrow()
    const c = settings(); c.budget.maxTotalTokens = null
    const p = finalizationConfig(c, 'formal')
    expect(p.budget.maxTotalTokens).toBeNull()
    expect(() => buildExperiment(p, identity(p))).toThrow()
  })
})
