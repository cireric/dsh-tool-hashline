import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMIT, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_LENGTH, DEFAULT_SNAPSHOT_MAX_BYTES, resolveConfig } from '../../src/config.ts'

describe('resolveConfig', () => {
  it('mirrors the host defaults', () => {
    expect(resolveConfig()).toEqual({
      enabled: true,
      defaultEditPolicyGuidance: false,
      snapshotMaxBytes: 4_194_304,
      maxBytes: 51_200,
      limit: 2000,
      maxLineLength: 2000,
    })
    expect([DEFAULT_LIMIT, DEFAULT_MAX_LINE_LENGTH, DEFAULT_MAX_BYTES, DEFAULT_SNAPSHOT_MAX_BYTES]).toEqual([2000, 2000, 51_200, 4_194_304])
  })

  it('accepts explicit values, including enabled:false', () => {
    expect(resolveConfig({ enabled: false, defaultEditPolicyGuidance: true, limit: 10, maxLineLength: 20, maxBytes: 30, snapshotMaxBytes: 40 })).toEqual({
      enabled: false,
      defaultEditPolicyGuidance: true,
      limit: 10,
      maxLineLength: 20,
      maxBytes: 30,
      snapshotMaxBytes: 40,
    })
  })

  it.each([
    ['limit', 0],
    ['limit', 1.5],
    ['limit', Number.NaN],
    ['limit', Number.POSITIVE_INFINITY],
    ['maxLineLength', -1],
    ['maxBytes', 0],
    ['snapshotMaxBytes', Number.NaN],
  ] as const)('rejects %s = %s and names the config key', (key, value) => {
    expect(() => resolveConfig({ [key]: value })).toThrow(`tool-read config "${key}" must be a finite positive integer`)
  })
})
