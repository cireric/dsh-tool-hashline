/**
 * Policy-composition fixture: the host plane and an agent preset scope, mounted
 * the way the shipped composition mounts them.
 *
 * The shipped topology (evidence/20261023-1807-4b1d/TOPOLOGY.md) is:
 *
 *   host root ctx   → LocalFileSystem (`fs`), fs-observation-policy, ToolRuntime,
 *                     workingDirectory
 *   agent scope ctx → the preset's rows: tool-fs, tool-read, tool-edit
 *
 * The preset owns no realm around `fs` or `tools` (its `isolate` groups cover
 * planMode / compaction / workflowEngine only), so the scoped rows resolve the
 * host `fs` through ordinary context traversal and the policy's `fs/*` listeners
 * stay on the root event bus. This fixture reproduces exactly that: a real
 * `createScope` scope for the agent, the real registry on the root, the real
 * policy plugin, and the real upstream editor.
 *
 * What is NOT the real thing, disclosed per plan §4.2: the preset loader
 * (`@deepseek-ai/dsh-agent-presets`) is not installed in this checkout, so the
 * row list is mounted by hand instead of parsed from preset.patch.yml. The
 * topology claims the tests make are structural (scope identity, service
 * resolution, listener reachability) and the preset file itself is asserted
 * separately by `edit-policy-topology.spec.ts`.
 * @module dsh-tool-hashline/tests/integration/edit-policy-harness
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolEdit from '@hy-sde-org/dsh-tool-edit'
import * as ToolRead from '../../packages/tool-read/src/index.ts'

/** One write intent exactly as the editor handed it to the provider. */
export interface ProviderWrite {
  /** `fs.writeText` target spelling. */
  displayPath: string
  /** Provider identity key of the target. */
  targetKey: string
  /** `undefined` when the waterfall produced no condition (no policy mounted). */
  intent: { kind: string; version?: string } | undefined
  /** Bytes the editor asked the provider to publish. */
  content: string
  /** Version the provider saw before doing anything (undefined for a create). */
  versionBefore: string | undefined
  /** Monotonic position in this harness's ledger. */
  seq: number
}

/** One observation or write, in the order the fixture saw it. */
export interface LedgerEntry {
  seq: number
  kind: 'observed' | 'write'
  displayPath: string
  detail: string
}

/** A competing write performed between the reader and the provider's commit. */
export interface RaceRecord {
  displayPath: string
  competitorContent: string
  /** CAS basis the editor asked the provider to enforce. */
  requestedVersion: string | undefined
  /** Version right after the competitor's write landed. */
  versionAfterCompetitor: string | undefined
  /** Whether the provider's guarded write failed. */
  providerRejected: string | undefined
}

export interface PolicyHarnessOptions {
  /** Mount the production fs-observation-policy on the host plane. Defaults to true. */
  policy?: boolean
  /** Also mount stock tool-fs (`write`) in the preset scope, for the control case. */
  stockWrite?: boolean
  /** Run the registry in PTC mode. */
  ptc?: boolean
  /** Replace the editor's write with a competing write before the provider commits. */
  race?: boolean
  /** Restrict the competing write to targets whose path ends with this string. */
  raceOn?: string
  /**
   * Mount the default-edit policy on the editor registration by pointing
   * `contentPolicyModule` at a module address. Omitted = the upstream editor.
   */
  policyModule?: string
  /** Config for the mounted `read` row (the snapshot ceiling lives here). */
  read?: Record<string, unknown>
}

