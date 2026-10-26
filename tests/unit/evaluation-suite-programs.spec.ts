import { describe, it, expect } from 'vitest'
// @ts-expect-error plain fixture module
import { suiteProgram, promptPrefixes } from '../fixtures/evaluation-suite-provider/programs.mjs'
// @ts-expect-error plain ESM module
import { defaultTasks } from '../../scripts/evaluation/task-suite.mjs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const arms = ['stock-edit', 'hashline-default', 'hashline-fallback']
const cases: Array<{ id: string; arm: string }> = promptPrefixes.flatMap(([id]: string[]) => arms.map(arm => ({ id, arm })))
describe('fixed candidate-suite programs', () => {
  it('matches exactly one route per unmodified candidate user prompt', () => {
    const tasks = defaultTasks()
    expect(tasks).toHaveLength(13)
    for (const task of tasks) expect(promptPrefixes.filter(([, prefix]: string[]) => task.prompt.startsWith(prefix)).map(([id]: string[]) => id)).toEqual([task.id])
  })
  it.each(cases)('compiles $id for $arm and stops at its declared step boundary', ({ id, arm }) => {
    expect(() => new AsyncFunction('tools', suiteProgram(id, arm))).not.toThrow()
    if (id === 'consecutive') expect(() => new AsyncFunction('tools', suiteProgram(id, arm, 1))).not.toThrow()
    expect(suiteProgram(id, arm, id === 'consecutive' ? 2 : 1)).toBeNull()
  })
  it('refuses unknown tasks, arms, shells and step numbers', () => {
    for (const args of [['bad', arms[0]], ['single', 'bad'], ['single', arms[0], -1], ['single', arms[0], 0, 'bad']]) expect(() => suiteProgram(...args)).toThrow()
  })
  it('emits actual newline payloads and uses distinct repeated-fragment context for stock', async () => {
    const calls: Array<Record<string, string>> = []
    const tools = { read: async () => ({ path: '/fixture/records.txt', tag: 'ABCD' }), edit: async (args: Record<string, string>) => { calls.push(args) } }
    await new AsyncFunction('tools', suiteProgram('repeated', arms[0]))(tools)
    expect(calls[0]).toMatchObject({ old_string: '[second]\nstatus=pending', new_string: '[second]\nstatus=active' })
    await new AsyncFunction('tools', suiteProgram('repeated', arms[1]))(tools)
    expect(calls[1].input).toBe('[/fixture/records.txt#ABCD]\nPUT 4:\n+status=active')
  })
  it('captures the actual read citation for a window fallback and obtains full source via a read-only shell', async () => {
    const calls: Record<string, unknown>[] = [], commands: string[] = []
    const text = 'L'.repeat(5000) + ':status=pending\n'
    const tools = {
      read: async () => ({ path: '/fixture/long.txt', tag: 'ABCD', nextAction: 'limited (readCallId: actual-read)' }),
      pwsh: async ({ command }: { command: string }) => { commands.push(command); return { exitCode: 0, stdout: { text } } },
      edit: async (args: Record<string, unknown>) => { calls.push(args) },
    }
    await new AsyncFunction('tools', suiteProgram('target-long', arms[2]))(tools)
    expect(commands).toEqual(['node -p "require(\'node:fs\').readFileSync(\'long.txt\',\'utf8\')"'])
    expect(calls[0]).toMatchObject({ old_string: text.trimEnd(), new_string: 'L'.repeat(5000) + ':status=active', fallbacks: [{ readCallId: 'actual-read', reason: 'window-limit', ranges: [{ startLine: 1, endLine: 1 }] }] })
  })
  it('does not edit without a tag route in strict snapshot and explicit replace cases', async () => {
    const tools = { read: async () => ({}), edit: async () => { throw new Error('must not edit') } }
    for (const id of ['snapshot-limit', 'override']) await expect(new AsyncFunction('tools', suiteProgram(id, arms[1]))(tools)).resolves.toBeTypeOf('string')
  })
  it('requires the real shell result before declaring a generator program complete', async () => {
    const commands: string[] = []
    const tools = { read: async () => ({}), pwsh: async ({ command }: { command: string }) => { commands.push(command); return { exitCode: 1, stdout: { text: '' } } } }
    await expect(new AsyncFunction('tools', suiteProgram('generator', arms[1]))(tools)).rejects.toThrow('suite shell failed')
    expect(commands).toEqual(['node generate.mjs'])
  })
})
