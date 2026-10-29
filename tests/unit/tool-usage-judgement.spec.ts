import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_GAP,
  REASON_DICTIONARY,
  TASK_KIND,
  TASK_VERDICT,
  UNKNOWN_REASON,
  judgeSessionArtifact,
  judgeTaskUsage,
  readToolUsage,
  summarizeJudgement,
} from '../../scripts/tool-usage-judgement.mjs'

/**
 * Per-task tool-path judgement (tool-routing plan T2).
 *
 * This tier proves the JUDGEMENT, not the model: every fixture below is a hand-built durable
 * log, so the suite can pin the four claims the plan keeps apart — adoption, path, proven
 * bypass and candidate-only signals — including the cases where the right answer is "unknown"
 * rather than "clean".
 */

type Event = { type: string; seq?: number; data: unknown }

const start = (subCallId: string, name: string, args: unknown, parentCallId = 'root-1'): Event =>
  ({ type: 'tool/ptc-dispatch-start', data: { rootCallId: parentCallId, parentCallId, subCallId, name, arguments: args } })
const settle = (subCallId: string, name: string, args: unknown, isError = false, parentCallId = 'root-1'): Event =>
  ({ type: 'tool/ptc-dispatch', data: { rootCallId: parentCallId, parentCallId, subCallId, name, arguments: args, isError, content: [] } })
const program = (callId: string, code: string): Event =>
  ({ type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'run_code', arguments: JSON.stringify({ code, description: 'task' }) } })

const judge = (kind: 'text-read' | 'text-update' | 'create' | 'search' | 'shell' | 'no-file-work', targets: string[], events: Event[]) => judgeTaskUsage({ task: { id: 'k', kind, targets }, events })

describe('tool-path judgement: pairing and evidence', () => {
  it('pairs a start and its settle into one call, and reports an unsettled start as a gap', () => {
    const events = [start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }), start('s2', 'edit', { input: '[src/a.ts#ABCD]' })]
    const usage = readToolUsage(events)
    expect(usage.calls).toHaveLength(2)
    expect(usage.calls.find(call => call.subCallId === 's1')?.state).toBe('completed')
    expect(usage.calls.find(call => call.subCallId === 's2')?.state).toBe('started')
    expect(usage.gaps.map(gap => gap.kind)).toEqual(['start-without-settle'])
  })

  it('never pairs a settle with a call it did not see start', () => {
    const usage = readToolUsage([settle('ghost', 'read', { file_path: 'src/a.ts' })])
    expect(usage.calls).toHaveLength(0)
    expect(usage.gaps.map(gap => gap.kind)).toEqual(['settle-without-start'])
  })
})