export interface PolicyHarness {
  /** Host root context (fs + policy + registry). */
  root: Context
  /** The mounted agent-preset scope context. */
  preset: Context
  runtime: ToolRuntime
  dir: string
  session: { cwd: string; header: { cwd: string } }
  agent: Agent
  /** `scopeOf(preset)` — the routing key the registry uses for this agent. */
  scopeKey: object | undefined
  /** Every provider write, in order. */
  writes: ProviderWrite[]
  /** Observations and writes interleaved. */
  ledger: LedgerEntry[]
  /** The recorded race, when `race: true` ran. */
  race: RaceRecord | undefined
  /** How many `fs/edit-intent` / `fs/write-intent` listeners the policy registered. */
  intentListeners: { edit: number; write: number }
  /**
   * Whether the preset scope sits in the SAME `fs` realm label as the host root.
   * Every provided service gets a root-realm label, so equality — not presence —
   * is the boundary test: a preset `isolate: { fs: … }` group would change it.
   */
  fsRealmMatchesHost: boolean
  /** Whether every `fs/edit-intent` listener is untagged (host plane, no scope). */
  intentOwnedByHostPlane: boolean
  /**
   * Dispose the preset scope and mount the same rows into a FRESH scope.
   *
   * This is the only way a test can prove that unmounting drops the policy's
   * state: the registration (and therefore its policy instance) is destroyed
   * and rebuilt, so anything a stale instance remembered would show up here.
   * @returns the new scope's key, for `schemas()`.
   */
  remount(): Promise<object | undefined>
  /**
   * Run one tool call as ANOTHER agent session, against this same host plane.
   *
   * This is how a test proves evidence is per session: the other session is a
   * real scope over the same `fs`, not a fabricated object, so a fact minted
   * here is genuinely unreachable there.
   * @param name tool name
   * @param args call arguments
   * @returns the tool result
   */
  callAsOtherSession(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** Change this session's effective working directory (the real waterfall). */
  changeWorkingDirectory(directory: string): Promise<void>
  callTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult>
  /** `read` through the registry. */
  read(file_path: string): Promise<ToolExecutionResult>
  /** `edit` through the registry in hashline mode (an `input` program). */
  edit(input: string): Promise<ToolExecutionResult>
  /** `edit` through the registry in replace mode (`file_path` + `old_string` + `new_string`). */
  replace(file_path: string, old_string: string, new_string: string): Promise<ToolExecutionResult>
  /** `write` (stock tool-fs) through the registry. */
  write(file_path: string, content: string): Promise<ToolExecutionResult>
  /** `run_code` through the registry (PTC mode only). */
  runCode(code: string): Promise<ToolExecutionResult>
  cleanup(): Promise<void>
}

const writeFixture = async (dir: string, name: string, text: string): Promise<string> => {
  const file = path.join(dir, name)
  await writeFile(file, text, 'utf8')
  return file
}

/**
 * Mount one host plane plus one preset scope over a fresh temp directory.
 * @param options - which plugins to mount and which seam to exercise.
 * @returns the harness; call `cleanup` when done.
 */
export async function createPolicyHarness(options: PolicyHarnessOptions = {}): Promise<PolicyHarness> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-hashline-policy-'))
  const events: { type: string; data: unknown }[] = []
  const session = {
    id: 'policy-' + Math.random().toString(36).slice(2),
    cwd: dir,
    header: { cwd: dir },
    // A real Session appends AND publishes every event; the PTC bridge records
    // each sub-dispatch through this seam.
    append: (type: string, data: unknown) => {
      events.push({ type, data })
      ;(root as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, { type, data })
      return events.length
    },
    snapshotEvents: () => events,
  }
  const agent = { session } as unknown as Agent

  const root = new Context()
  await root.plugin(SystemPrompt, {})
  await root.plugin(LocalFileSystem, { cwd: dir })
  provideWorkingDirectoryFixture(root, dir)
  if (options.policy !== false) await root.plugin(FsPolicy)
  const runtime = options.ptc === true
    ? new ToolRuntime(root, { mode: 'ptc' })
    : new ToolRuntime(root)
  if (options.ptc === true) {
    const { InProcessPtcRuntime } = await import('../ptc/carrier.ts')
    await root.plugin(InProcessPtcRuntime)
  }

  // The agent preset lives in its own scope, exactly as the preset registry mounts it.
  let scope = createScope(root, agent)
  ;(agent as unknown as { ctx: Context }).ctx = scope.ctx
  /** Mount the preset's rows into one agent scope (also used by the remount case). */
  const mountRows = async (target: Context): Promise<void> => {
    await target.plugin(ToolRead, options.read ?? {})
    await target.plugin(ToolEdit, {
      mode: 'auto',
      formatOnWrite: false,
      diagnosticsOnEdit: false,
      ...options.policyModule === undefined ? {} : { contentPolicyModule: options.policyModule },
    })
    if (options.stockWrite === true) await target.plugin(ToolFs, { read: false, edit: false })
  }
  await mountRows(scope.ctx)

  const hostFs = root.fs as unknown as { writeText: (...args: unknown[]) => Promise<unknown>; stat: (target: unknown, signal?: unknown) => Promise<{ version: string } | undefined> }
  const writes: ProviderWrite[] = []
  const ledger: LedgerEntry[] = []
  let ledgerSeq = 0
  let race: RaceRecord | undefined

  root.on('fs/observed', (target: { displayPath: string }, observation: { kind: string }) => {
    ledger.push({ seq: (ledgerSeq += 1), kind: 'observed', displayPath: target.displayPath, detail: observation.kind })
  })

