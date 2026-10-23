/**
 * Session-scoped path helpers shared by the read tool and the (upstream) edit
 * tool.
 *
 * The snapshot store key must be byte-identical to `tool-edit`'s
 * `canonicalPath` = `path.resolve(session cwd, authored path)`; a different key
 * silently loses the read's seen-line provenance. The working directory mirrors
 * `toolCwdFromExec`: `exec.agent?.session?.cwd`, falling back to the process cwd.
 * @module @dsh-tool-hashline/tool-read/session
 */

import * as path from 'node:path'

/** The slice of a tool execution this module needs. */
export interface ExecLike {
  agent?: { session?: unknown } | undefined
}

/**
 * Read `session.cwd` exactly as `tool-edit` does.
 *
 * `Session` in DSH 0.2.1-rc.2 exposes `header.cwd`, not `cwd`, so this is
 * normally `undefined` and both tools fall back to the process cwd. The
 * expression is kept identical to `toolCwdFromExec` so the two store-key
 * algorithms cannot drift if a later host adds the property.
 * @param session - the agent session, if any.
 * @returns the session cwd when the runtime exposes it, else `undefined`.
 */
function sessionCwd(session: unknown): string | undefined {
  if (typeof session !== 'object' || session === null) return undefined
  const cwd = (session as { cwd?: unknown }).cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * Resolve the working directory the edit tool would use for the same execution.
 * @param exec - the current tool execution.
 * @returns the session cwd when present, else `process.cwd()`.
 */
export function toolCwd(exec: ExecLike): string {
  return sessionCwd(exec.agent?.session) ?? process.cwd()
}

/**
 * Every store key a read of `inputPath` must record.
 *
 * The model may copy the returned show path back into `edit`, so the resolved
 * show path is recorded too whenever it differs from the input-key resolution
 * (a symlink alias or a backend that resolves to a different real path). Identical keys are recorded once.
 * @param cwd - the edit tool's working directory.
 * @param inputPath - the model-authored `file_path`.
 * @param showPath - the model-facing path this read returned.
 * @returns one unique store key, or two distinct ones.
 */
export function snapshotKeys(cwd: string, inputPath: string, showPath: string): string[] {
  const inputKey = path.resolve(cwd, inputPath)
  const showKey = path.resolve(cwd, showPath)
  return showKey === inputKey ? [inputKey] : [inputKey, showKey]
}
