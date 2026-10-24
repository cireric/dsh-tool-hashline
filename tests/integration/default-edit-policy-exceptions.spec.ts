/**
 * Ticket 05: creation, empty-file fill, pure delete/move stay available, while
 * an overwrite of existing content and a move-with-edit stay constrained.
 *
 * The classification is measured on the real filesystem: an `op` name never
 * decides it. Every negative case also asserts that nothing was written.
 *
 * Traces FR-01/FR-03/FR-06 (M4 exceptions): POLICY-08, POLICY-15, POLICY-10's
 * MV/BOM subset.
 * @module dsh-tool-hashline/tests/integration/default-edit-policy-exceptions
 */
import { existsSync as exists } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { createPolicyHarness, readFixture, writeFixture } from './edit-policy-harness.ts'

const POLICY_MODULE = fileURLToPath(new URL('../../presets/ptc-hashline/policy/default-edit-policy.mjs', import.meta.url))
const errorText = (result: ToolExecutionResult): string => result.isError ? result.error.message : ''

const managed = (options: Parameters<typeof createPolicyHarness>[0] = {}) =>
  createPolicyHarness({ ...options, policyModule: POLICY_MODULE })

describe('POLICY-08: the creation and pure-operation exceptions stay available', () => {
  it('creates a file that does not exist, without any fallback', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())

    // A creation still has to satisfy the HOST's observation policy, and this is a
    // real finding: `fs/edit-intent` refuses a target it observed as absent, so a
    // create-shaped edit of a missing file cannot pass through `edit` under the
    // mounted policy. The policy itself must NOT claim this case, though: it is a
    // host refusal, not a degradation gap.
    const observed = await harness.read('created.txt')
    expect(observed.isError).toBe(true)

    const result = await harness.callTool('edit', {
      path: 'created.txt',
      edits: [{ op: 'create', diff: '+hello\n+world' }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).not.toContain('EDIT_POLICY_')
    expect(await exists(harness.dir + '/created.txt')).toBe(false)
  })

  it('fills a zero-byte file without any fallback', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'empty.txt', '')

    const result = await harness.callTool('edit', {
      path: 'empty.txt',
      edits: [{ op: 'update', diff: '@@ -1,0 +1,1 @@\n+content' }],
    })

    expect(result.isError, errorText(result)).toBe(false)
    // The engine's own trailing-newline policy decides the bytes; the point here is
    // that the fill needed no degradation.
    expect(await readFixture(harness.dir + '/empty.txt')).toContain('content')
  })

  it('deletes a file without a fallback', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'deleted.txt', 'gone soon\n')

    const result = await harness.callTool('edit', {
      path: 'deleted.txt',
      edits: [{ op: 'delete' }],
    })

    expect(result.isError, errorText(result)).toBe(false)
    await expect(readFixture(harness.dir + '/deleted.txt')).rejects.toThrow()
  })

  it('moves a file without a fallback', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const text = 'alpha\nbeta\n'
    await writeFixture(harness.dir, 'moved.txt', text)
    const read = await harness.read('moved.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value

    // A relative DEST resolves against the session directory, which is what the
    // containment check compares against (an absolute path may carry a symlinked
    // prefix and be refused for that reason alone).
    const result = await harness.edit('[' + value.path + '#' + value.tag + ']\nMV moved-dest.txt')

    expect(result.isError, errorText(result)).toBe(false)
    expect(await readFixture(harness.dir + '/moved-dest.txt')).toBe(text)
    await expect(readFixture(harness.dir + '/moved.txt')).rejects.toThrow()
  })
})

