import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('../../', import.meta.url))
const requireFrom = (dir: string) => createRequire(path.join(dir, 'package.json'))

const readResolved = () => requireFrom(packageDir).resolve('@hy-sde-org/dsh-hashline')
const editDir = () => path.dirname(requireFrom(packageDir).resolve('@hy-sde-org/dsh-tool-edit/package.json'))

const installedVersion = (dir: string) =>
  (JSON.parse(readFileSync(requireFrom(dir).resolve('@hy-sde-org/dsh-hashline/package.json'), 'utf8')) as { version: string }).version

describe('engine identity (FR-8)', () => {
  it('resolves one physical hashline module for the read and edit packages', () => {
    const fromEdit = requireFrom(editDir()).resolve('@hy-sde-org/dsh-hashline')
    expect(realpathSync(readResolved())).toBe(realpathSync(fromEdit))
  })

  it('pins the engine version identically on both sides', () => {
    expect(installedVersion(packageDir)).toBe('0.2.1-alpha.4')
    expect(installedVersion(editDir())).toBe('0.2.1-alpha.4')
  })
})
