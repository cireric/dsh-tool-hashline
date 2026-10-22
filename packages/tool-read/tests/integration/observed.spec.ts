import { describe, expect, it, onTestFinished } from 'vitest'
import type { ReadValue } from '../../src/index.ts'
import { createHarness, readFixture, valueOf, writeFixture } from './harness.ts'

describe('fs/observed emission (FR-6)', () => {
  it('lets the stock write tool replace a file this read observed', async () => {
    const harness = await createHarness({ policy: true, toolFs: {} })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'observed.txt', 'before\n')
    valueOf<ReadValue>(await harness.callRead({ file_path: file }))

    const written = await harness.callTool('write', { file_path: file, content: 'after\n' })
    expect(written.isError).toBe(false)
    expect(await readFixture(file)).toBe('after\n')
  })

  it('rejects a stock write to an unobserved file (negative control)', async () => {
    const harness = await createHarness({ policy: true, toolFs: {} })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'unobserved.txt', 'before\n')

    const written = await harness.callTool('write', { file_path: file, content: 'after\n' })
    expect(written.isError).toBe(true)
    expect(written.error?.info?.code).toBe('FS_NOT_OBSERVED')
    expect(await readFixture(file)).toBe('before\n')
  })
})
