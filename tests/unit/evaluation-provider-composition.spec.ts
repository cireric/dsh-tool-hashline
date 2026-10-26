import { describe, it, expect } from 'vitest'
// @ts-expect-error plain ESM module
import { evaluationProviderPatches } from '../../scripts/evaluation/host.mjs'

describe('disposable provider composition', () => {
  it('disables the existing provider row and loads one explicitly configured replacement', () => {
    const config = { providers: { custom: { apiKeyEnv: 'KEY_ENV' } } }
    expect(evaluationProviderPatches([{ insert: [{ id: 'llm-pi-ai', name: 'provider' }, { id: 'other', name: 'other-provider' }] }], 'provider', config)).toEqual([
      { id: 'llm-pi-ai', disabled: true }, { insert: [{ id: 'eval-provider', name: 'provider', config }] },
    ])
  })
  it('adds absent fixture providers without disabling unrelated adapters', () => {
    expect(evaluationProviderPatches([{ insert: [{ id: 'existing', name: 'other' }] }], 'fixture', {})).toEqual([{ insert: [{ id: 'eval-provider', name: 'fixture', config: {} }] }])
  })
  it('detaches configuration and deduplicates disable patches', () => {
    const config = { providers: { custom: { apiKeyEnv: 'KEY_ENV' } } }
    const result = evaluationProviderPatches([{ insert: [{ id: 'same', name: 'provider' }, { id: 'same', name: 'provider' }] }], 'provider', config)
    expect(result).toHaveLength(2)
    result[1].insert[0].config.providers.custom.apiKeyEnv = 'OTHER'
    expect(config.providers.custom.apiKeyEnv).toBe('KEY_ENV')
  })
  it('refuses reserved IDs and unaddressable mounted provider rows', () => {
    expect(() => evaluationProviderPatches([{ insert: [{ id: 'eval-provider', name: 'other' }] }], 'provider', {})).toThrow('COLLISION')
    expect(() => evaluationProviderPatches([{ insert: [{ name: 'provider' }] }], 'provider', {})).toThrow('UNSUPPORTED')
  })
})
