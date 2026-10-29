import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TASK_KIND, TASK_VERDICT, judgeSessionArtifact, tasksOf } from '../../scripts/tool-usage-judgement.mjs'

/**
 * The session-artifact entry point (tool-routing plan T2): the judgement has to work on the
 * file a maintainer actually has, read with the shipped decoder, and it must not turn a log
 * with holes into a clean finding.
 *
 * Fixtures are written to a scratch directory under the workspace and read back through
 * `decodeArtifact`/`parseRecords`, so the decoding path is the real one.
 */
const record = (type: string, data: unknown, seq: number) => JSON.stringify({ type, seq, time: 0, data })

const artifactLines = () => [
  record('session', { id: 's1', version: 4 }, 0),
  record('tool/call', { turn: 1, step: 1, callId: 'root-1', name: 'run_code', arguments: JSON.stringify({ code: 'await tools.read({file_path: "src/a.ts"})', description: 'task' }) }, 1),
  record('tool/ptc-dispatch-start', { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:1', name: 'read', arguments: { file_path: 'src/a.ts' } }, 2),
  record('tool/ptc-dispatch', { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:1', name: 'read', arguments: { file_path: 'src/a.ts' }, isError: false, content: [] }, 3),
  record('tool/ptc-dispatch-start', { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:2', name: 'edit', arguments: { input: '[src/a.ts#ABCD]\\nPUT 1.=1:\\n+x' } }, 4),
  record('tool/ptc-dispatch', { rootCallId: 'root-1', parentCallId: 'root-1', subCallId: 'root-1:ptc:2', name: 'edit', arguments: { input: '[src/a.ts#ABCD]\\nPUT 1.=1:\\n+x' }, isError: false, content: [] }, 5),
]

async function scratch() {
  const dir = await mkdtemp(path.join(process.cwd(), '.tmp', 'judge-'))
  await mkdir(dir, { recursive: true })
  return dir
}

describe('tool-path judgement on a session artifact', () => {
  it('reads a plain JSONL v4 artifact and judges a text update as the applied path', async () => {
    const dir = await scratch()
    const artifact = path.join(dir, 'session.jsonl')
    await writeFile(artifact, artifactLines().join('\n') + '\n', 'utf8')
    const result = await judgeSessionArtifact({
      sourcePath: artifact,
      tasks: [{ id: 'T3', kind: TASK_KIND.TEXT_UPDATE, targets: ['src/a.ts'] }],
    })
    expect(result.format).toBe('jsonl.v4')
    expect(result.records).toBe(6)
    expect(result.complete).toBe(true)
    expect(result.failures).toHaveLength(0)
    expect(result.judgements[0].verdict).toBe(TASK_VERDICT.APPLIED)
    expect(result.summary[0]).toContain('applied-tool-path')
    expect(result.summary[0]).not.toContain('src/a.ts')
  })

  it('never upgrades an artifact with a broken line to a clean verdict', async () => {
    const dir = await scratch()
    const artifact = path.join(dir, 'broken.jsonl')
    await writeFile(artifact, [...artifactLines(), '{"type":"tool/call","seq":6,'].join('\n') + '\n', 'utf8')
    const result = await judgeSessionArtifact({
      sourcePath: artifact,
      tasks: [{ id: 'T3', kind: TASK_KIND.TEXT_UPDATE, targets: ['src/a.ts'] }],
    })
    expect(result.complete).toBe(false)
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.judgements[0].verdict).toBe(TASK_VERDICT.UNKNOWN)
    expect(result.judgements[0].gaps.map((gap: { kind: string }) => gap.kind)).toContain('session-artifact-incomplete')
  })

  it('also reads the frozen joint case document, so --tasks can point at it directly', async () => {
    const { tasksOf } = await import('../../scripts/tool-usage-judgement.mjs')
    const document = JSON.parse(await readFile(new URL('../../docs/plans/2026-10-28-joint-real-model-cases.json', import.meta.url), 'utf8'))
    const tasks = tasksOf(document)
    expect(tasks).toHaveLength(8) // the eight tool-path cases; the twelve gate cases are not tool tasks
    expect(tasks.map(task => task.id)).toContain('T3')
    expect(tasks.every(task => typeof task.kind === 'string')).toBe(true)
  })

  it('reads both manifest shapes and defaults a missing kind to the update path', () => {
    expect(tasksOf({ tasks: [{ id: 'a', kind: 'text-read', targets: ['x'] }] })[0]).toEqual({ id: 'a', kind: 'text-read', targets: ['x'] })
    expect(tasksOf([{ id: 'b', targets: ['y'] }])[0]).toEqual({ id: 'b', kind: TASK_KIND.TEXT_UPDATE, targets: ['y'] })
    expect(tasksOf(undefined)).toEqual([])
    // a joint manifest's intent-gate entries are not tool-path tasks
    expect(tasksOf({ tasks: [{ id: 'G1', line: 'gate' }, { id: 'T1', line: 'tool', kind: 'text-read', targets: ['x'] }] })).toHaveLength(1)
  })
})
