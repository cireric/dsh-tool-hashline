/**
 * Real-runtime fixture for the `read` integration tier.
 *
 * Mounts the actual host services (system prompt, local filesystem provider,
 * one `ToolRuntime`) plus this plugin and the upstream `edit` plugin, so every
 * assertion goes through the same registry pipeline a deployment uses. No
 * hand-rolled edit implementation stands in for the upstream one.
 * @module @dsh-tool-hashline/tool-read/tests/harness
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
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolEdit from '@hy-sde-org/dsh-tool-edit'
import { getSessionSnapshotStore } from '@dsh-tool-hashline/hashline'
import type { InMemorySnapshotStoreOptions } from '@dsh-tool-hashline/hashline'
import * as ToolRead from '../../src/index.ts'

/** Counts of the provider calls one harness observed, for cost assertions. */
export interface FsCallCounts {
  stat: number
  readText: number
  resolve: number
}

/** A runtime plus the directory it was mounted against. */
export interface ReadHarness {
  ctx: Context
  runtime: ToolRuntime
  dir: string
  /** Stable agent identity: snapshots are keyed by the session object it carries. */
  agent: Agent
  session: object
  counts: FsCallCounts
  /** `fs/observed` events this harness saw, in order. */
  observations: { target: string; kind: string }[]
  callRead(args: { file_path: string; offset?: number; limit?: number }): Promise<ToolExecutionResult>
  callEdit(args: Record<string, unknown>): Promise<ToolExecutionResult>
  callTool(name: string, args: Record<string, unknown>, options?: CallOptions): Promise<ToolExecutionResult>
  cleanup(): Promise<void>
}

/** Per-call overrides. */
export interface CallOptions {
  /** Omit `agent` to exercise the agentless path. */
  agent?: Agent | null
  /** Cancellation signal for this call. */
  signal?: AbortSignal
}

/** Options for {@link createHarness}. */
export interface HarnessOptions {
  /** This plugin's config. */
  read?: ToolRead.Config
  /** Mount stock `tool-fs` with this config (its `read` must stay off). */
  toolFs?: ToolFs.Config
  /** Mount the fs-observation policy (required for observed-state assertions). */
  policy?: boolean
  /** Extra config for the upstream edit plugin. */
  edit?: Record<string, unknown>
  /** Snapshot-store bounds, applied when the session's store is first created. */
  snapshotStore?: InMemorySnapshotStoreOptions
}

const EMPTY_COUNTS: FsCallCounts = { stat: 0, readText: 0, resolve: 0 }

/**
 * Mount one complete read/edit stack over a fresh temp directory.
 * @param options - which plugins to mount.
 * @returns the harness; call `cleanup` when done.
 */
export async function createHarness(options: HarnessOptions = {}): Promise<ReadHarness> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-tool-hashline-read-'))
  // The fake session mimics what the read/edit tools read: `cwd` for the store key
  // and `header.cwd` for the working-directory service.
  const session = { cwd: dir, header: { cwd: dir } }
  const agent = { session } as unknown as Agent
  if (options.snapshotStore !== undefined) getSessionSnapshotStore(session, options.snapshotStore)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  // The host's own testkit fixture: a real workingDirectory service bound to the session header.
  provideWorkingDirectoryFixture(ctx, dir)
  if (options.policy === true) await ctx.plugin(FsPolicy)
  const runtime = new ToolRuntime(ctx)
  await ctx.plugin(ToolRead, options.read ?? {})
  await ctx.plugin(ToolEdit, { mode: 'auto', ...options.edit })
  if (options.toolFs !== undefined) await ctx.plugin(ToolFs, { read: false, edit: false, ...options.toolFs })

  const counts: FsCallCounts = { ...EMPTY_COUNTS }
  const fs = ctx.fs as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const method of ['stat', 'readText', 'resolve'] as const) {
    const original = fs[method]!.bind(ctx.fs)
    fs[method] = async (...args: unknown[]) => {
      counts[method] += 1
      return original(...args)
    }
  }

  // The fake session mimics what the read/edit tools read: `cwd` for the store key
  // and `header.cwd` for the working-directory service.
  const signal = new AbortController().signal
  let calls = 0
  const callTool = (name: string, args: Record<string, unknown>, options: CallOptions = {}) => {
    const useAgent = options.agent === undefined ? agent : options.agent ?? undefined
    return runtime.execute({
      callId: `call-${(calls += 1)}` as never,
      name,
      arguments: args,
      signal: options.signal ?? signal,
      ...useAgent === undefined ? {} : { agent: useAgent },
    })
  }
  const observations: { target: string; kind: string }[] = []
  ctx.on('fs/observed', (target: { displayPath: string }, observation: { kind: string }) => {
    observations.push({ target: target.displayPath, kind: observation.kind })
  })
  return {
    ctx,
    runtime,
    dir,
    agent,
    session,
    counts,
    observations,
    callRead: args => callTool('read', args),
    callEdit: args => callTool('edit', args),
    callTool,
    async cleanup() {
      await (ctx as unknown as { dispose?: () => Promise<void> }).dispose?.()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Write a fixture file inside the harness directory. */
export async function writeFixture(dir: string, name: string, text: string): Promise<string> {
  const file = path.join(dir, name)
  await writeFile(file, text, 'utf8')
  return file
}

/** Read a fixture back as UTF-8. */
export function readFixture(file: string): Promise<string> {
  return readFile(file, 'utf8')
}

/** Narrow one successful tool result to its canonical value. */
export function valueOf<T>(result: ToolExecutionResult): T {
  if (result.isError) throw new Error(`expected success, got error: ${result.error.message}`)
  return result.value as T
}