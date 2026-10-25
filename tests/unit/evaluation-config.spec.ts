import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM evaluation module
import { buildExperiment, experimentProvider } from '../../scripts/evaluation/prepare.mjs'
// @ts-expect-error plain ESM evaluation module
import { assertFrozenProtocol } from '../../scripts/evaluation/protocol.mjs'

const example = () => JSON.parse(readFileSync(new URL('../../scripts/evaluation/experiment.example.json', import.meta.url), 'utf8'))
const identity = (config: ReturnType<typeof example>) => ({
  dependencies: { packages: {}, patches: {}, resources: {}, inputs: {}, profileInputs: {}, driverInputs: {}, environment: {}, readEngine: 'fixture', editEngine: 'fixture' },
  tools: { providerPlugin: config.provider.plugin, credentialEnv: config.provider.credentialEnv, providerConfig: config.provider.config, presetHash: 'fixture', arms: Object.fromEntries(config.comparison.map((arm: string) => [arm, 'fixture'])) },
})
const configured = () => {
  const config = example()
  config.model.model = 'user-selected-model'
  config.budget.maxModelRequests = 12
  config.budget.maxTotalTokens = 10000
  config.passConditions.minFirstCandidateCorrect = 1
  config.passConditions.maxTotalTokensPerTask = 3000
  return config
}

describe('editable model experiment configuration', () => {
  it('requires the user to fill model, budget and thresholds instead of silently selecting them', () => {
    const config = example()
    expect(() => buildExperiment(config, identity(config))).toThrow('model.model')
    expect(config.model.model).toBeNull()
    expect(config.budget.maxTotalTokens).toBeNull()
  })
  it('combines custom settings with installation evidence and freezes a detached protocol', () => {
    const config = configured(), frozen = buildExperiment(config, identity(config), '2026-10-25T00:00:00Z')
    expect(assertFrozenProtocol(frozen)).toBe(frozen)
    expect(frozen.model.model).toBe('user-selected-model')
    expect(frozen.tools.providerConfig.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
    expect(frozen.provider).toBeUndefined()
    config.model.model = 'another-model'
    expect(frozen.model.model).toBe('user-selected-model')
  })
  it('refuses generated-field overrides, provider drift and inline credentials', () => {
    const config = configured()
    expect(() => buildExperiment({ ...config, tools: {} }, identity(config))).toThrow('generated')
    expect(() => buildExperiment(config, { ...identity(config), tools: { ...identity(config).tools, providerPlugin: 'different' } })).toThrow('differs')
    config.provider.config.apiKey = 'fixture-secret'
    expect(() => buildExperiment(config, identity(config))).toThrow('literal credentials')
    expect(() => experimentProvider({ provider: [] })).toThrow('provider')
  })
})
