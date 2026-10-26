import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { enginePinsFromAnchors } from '../../scripts/delivery-acceptance.mjs'

const engine = (version: string) => ({ dependencies: { '@hy-sde-org/dsh-hashline': version } })
const edit = (version: string) => ({ dependencies: { '@hy-sde-org/dsh-tool-edit': version } })
describe('disposable delivery engine pins', () => {
  it('pins both upstream names using the actual anchor manifests', () => {
    const a = JSON.parse(readFileSync(new URL('../../packages/hashline/package.json', import.meta.url), 'utf8'))
    const b = JSON.parse(readFileSync(new URL('../../packages/tool-edit/package.json', import.meta.url), 'utf8'))
    expect(enginePinsFromAnchors(a, b)).toEqual({ '@hy-sde-org/dsh-hashline': '0.2.1-alpha.4', '@hy-sde-org/dsh-tool-edit': '0.2.1-alpha.4' })
  })
  it.each(['^0.2.1-alpha.4', '~0.2.1', '*', 'latest', 'workspace:*', ''])('rejects a non-exact anchor %s on either side', version => {
    expect(() => enginePinsFromAnchors(engine(version), edit('0.2.1-alpha.4'))).toThrow('exact engine anchor')
    expect(() => enginePinsFromAnchors(engine('0.2.1-alpha.4'), edit(version))).toThrow('exact engine anchor')
  })
  it('refuses missing anchors rather than silently allowing a registry range', () => {
    expect(() => enginePinsFromAnchors({}, edit('0.2.1-alpha.4'))).toThrow()
    expect(() => enginePinsFromAnchors(engine('0.2.1-alpha.4'), {})).toThrow()
  })
})
