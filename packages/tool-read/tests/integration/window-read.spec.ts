import { describe, expect, it, onTestFinished } from 'vitest'
import { getSessionSnapshotStore } from '@dsh-tool-hashline/hashline'
import type { ReadValue } from '../../src/index.ts'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolRead from '../../src/index.ts'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import * as path from 'node:path'
import { createHarness, readFixture, valueOf, writeFixture } from './harness.ts'

const textOf = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map(block => block.type === 'text' ? block.text ?? '' : '').join('')

describe('window semantics (ticket 02)', () => {
  it('pages with the stock footer and a null nextAction', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'three.txt', 'one\ntwo\nthree\n')
    const result = await harness.callRead({ file_path: file, offset: 2, limit: 1 })
    const value = valueOf<ReadValue>(result)
    expect(value.lines).toEqual([{ number: 2, text: 'two' }])
    expect(value.offset).toBe(2)
    expect(value.tagged).toBe(true)
    expect(value.nextAction).toBeNull()
    expect(textOf(result as never)).toContain('(Showing lines 2-2 of 3. Use offset=3 to continue.)')
  })

  it('errors with FS_NOT_FOUND past EOF and mints nothing', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'short.txt', 'one\ntwo\nthree\n')
    const result = await harness.callRead({ file_path: file, offset: 99 })
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe('FS_NOT_FOUND')
    expect(result.error?.message).toBe(`offset 99 is out of range for "${file}" (3 lines)`)
    expect(getSessionSnapshotStore(harness.session).head(path.resolve(harness.dir, file))).toBeNull()
  })

  it('rejects a limit above the configured cap', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'a.txt', 'one\n')
    const result = await harness.callRead({ file_path: file, limit: 2001 })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('limit must be less than or equal to 2000')
  })

  it('column-truncates one 200 KB line without a byte-capped footer and gives long-line guidance', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'long.txt', `${'x'.repeat(200 * 1024)}\n`)
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    expect(value.totalLines).toBe(1)
    expect(value.lines).toHaveLength(1)
    expect(value.lines[0]!.text).toBe(`${'x'.repeat(2000)}... (line truncated to 2000 chars)`)
    expect(value.nextAction).toContain('maxLineLength')
    const content = textOf(result as never)
    expect(content).toContain('(End of file - total 1 lines)')
    expect(content).not.toContain('Output capped')
    // No complete line was returned, so the guard stays armed through [0].
    const store = getSessionSnapshotStore(harness.session)
    expect([...store.head(path.resolve(harness.dir, file))?.seenLines ?? []]).toEqual([0])
  })

  it('uses the byte-capped footer for many complete lines and marks every returned line seen', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const line = 'y'.repeat(1000)
    const file = await writeFixture(harness.dir, 'wide.txt', `${Array.from({ length: 60 }, () => line).join('\n')}\n`)
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    expect(value.lines).toHaveLength(51)
    expect(value.nextAction).toBeNull()
    expect(textOf(result as never)).toContain('(Output capped. Showing lines 1-51. Use offset=52 to continue.)')
    const store = getSessionSnapshotStore(harness.session)
    const seen = [...store.head(path.resolve(harness.dir, file))?.seenLines ?? []].sort((a, b) => a - b)
    expect(seen).toEqual(Array.from({ length: 51 }, (_, index) => index + 1))
  })

  it('returns a zero-line window when maxBytes cannot fit the first line', async () => {
    const harness = await createHarness({ read: { maxBytes: 10 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'tiny.txt', 'abcdefghijklmnop\nsecond\n')
    const result = await harness.callRead({ file_path: file })
    const value = valueOf<ReadValue>(result)
    expect(value.lines).toEqual([])
    expect(value.tagged).toBe(true)
    expect(value.nextAction).toContain('maxBytes')
    expect(textOf(result as never)).toContain('(Output capped. Showing lines 1-0. Use offset=1 to continue.)')
    const store = getSessionSnapshotStore(harness.session)
    expect([...store.head(path.resolve(harness.dir, file))?.seenLines ?? []]).toEqual([0])
  })

  it('applies configured limit and maxLineLength', async () => {
    const harness = await createHarness({ read: { limit: 1, maxLineLength: 3 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'cfg.txt', 'abcd\nefgh\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect(value.lines).toHaveLength(1)
    expect(value.lines[0]!.text).toBe('abc... (line truncated to 3 chars)')
    expect(value.nextAction).toContain('maxLineLength')
  })

  it('keeps the stock parameter surface (no column paging arguments)', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const parameters = harness.runtime.get('read')?.parameters as { properties: Record<string, unknown>; required?: string[] }
    expect(Object.keys(parameters.properties).sort()).toEqual(['file_path', 'limit', 'offset'])
    expect(parameters.required).toEqual(['file_path'])
  })

  it('rejects an invalid config at mount time and names the key', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    provideWorkingDirectoryFixture(ctx, process.cwd())
    new ToolRuntime(ctx)
    await expect(ctx.plugin(ToolRead, { limit: 0 })).rejects.toThrow('tool-read config "limit" must be a finite positive integer')
    await expect(ctx.plugin(ToolRead, { maxBytes: 1.5 })).rejects.toThrow('tool-read config "maxBytes" must be a finite positive integer')
  })
})

describe('path resolution vs store key (FR-7)', () => {
  it('opens a relative path in the session working directory while keeping the edit-side key', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    await writeFixture(harness.dir, 'relres.txt', 'one\ntwo\n')
    // Other tests fabricate session.cwd; a real 0.2.1-rc.2 Session exposes only
    // header.cwd, so the store key falls back to process.cwd() while resolution
    // must still follow the session's working directory.
    delete (harness.session as { cwd?: string }).cwd
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: 'relres.txt' }))
    expect(value.path).toBe(path.join(harness.dir, 'relres.txt'))
    const edited = await harness.callEdit({ input: '[' + value.path + '#' + value.tag + ']\nPUT 1.=1:\n+ONE' })
    expect(edited.isError).toBe(false)
    expect(await readFixture(path.join(harness.dir, 'relres.txt'))).toBe('ONE\ntwo\n')
  })
})

