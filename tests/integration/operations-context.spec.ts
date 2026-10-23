/**
 * SCOPE-04/05: invocation eligibility comes from THIS session's preset
 * projection — never from a family marker, a hand-typed preset, or another
 * session's log.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { judgeProjection, replayPresetProjection, verifyInvocationContext } from '../../presets/ptc-hashline/operations/context.mjs'
import { encodeSegment, projectKey, sessionDirectory } from '../../presets/ptc-hashline/operations/session-log.mjs'

const WORKSPACE = '/work/business-project'
const SESSION = 'session-verify-0001'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Write one session artifact under the layout the host uses. */
async function writeSession(options: { id?: string; cwd?: string; records: unknown[]; frames?: boolean; generation?: number }): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'operations-context-'))
  dirs.push(root)
  const directory = sessionDirectory(root, options.cwd ?? WORKSPACE, options.id ?? SESSION)
  await mkdir(directory, { recursive: true })
  const text = options.records.map(record => JSON.stringify(record)).join('\n') + '\n'
  const generation = options.generation ?? 4
  if (options.frames === true) {
    // Two frames, as the real backend writes them: header frame + event frame.
    const split = text.indexOf('\n') + 1
    const frames = [text.slice(0, split), text.slice(split)]
    await writeFile(path.join(directory, 'session.v' + generation + '.jsonl.zstd'), Buffer.concat(frames.map(frame => zstdCompressSync(Buffer.from(frame, 'utf8')))))
  } else {
    await writeFile(path.join(directory, 'session.v' + generation + '.jsonl'), text, 'utf8')
  }
  return root
}

const header = (preset?: string) => ({
  type: 'session', version: 4, id: SESSION, cwd: WORKSPACE, createdAt: 1, isSeeded: false, delegationDepth: 0,
  ...preset === undefined ? {} : { agentPreset: preset },
})
const selection = (seq: number, agentPreset: string) => ({ type: 'agent-preset/selected', seq, data: { agentPreset } })