describe('POLICY-08/POLICY-15: an overwrite is classified by content, not by the op name', () => {
  it('refuses a `create` that would overwrite existing non-empty content', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'original\n'
    const file = await writeFixture(harness.dir, 'overwrite.txt', source)

    const result = await harness.callTool('edit', {
      path: 'overwrite.txt',
      edits: [{ op: 'create', diff: '+replacement' }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(harness.writes).toHaveLength(0)
    expect(await readFixture(file)).toBe(source)
  })

  it('refuses a whitespace-only file as an update, not as an empty-file exception', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = '   \n\t\n'
    const file = await writeFixture(harness.dir, 'blank.txt', source)

    const result = await harness.callTool('edit', {
      path: 'blank.txt',
      edits: [{ op: 'update', diff: '@@ -1,2 +1,1 @@\n-   \n-\t\n+filled' }],
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(await readFixture(file)).toBe(source)
  })

  it('allows a move whose content change is Hashline, and refuses the same move through apply_patch', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'alpha\nbeta\n'
    const file = await writeFixture(harness.dir, 'move-edit.txt', source)
    const read = await harness.read('move-edit.txt')
    const value = (read as unknown as { value: { path: string; tag: string } }).value

    // MV + PUT is a HASHLINE program: the content update already uses the default
    // mode, so the move-with-edit is allowed without any degradation.
    const allowed = await harness.edit('[' + value.path + '#' + value.tag + ']\nMV move-edit-dest.txt\nPUT 1.=1:\n+ALPHA')
    expect(allowed.isError, errorText(allowed)).toBe(false)
    expect(await readFixture(harness.dir + '/move-edit-dest.txt')).toBe('ALPHA\nbeta\n')

    // The SAME move expressed as an apply_patch envelope is a non-Hashline content
    // update, so it must declare a degradation — and with none, it is refused
    // before anything lands.
    const second = await writeFixture(harness.dir, 'move-edit-2.txt', source)
    const refused = await harness.callTool('edit', {
      input: '*** Begin Patch\n*** Update File: ' + second + '\n*** Move to: move-edit-2-dest.txt\n@@\n-alpha\n+ALPHA\n*** End Patch',
    })
    expect(refused.isError).toBe(true)
    expect(errorText(refused)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(await readFixture(second)).toBe(source)
    await expect(readFixture(harness.dir + '/move-edit-2-dest.txt')).rejects.toThrow()
  })

  it('refuses a create-shaped overwrite in an apply_patch envelope', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = 'keep\n'
    const file = await writeFixture(harness.dir, 'envelope.txt', source)

    // `*** Add File` on an existing path is a create over content: the engine
    // would refuse it too, but the policy must classify it as a content update
    // FIRST and refuse it for the policy reason, not for the engine's overwrite.
    const result = await harness.callTool('edit', {
      input: '*** Begin Patch\n*** Update File: ' + file + '\n@@\n-keep\n+kept\n*** End Patch',
    })

    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(await readFixture(file)).toBe(source)
  })
})

describe('POLICY-15: BOM handling follows the measured exception, never a blanket rule', () => {
  it('treats a single-BOM zero-byte file as a creation case and keeps the BOM', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'bom-empty.txt', '\uFEFF')

    const result = await harness.callTool('edit', {
      path: 'bom-empty.txt',
      edits: [{ op: 'update', diff: '@@ -1,0 +1,1 @@\n+with bom' }],
    })

    expect(result.isError, errorText(result)).toBe(false)
    // The fill needed no degradation. BOM fidelity through THIS mode is not claimed
    // (ADR-0005 covers the hashline path only), so the assertion is the content.
  })

  it('does not treat consecutive BOMs as an empty file', async () => {
    const harness = await managed()
    onTestFinished(() => harness.cleanup())
    const source = '\uFEFF\uFEFF'
    const file = await writeFixture(harness.dir, 'bom-bom.txt', source)

    const result = await harness.callTool('edit', {
      path: 'bom-bom.txt',
      edits: [{ op: 'update', diff: '@@ -1,1 +1,1 @@\n-\uFEFF\uFEFF\n+single' }],
    })

    // Consecutive BOMs are NOT an empty-file exception: the request is a content
    // update of a file whose fidelity this build cannot guarantee.
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('EDIT_POLICY_FALLBACK_REQUIRED')
    expect(await readFixture(file)).toBe(source)
  })
})