describe('tool-path judgement: the applicable path per task kind', () => {
  it('accepts a text update that went read → edit against the same target', () => {
    const events = [program('root-1', 'const r = await tools.read({file_path: "src/a.ts"}); await tools.edit({input: "[src/a.ts#" + r.tag + "]\\nPUT 1.=1:\\n+x"})'),
      start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }),
      start('s2', 'edit', { input: '[src/a.ts#ABCD]\\nPUT 1.=1:\\n+x' }), settle('s2', 'edit', { input: '[src/a.ts#ABCD]\\nPUT 1.=1:\\n+x' })]
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events)
    expect(result.verdict).toBe(TASK_VERDICT.APPLIED)
    expect(result.adoption.read).toBe(1)
    expect(result.adoption.edit).toBe(1)
  })

  it('does not call an edit that was never preceded by a read clean', () => {
    const events = [start('s2', 'edit', { input: '[src/a.ts#ABCD]' }), settle('s2', 'edit', { input: '[src/a.ts#ABCD]' })]
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events)
    expect(result.verdict).toBe(TASK_VERDICT.UNKNOWN)
    expect(result.unknowns.map(entry => entry.kind)).toContain('edit-without-read')
  })

  it('reads a shell command that touches the target as a PROVEN bypass', () => {
    const events = [start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }),
      start('s2', 'pwsh', { command: 'Set-Content src/a.ts x' }), settle('s2', 'pwsh', { command: 'Set-Content src/a.ts x' })]
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events)
    expect(result.verdict).toBe(TASK_VERDICT.BYPASS)
    expect(result.provenBypass.map(entry => entry.reason)).toEqual(['shell-touches-target'])
  })

  it('treats a native-FS program body as a CANDIDATE, never as proof and never as clean', () => {
    const code = 'const fs = require(\'node:fs\'); fs.writeFileSync("src/a.ts", "x")'
    const events = [program('root-1', code),
      start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }),
      start('s2', 'edit', { input: '[src/a.ts#ABCD]' }), settle('s2', 'edit', { input: '[src/a.ts#ABCD]' })]
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events)
    // the tool path itself is fine, but the program that also writes natively cannot earn a clean pass
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.candidates.some(entry => entry.mentionsTarget === true)).toBe(true)
    expect(result.verdict).toBe(TASK_VERDICT.UNKNOWN)
    expect(result.verdict).not.toBe(TASK_VERDICT.BYPASS) // a candidate is not a proven bypass
  })

  it('does not read a native-FS mention that never touches the target as a finding about it', () => {
    const code = 'const fs = require(\'node:fs\'); fs.writeFileSync(".tmp/log", "x")'
    const events = [program('root-1', code),
      start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }),
      start('s2', 'edit', { input: '[src/a.ts#ABCD]' }), settle('s2', 'edit', { input: '[src/a.ts#ABCD]' })]
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events)
    expect(result.candidates.some(entry => entry.mentionsTarget === true)).toBe(false)
    expect(result.verdict).toBe(TASK_VERDICT.APPLIED)
  })

  it('accepts a real read of the target and refuses to count a search as a read', () => {
    const readEvents = [start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' })]
    expect(judge(TASK_KIND.TEXT_READ, ['src/a.ts'], readEvents).verdict).toBe(TASK_VERDICT.APPLIED)
    const searchEvents = [start('s1', 'grep', { pattern: 'a.ts' }), settle('s1', 'grep', { pattern: 'a.ts' })]
    expect(judge(TASK_KIND.TEXT_READ, ['src/a.ts'], searchEvents).verdict).toBe(TASK_VERDICT.UNKNOWN)
  })

  it('treats a genuinely new file as the declared create exception, and a shell redirect as a bypass', () => {
    const created = [start('s1', 'write', { file_path: 'docs/new.md', content: 'x' }), settle('s1', 'write', { file_path: 'docs/new.md', content: 'x' })]
    expect(judge(TASK_KIND.CREATE, ['docs/new.md'], created).verdict).toBe(TASK_VERDICT.EXCEPTION)
    const shelled = [start('s1', 'bash', { command: 'echo x > docs/new.md' }), settle('s1', 'bash', { command: 'echo x > docs/new.md' })]
    expect(judge(TASK_KIND.CREATE, ['docs/new.md'], shelled).verdict).toBe(TASK_VERDICT.BYPASS)
  })

  it('keeps the same write tool as the create path and as a bypass depending on the task', () => {
    const events = [start('s1', 'write', { file_path: 'src/a.ts', content: 'x' }), settle('s1', 'write', { file_path: 'src/a.ts', content: 'x' })]
    expect(judge(TASK_KIND.CREATE, ['src/a.ts'], events).verdict).toBe(TASK_VERDICT.EXCEPTION)
    expect(judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events).verdict).toBe(TASK_VERDICT.BYPASS)
  })
})

describe('tool-path judgement: no evidence is not a negative finding', () => {
  it('never reports a file-free task as a failure for having no file tools', () => {
    const result = judge(TASK_KIND.NO_FILE, [], [])
    expect(result.verdict).toBe(TASK_VERDICT.NO_FILE_WORK)
    expect(result.unknowns).toHaveLength(0)
  })

  it('reports unknown, with a reason, when nothing in the log mentions the target', () => {
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], [])
    expect(result.verdict).toBe(TASK_VERDICT.UNKNOWN)
    expect(result.unknowns.map(entry => entry.kind)).toContain('no-dispatch-mentions-the-target')
  })

  it('does not let an unsettled dispatch become a clean pass', () => {
    const events = [start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }), start('s2', 'edit', { input: '[src/a.ts#ABCD]' })]
    const result = judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events)
    expect(result.verdict).toBe(TASK_VERDICT.UNKNOWN)
    expect(result.unknowns.map(entry => entry.kind)).toContain('unsettled-dispatch')
  })

  it('summarises without leaking arguments or program bodies', () => {
    const events = [program('root-1', 'const fs = require(\'node:fs\')'),
      start('s1', 'read', { file_path: 'src/a.ts' }), settle('s1', 'read', { file_path: 'src/a.ts' }),
      start('s2', 'edit', { input: '[src/a.ts#ABCD]' }), settle('s2', 'edit', { input: '[src/a.ts#ABCD]' })]
    const line = summarizeJudgement(judge(TASK_KIND.TEXT_UPDATE, ['src/a.ts'], events))
    expect(line).toContain('read=1')
    expect(line).toContain('candidates=1')
    expect(line).not.toContain('writeFileSync')
    expect(line).not.toContain('src/a.ts')
  })
})

