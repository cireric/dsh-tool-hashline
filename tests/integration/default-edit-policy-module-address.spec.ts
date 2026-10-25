import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const shippedPolicy = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))

// Each CI OS exercises its own real native path, not a simulated path dialect.
describe('default-edit policy module addresses on the running OS', () => {
  it.each(['absolute', 'relative', 'file-url'] as const)('loads a %s address with spaces, Unicode and URL metacharacters', async kind => {
    // Stay on cwd's volume so the relative case is also relative on Windows.
    const dir = await mkdtemp(path.join(process.cwd(), '.tmp-policy-address-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const moduleFile = path.join(dir, '策略 module #100%.mjs')
    await copyFile(shippedPolicy, moduleFile)
    await copyFile(fileURLToPath(new URL('../../presets/ptc-hashline/policy/user-source.mjs', import.meta.url)), path.join(dir, 'user-source.mjs'))
    const address = kind === 'file-url' ? pathToFileURL(moduleFile).href
      : kind === 'relative' ? path.relative(process.cwd(), moduleFile) : moduleFile
    const harness = await createPolicyHarness({ policyModule: address })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'target.txt', 'one\ntwo\n')
    const result = await harness.callTool('edit', { path: 'target.txt', old_string: 'two', new_string: 'TWO' })
    expect(result.isError).toBe(true)
    expect(result.isError ? result.error.message : '').toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe('one\ntwo\n')
  })

  it.each(['absolute', 'file-url'] as const)('keeps a missing %s module fail closed', async kind => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'policy-missing-'))
    onTestFinished(() => rm(dir, { recursive: true, force: true }))
    const missing = path.join(dir, 'missing.mjs')
    const harness = await createPolicyHarness({ policyModule: kind === 'file-url' ? pathToFileURL(missing).href : missing })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'target.txt', 'one\ntwo\n')
    const result = await harness.callTool('edit', { path: 'target.txt', old_string: 'two', new_string: 'TWO' })
    expect(result.isError ? result.error.message : '').toContain('EDIT_POLICY_UNAVAILABLE')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe('one\ntwo\n')
  })
})