describe('read provider exclusivity (FR-11)', () => {
  const mount = async (readConfig: ToolRead.Config, toolFs: ToolFs.Config, toolFsFirst = false) => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    provideWorkingDirectoryFixture(ctx, process.cwd())
    const runtime = new ToolRuntime(ctx)
    if (toolFsFirst) {
      await ctx.plugin(ToolFs, toolFs)
      await ctx.plugin(ToolRead, readConfig)
    } else {
      await ctx.plugin(ToolRead, readConfig)
      await ctx.plugin(ToolFs, toolFs)
    }
    return runtime
  }

  it('registers nothing when this plugin is disabled and stock read is off', async () => {
    const runtime = await mount({ enabled: false }, { read: false, edit: false })
    expect(runtime.get('read')).toBeUndefined()
  })

  it('leaves stock read in place when this plugin is disabled', async () => {
    const runtime = await mount({ enabled: false }, { read: true, edit: false })
    expect(runtime.get('read')).toBeDefined()
    expect(runtime.get('read')?.description).toContain('line-numbered content')
  })

  it('fails the mount when both providers register read in one scope', async () => {
    // Stock first, so the second registration hits the registry's duplicate-name guard.
    // Root-scope registries use the longer wording; per-agent scopes say "in this
    // scope". Both are the registry's duplicate-name guard (core/tools/index.ts:747-749).
    await expect(mount({}, { read: true, edit: false }, true)).rejects.toThrow(/tool "read" is already registered/u)
  })
})

describe('seen guard from the read window (ticket 02)', () => {
  it('rejects an anchor outside the returned window, then allows it after the rejection echoed the line', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const lines = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`)
    const file = await writeFixture(harness.dir, 'guarded.txt', `${lines.join('\n')}\n`)
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 3 }))
    expect(value.tagged).toBe(true)

    const rejected = await harness.callEdit({ input: `[${value.path}#${value.tag}]\nPUT 8.=8:\n+changed` })
    expect(rejected.isError).toBe(true)
    expect(rejected.error?.message.length).toBeGreaterThan(0)

    // The rejection echoes the unseen line, which the engine records as seen; the
    // same edit then applies. This is the upstream bounded guard, not a strict gate.
    const retried = await harness.callEdit({ input: `[${value.path}#${value.tag}]\nPUT 8.=8:\n+changed` })
    expect(retried.isError).toBe(false)
    expect((await readFixture(file)).split('\n')[7]).toBe('changed')
  })

  it('rejects an edit to a line that was only returned truncated ([0] sentinel)', async () => {
    const harness = await createHarness({ read: { maxLineLength: 5 } })
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'clipped.txt', 'abcdefghij\nsecond\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file }))
    expect(value.lines[0]!.text).toBe('abcde... (line truncated to 5 chars)')
    const rejected = await harness.callEdit({ input: '[' + value.path + '#' + value.tag + ']\nPUT 1.=1:\n+x' })
    expect(rejected.isError).toBe(true)
  })

  it('drops the sentinel when the store is re-recorded without a seen set', async () => {
    const harness = await createHarness()
    onTestFinished(() => harness.cleanup())
    const file = await writeFixture(harness.dir, 'sentinel.txt', 'one\ntwo\nthree\n')
    const value = valueOf<ReadValue>(await harness.callRead({ file_path: file, offset: 1, limit: 1 }))
    const key = path.resolve(harness.dir, file)
    const store = getSessionSnapshotStore(harness.session)
    expect([...store.head(key)?.seenLines ?? []]).toEqual([1])

    // Drop the retained version and re-record the same text with no provenance: the
    // engine treats "no seen set" as "guard off", so an anchor never displayed
    // becomes editable. (Re-recording an existing version would union, not clear.)
    store.invalidate(key)
    store.record(key, await readFixture(file))
    const edited = await harness.callEdit({ input: `[${value.path}#${value.tag}]\nPUT 3.=3:\n+THREE` })
    expect(edited.isError).toBe(false)
    expect(await readFixture(file)).toBe('one\ntwo\nTHREE\n')
  })
})