  const originalWrite = hostFs.writeText.bind(root.fs)
  // Fixture-private wrapper: same `this`, same arguments, same return, same
  // exceptions. It only records and, when armed, performs the competitor write
  // between the editor's read and the provider's commit.
  hostFs.writeText = async (...args: unknown[]) => {
    const target = args[0] as { displayPath: string; targetKey: string }
    const content = args[1] as string
    const intent = args[2] as { kind: string; version?: string } | undefined
    const before = await hostFs.stat(args[0] as never, undefined)
    const entry: ProviderWrite = {
      displayPath: target.displayPath,
      targetKey: target.targetKey,
      intent: intent === undefined ? undefined : { ...intent },
      content,
      versionBefore: before?.version,
      seq: (ledgerSeq += 1),
    }
    writes.push(entry)
    ledger.push({ seq: entry.seq, kind: 'write', displayPath: target.displayPath, detail: intent === undefined ? 'unconditional' : intent.kind })
    // The competitor is injected by the TEST'S option alone — never conditioned on
    // the thing under test. Conditioning it on `replaceIfVersion` would silently
    // skip the race in the no-policy control, so that control would compare
    // "policy + race" against "no policy + no race" and prove nothing.
    const raced = options.race === true && (options.raceOn === undefined || target.displayPath.endsWith(options.raceOn))
    if (raced && race === undefined) {
      const competitor = 'RACER held this content\nsecond line\nthird line\n'
      await fsp.writeFile(target.displayPath, competitor, 'utf8')
      const after = await hostFs.stat(args[0] as never, undefined)
      race = {
        displayPath: target.displayPath,
        competitorContent: competitor,
        requestedVersion: intent?.version,
        versionAfterCompetitor: after?.version,
        providerRejected: undefined,
      }
      try {
        return await originalWrite(...args)
      } catch (error) {
        race.providerRejected = error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : String(error)
        throw error
      }
    }
    return originalWrite(...args)
  }

  const signal = new AbortController().signal
  // A second, real agent scope over the SAME host plane: the cross-session
  // cases need a session whose own registrations are genuine.
  const otherAgent = { session: { id: 'other-' + Math.random().toString(36).slice(2), cwd: dir, header: { cwd: dir }, append: () => 0, snapshotEvents: () => [] } } as unknown as Agent
  let otherScope: { ctx: Context; dispose: () => Promise<void> } | undefined
  let otherCalls = 0
  let calls = 0
  const callTool = (name: string, args: Record<string, unknown>) => runtime.execute({
    callId: `policy-${(calls += 1)}` as never,
    name,
    arguments: args,
    signal,
    agent,
  })

  const hooks = (root as unknown as { events: { _hooks: Record<string, unknown[]> } }).events._hooks
  return {
    root,
    preset: scope.ctx,
    runtime,
    dir,
    session,
    agent,
    scopeKey: scopeOf(scope.ctx),
    writes,
    ledger,
    get race() { return race },
    intentListeners: {
      edit: hooks['fs/edit-intent']?.length ?? 0,
      write: hooks['fs/write-intent']?.length ?? 0,
    },
    fsRealmMatchesHost: (scope.ctx as unknown as Record<symbol, Record<string, unknown>>)[Context.isolate]?.['fs']
      === (root as unknown as Record<symbol, Record<string, unknown>>)[Context.isolate]?.['fs'],
    intentOwnedByHostPlane: (hooks['fs/edit-intent'] ?? []).every(hook => scopeOf((hook as { ctx: Context }).ctx) === undefined),
    async remount() {
      await scope.dispose()
      const fresh = createScope(root, agent)
      ;(agent as unknown as { ctx: Context }).ctx = fresh.ctx
      await mountRows(fresh.ctx)
      scope = fresh
      return scopeOf(fresh.ctx)
    },
    async callAsOtherSession(name, args) {
      if (otherScope === undefined) {
        otherScope = createScope(root, otherAgent)
        await mountRows(otherScope.ctx)
      }
      return runtime.execute({
        callId: 'other-' + (otherCalls += 1) as never,
        name,
        arguments: args,
        signal,
        agent: otherAgent,
      })
    },
    async changeWorkingDirectory(directory) {
      await (root as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> })
        .waterfall.call(root, 'working-directory/change', session, directory)
    },
    callTool,
    read: file_path => callTool('read', { file_path }),
    edit: input => callTool('edit', { input }),
    replace: (file_path, old_string, new_string) => callTool('edit', { file_path, old_string, new_string }),
    write: (file_path, content) => callTool('write', { file_path, content }),
    runCode: code => callTool('run_code', { code, description: 'policy acceptance program' }),
    async cleanup() {
      if (otherScope !== undefined) await otherScope.dispose()
      await scope.dispose()
      await (root as unknown as { dispose?: () => Promise<void> }).dispose?.()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Read a fixture back as UTF-8. */
export const readFixture = (file: string): Promise<string> => readFile(file, 'utf8')

/** Write a fixture file inside the harness directory. */
export { writeFixture }