describe('judgement reason codes: stable, documented, and actually reachable', () => {
  it('gives every declared code a one-line meaning, and declares no meaning without a code', () => {
    const declared: string[] = [...Object.values(UNKNOWN_REASON), ...Object.values(EVIDENCE_GAP)]
    expect(declared.length).toBeGreaterThan(0)
    for (const code of declared) {
      expect(typeof REASON_DICTIONARY[code]).toBe('string')
      expect(String(REASON_DICTIONARY[code]).length).toBeGreaterThan(0)
    }
    expect(Object.keys(REASON_DICTIONARY).sort()).toEqual([...declared].sort())
  })

  it('emits only declared codes, whatever the evidence looks like', async () => {
    const declared: Set<string> = new Set([...Object.values(UNKNOWN_REASON), ...Object.values(EVIDENCE_GAP)])
    const cases: { kind: string; targets: string[]; events: any[] }[] = [
      { kind: TASK_KIND.TEXT_UPDATE, targets: [], events: [] },
      { kind: TASK_KIND.TEXT_UPDATE, targets: ['a.ts'], events: [] },
      { kind: TASK_KIND.TEXT_UPDATE, targets: ['a.ts'], events: [start('s1', 'edit', { input: '[a.ts#ABCD]' })] },
      { kind: TASK_KIND.TEXT_UPDATE, targets: ['a.ts'], events: [start('s1', 'edit', { input: '[a.ts#ABCD]' }), settle('s1', 'edit', { input: '[a.ts#ABCD]' })] },
      { kind: TASK_KIND.TEXT_READ, targets: ['a.ts'], events: [start('s1', 'grep', { pattern: 'a' }), settle('s1', 'grep', { pattern: 'a' })] },
      { kind: TASK_KIND.CREATE, targets: ['n.md'], events: [] },
      { kind: TASK_KIND.SEARCH, targets: [], events: [start('s1', 'read', { file_path: 'a.ts' }), settle('s1', 'read', { file_path: 'a.ts' })] },
      { kind: TASK_KIND.SHELL, targets: [], events: [start('s1', 'read', { file_path: 'a.ts' }), settle('s1', 'read', { file_path: 'a.ts' })] },
      { kind: 'made-up', targets: ['a.ts'], events: [start('s1', 'read', { file_path: 'a.ts' }), settle('s1', 'read', { file_path: 'a.ts' })] },
    ]
    for (const entry of cases) {
      const judgement = judgeTaskUsage({ task: { id: 'k', kind: entry.kind as any, targets: entry.targets }, events: entry.events })
      for (const unknown of judgement.unknowns) expect(declared.has(unknown.kind)).toBe(true)
      for (const gap of judgement.gaps) expect(declared.has(gap.kind)).toBe(true)
    }
    // the artifact-level gap is emitted through the session entry point
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const pathMod = await import('node:path')
    const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'judge-codes-'))
    const file = pathMod.join(dir, 'broken.jsonl')
    await fs.writeFile(file, '{"type":"session","version":4,"id":"s"}\nnot json\n', 'utf8')
    const result = await judgeSessionArtifact({ sourcePath: file, tasks: [{ id: 'T3', kind: TASK_KIND.TEXT_UPDATE, targets: ['a.ts'] }] })
    for (const gap of result.judgements[0].gaps) expect(declared.has(gap.kind)).toBe(true)
    await fs.rm(dir, { recursive: true, force: true })
  })
})
