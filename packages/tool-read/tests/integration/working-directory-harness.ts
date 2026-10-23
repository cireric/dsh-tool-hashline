/**
 * Real-Session working-directory regression fixture (runtime-fix-plan phase A/B, D1).
 *
 * A production Session exposes only `header.cwd`; its effective directory lives in
 * the `workingDirectory` projection and can change at runtime. This fixture therefore
 * mounts the real `WorkingDirectory` service and real Agents — no fabricated
 * `session.cwd` — and points the filesystem's own default at a *different*
 * directory (the process cwd), so a relative path can only reach the fixture via
 * the session directory.
 *
 * The production `fs-observation-policy` is mounted by default: a real deployment
 * runs it, so a fixture without it can turn a policy rejection (MV to an unobserved
 * target) into a false green. `policy: false` keeps the no-policy contrast case.
 * @module @dsh-tool-hashline/tool-read/tests/working-directory
 */

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { AgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as ToolEdit from '@hy-sde-org/dsh-tool-edit'
import * as ToolRead from '../../src/index.ts'

/** A real-Agent read/edit stack whose session directory is not the process cwd. */
export interface RealSessionHarness {
  ctx: Context
  runtime: ToolRuntime
  loop: AgentLoopTestHarness
  agent: Agent
  root: string
  /** The Session object itself (no fabricated `cwd` property). */
  session: object
  /** Whether the production observation policy is mounted in this fixture. */
  policy: boolean
  /** Create one more Agent whose Session carries the given initial directory. */
  createAgent(id: string, cwd: string): Promise<Agent>
  read(args: { file_path: string; offset?: number; limit?: number }, agent?: Agent, signal?: AbortSignal): Promise<ToolExecutionResult>
  edit(args: Record<string, unknown>, agent?: Agent, signal?: AbortSignal): Promise<ToolExecutionResult>
  dispose(): Promise<void>
}

/**
 * Create a real Session whose initial directory is a fresh temp directory.
 * @param options - `read` config for this plugin; extra Agents with their own cwd.
 * @returns the harness; call `dispose` when done.
 */
export async function createRealSessionHarness(options: {
  read?: ToolRead.Config
  agents?: { id: string; cwd: string }[]
  /** Mount the production `fs-observation-policy`. Defaults to true. */
  policy?: boolean
} = {}): Promise<RealSessionHarness> {
  const policy = options.policy !== false
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dsh-hashline-cwd-')))
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeRuntimeContext: false } })
    // The provider's default deliberately differs from the session directory: a
    // resolution that forgets the session cwd lands in the process cwd instead.
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    await ctx.plugin(WorkingDirectory, {})
    // Mounted before the tools, exactly as the deployment composes it; the policy
    // owns no service, so ordering only has to precede the first tool call.
    if (policy) await ctx.plugin(FsPolicy)
    await ctx.plugin(ToolRead, options.read ?? {})
    await ctx.plugin(ToolEdit, { mode: 'auto' })
    const loop = await mountAgentLoopTestHarness(ctx)
    const agent = await loop.create(SessionId('cwd-owner'), {}, { cwd: root })
    const runtime = ctx.get('tools') as unknown as ToolRuntime
    let calls = 0
    const signal = new AbortController().signal
    const call = (name: string, args: Record<string, unknown>, target: Agent = agent, useSignal: AbortSignal = signal) => runtime.execute({
      callId: `cwd-call-${(calls += 1)}` as never,
      name,
      arguments: args,
      signal: useSignal,
      agent: target,
    })
    return {
      ctx,
      runtime,
      loop,
      agent,
      root,
      session: agent.session,
      policy,
      async createAgent(id, cwd) {
        await mkdir(cwd, { recursive: true })
        return loop.create(SessionId(id), {}, { cwd })
      },
      read: (args, target, useSignal) => call('read', args, target, useSignal),
      edit: (args, target, useSignal) => call('edit', args, target, useSignal),
      async dispose() {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

/** Write a fixture file inside the session directory. */
export async function writeIn(root: string, name: string, text: string): Promise<string> {
  const file = path.join(root, name)
  await writeFile(file, text, 'utf8')
  return file
}

/** Read a fixture back as UTF-8. */
export function readIn(file: string): Promise<string> {
  return readFile(file, 'utf8')
}

/** The store key the edit side must find for a session-relative path. */
export function keyIn(root: string, name: string): string {
  return path.resolve(root, name)
}
