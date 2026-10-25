/**
 * PTC acceptance harness: a real `ToolRuntime` in `mode: 'ptc'` over the local
 * filesystem, this plugin, the upstream `edit`, and (optionally) the copied
 * intent-gate watchdog.
 *
 * Programs are executed by {@link InProcessPtcRuntime}, which implements the
 * production `PtcRuntime` contract; every inner call therefore travels through
 * the registry's PTC bridge and `tools/pre-execute`, not through a direct
 * ToolRuntime call.
 * @module dsh-tool-hashline/tests/ptc/harness
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolEdit from '@hy-sde-org/dsh-tool-edit'
// @ts-ignore -- plain ESM asset copied verbatim from the gate baseline
import * as Watchdog from '../../presets/ptc-hashline/intent-gate-watchdog.mjs'
import * as ToolRead from '../../packages/tool-read/src/index.ts'
import { InProcessPtcRuntime } from './carrier.ts'

export interface PtcHarnessOptions {
  read?: ToolRead.Config
  /** Mount the intent gate in enforce mode. */
  watch?: boolean
  /** Mount stock tool-fs (for the duplicate-provider negative control). */
  stockRead?: boolean
  /** Mount the production observation policy. Defaults to true. */
  policy?: boolean
  /** Mount the default-edit policy on the editor by pointing it at a module address. */
  policyModule?: string
}

export interface PtcHarness {
  ctx: Context
  runtime: ToolRuntime
  dir: string
  session: { cwd: string; header: { cwd: string } }
  agent: Agent
  runCode(code: string, options?: { agent?: Agent | null; callId?: string }): Promise<ToolExecutionResult>
  direct(name: string, args: Record<string, unknown>, options?: { agent?: Agent | null; callId?: string }): Promise<ToolExecutionResult>
  /** Feed one session event exactly as the agent loop would persist it. */
  feed(event: { type: string; data: unknown }): void
  /** Run the pre-step waterfall then feed one turn's assistant message + root call. */
  beginTurn(options: { turn?: number; text: string; callId?: string }): Promise<void>
  /** Append one USER message to this session, exactly as the agent loop does. */
  appendUserMessage(text: string): number
  cleanup(): Promise<void>
}

export async function createPtcHarness(options: PtcHarnessOptions = {}): Promise<PtcHarness> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tool-hashline-ptc-'))
  const ctx = new Context()
  // A real Session appends AND publishes every event on `session/event`; the gate
  // depends on that firehose (it maps a PTC inner dispatch back to its root call).
  const events: { type: string; data: unknown }[] = []
  const session = {
    id: 'ptc-' + Math.random().toString(36).slice(2),
    cwd: dir,
    header: { cwd: dir },
    append: (type: string, data: unknown) => {
      events.push({ type, data })
      ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, { type, data })
      return events.length
    },
    snapshotEvents: () => events,
  }
  // The PTC bridge registers the retained-environment cleanup through agent.ctx.
  const agent = { ctx, session } as unknown as Agent
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  provideWorkingDirectoryFixture(ctx, dir)
  if (options.policy !== false) await ctx.plugin(FsPolicy)
  const runtime = new ToolRuntime(ctx, { mode: 'ptc' })
  await ctx.plugin(InProcessPtcRuntime)
  await ctx.plugin(ToolRead, { defaultEditPolicyGuidance: options.policyModule !== undefined, ...options.read })
  await ctx.plugin(ToolEdit, {
    mode: 'auto',
    ...options.policyModule === undefined ? {} : { contentPolicyModule: options.policyModule },
  })
  if (options.watch === true) await ctx.plugin(Watchdog as never, { gate: 'enforce' } as never)

  let calls = 0
  let userMessages = 0
  const signal = new AbortController().signal
  const execute = (name: string, args: Record<string, unknown>, options: { agent?: Agent | null; callId?: string } = {}) => {
    const useAgent = options.agent === undefined ? agent : options.agent ?? undefined
    return runtime.execute({
      callId: (options.callId ?? `call-${(calls += 1)}`) as never,
      name,
      arguments: args,
      signal,
      ...useAgent === undefined ? {} : { agent: useAgent },
    })
  }
  return {
    ctx,
    runtime,
    dir,
    session,
    agent,
    runCode: (code, options = {}) => execute('run_code', { code, description: 'acceptance program' }, options),
    direct: (name, args, options = {}) => execute(name, args, options),
    appendUserMessage(text) {
      return session.append('user/message', {
        id: 'user-' + (userMessages += 1),
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      })
    },
    feed: event => {
      ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, event)
    },
    async beginTurn(options) {
      const turn = options.turn ?? 1
      const callId = options.callId ?? 'root-1'
      const waterfall = (ctx as unknown as { waterfall: (name: string, ...args: unknown[]) => Promise<unknown> }).waterfall
      await waterfall.call(ctx, 'agent/pre-step', {
        agent: { ctx, session, options: {} },
        messages: [{ source: { kind: 'user' }, role: 'user', content: [{ type: 'text', text: options.text }] }],
        turn,
        step: 1,
      }, () => Promise.resolve({ kind: 'enter', messages: [] }))
      ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, { type: 'turn/start', data: { turn } })
      ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, {
        type: 'assistant/message',
        data: { turn, message: { role: 'assistant', content: [{ type: 'text', text: options.text }] } },
      })
      ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, {
        type: 'tool/call',
        data: { turn, step: 1, callId, name: 'run_code', arguments: '{}' },
      })
    },
    async cleanup() {
      await (ctx as unknown as { dispose?: () => Promise<void> }).dispose?.()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export async function writeFixture(dir: string, name: string, text: string): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, text, 'utf8')
  return file
}

export const readFixture = (file: string): Promise<string> => readFile(file, 'utf8')