describe('SCOPE-04: no usable projection means no workflow', () => {
  it('accepts a session whose header already names the target preset', async () => {
    const root = await writeSession({ records: [header('ptc-hashline'), selection(1, 'ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(true)
    expect(verdict.status).toBe('eligible')
    expect(verdict.evidence.effectivePreset).toBe('ptc-hashline')
    expect(verdict.evidence.source).toContain('session.v4.jsonl')
  })

  it('accepts a header initial value with no selection event (a legal projection)', async () => {
    const root = await writeSession({ records: [header('ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(true)
    expect(verdict.evidence.selectedPreset).toBeNull()
    expect(verdict.evidence.effectivePreset).toBe('ptc-hashline')
  })

  it('follows a later selection over the header value', async () => {
    const root = await writeSession({ records: [header('standard'), selection(4, 'ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(true)
    expect(verdict.evidence.headerPreset).toBe('standard')
    expect(verdict.evidence.selectedPreset).toBe('ptc-hashline')
    expect(verdict.evidence.selectionSeq).toBe(4)
  })

  it('refuses the family marker "ptc" and says why', async () => {
    const root = await writeSession({ records: [header('ptc')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(false)
    expect(verdict.status).toBe('wrong-preset')
    expect(verdict.reason).toContain('family marker')
  })

  it('refuses any other preset', async () => {
    const root = await writeSession({ records: [header('standard')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.status).toBe('wrong-preset')
    expect(verdict.reason).toContain('"standard"')
  })

  it('refuses a session whose log records no preset at all', async () => {
    const root = await writeSession({ records: [header()] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.status).toBe('context-unverified')
    expect(verdict.evidence.effectivePreset).toBeNull()
  })

  it('never trusts a hand-typed --preset argument', async () => {
    const root = await writeSession({ records: [header('standard')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION, presetArgument: 'ptc-hashline' })
    expect(verdict.eligible).toBe(false)
    expect(verdict.evidence.presetArgumentIgnored).toBe('ptc-hashline')
    expect(verdict.evidence.effectivePreset).toBe('standard')
  })

  it('refuses to run without a session id', async () => {
    const root = await writeSession({ records: [header('ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE })
    expect(verdict.eligible).toBe(false)
    expect(verdict.status).toBe('context-unverified')
    expect(verdict.reason).toContain('DSH_SESSION_ID')
  })

  it('reports a missing session log as unverified, not as eligible', async () => {
    const root = await writeSession({ records: [header('ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: 'session-absent' })
    expect(verdict.status).toBe('context-unverified')
    expect(verdict.reason).toContain('missing')
  })

  it('surfaces an unknown physical generation instead of guessing', async () => {
    const root = await writeSession({ records: [header('ptc-hashline')], generation: 9 })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(true)
    expect(verdict.evidence.generation).toBe(9)
    expect(verdict.evidence.format).toBe('jsonl.v4')
  })

  it('decodes a multi-frame zstd artifact and reports torn frames', async () => {
    const root = await writeSession({ records: [header('ptc-hashline'), selection(1, 'ptc-hashline')], frames: true })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(true)
    expect(verdict.evidence.format).toBe('jsonl.v4.zstd')
    expect(verdict.evidence.frames).toBe(2)
    expect(verdict.evidence.tornStart).toBeNull()
  })

  it('produces no side effects on the filesystem or network', async () => {
    const root = await writeSession({ records: [header('standard')] })
    const before = await import('node:fs/promises').then(fs => fs.readdir(root, { recursive: true }))
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(false)
    const after = await import('node:fs/promises').then(fs => fs.readdir(root, { recursive: true }))
    expect(after.sort()).toEqual(before.sort())
  })
})

describe('SCOPE-05: another session\'s projection cannot authorize this one', () => {
  it('refuses when the invoking session is not the target, even if a sibling session is', async () => {
    // A historical session in the same workspace really is ptc-hashline...
    const root = await writeSession({ id: 'session-history', records: [header('ptc-hashline')] })
    // ...while the invoking session is not.
    const invokingDirectory = sessionDirectory(root, WORKSPACE, SESSION)
    await mkdir(invokingDirectory, { recursive: true })
    await writeFile(path.join(invokingDirectory, 'session.v4.jsonl'), [header('standard'), selection(1, 'standard')].map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8')
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: SESSION })
    expect(verdict.eligible).toBe(false)
    expect(verdict.status).toBe('wrong-preset')
    // The evidence names the invoking session's own source, not the sibling's.
    expect(verdict.evidence.source).toContain(SESSION)
    expect(verdict.evidence.source).not.toContain('session-history')
  })

  it('does not scan the sessions root when the named session is absent', async () => {
    const root = await writeSession({ id: 'session-history', records: [header('ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: WORKSPACE, sessionId: 'session-not-here' })
    expect(verdict.eligible).toBe(false)
    expect(verdict.evidence.effectivePreset).toBeUndefined()
    expect(JSON.stringify(verdict)).not.toContain('session-history')
  })

  it('fails closed when the workspace does not match the session directory', async () => {
    const root = await writeSession({ records: [header('ptc-hashline')] })
    const verdict = await verifyInvocationContext({ sessionsRoot: root, cwd: '/work/another-project', sessionId: SESSION })
    expect(verdict.eligible).toBe(false)
    expect(verdict.status).toBe('context-unverified')
  })
})

describe('projection replay and directory encoding', () => {
  it('prefers the last selection event', () => {
    expect(replayPresetProjection([header('ptc'), selection(1, 'standard'), selection(5, 'ptc-hashline')]))
      .toEqual({ headerPreset: 'ptc', selectedPreset: 'ptc-hashline', selectionSeq: 5, effective: 'ptc-hashline' })
  })

  it('falls back to the header value when no selection exists', () => {
    expect(replayPresetProjection([header('ptc-hashline')])).toEqual({ headerPreset: 'ptc-hashline', effective: 'ptc-hashline' })
  })

  it('reports no projection when neither source names one', () => {
    expect(replayPresetProjection([header()])).toEqual({})
    expect(judgeProjection({}).eligible).toBe(false)
  })

  it('encodes a workspace path the way the host does', () => {
    expect(projectKey('/work/business-project')).toBe('--work-business-project--')
    expect(projectKey('C:\\work\\proj')).toBe('--C-work-proj--')
    expect(encodeSegment('session-verify-0001')).toBe('session-verify-0001')
    // Whole-segment '.' and '..' are the only special cases; inside a segment a
    // dot is a safe character and the separator is escaped, exactly as the host
    // does (verified against its encodeSegment).
    expect(encodeSegment('..')).toBe('~002E~002E')
    expect(encodeSegment('.')).toBe('~002E')
    expect(encodeSegment('../escape')).toBe('..~002Fescape')
  })
})
