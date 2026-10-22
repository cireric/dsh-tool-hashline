/**
 * Read-side hashline decorator — STUB.
 *
 * Target: listen to `tools/post-execute` for `read`, mint `[path#TAG]` for small
 * files into the session snapshot store, and insert the header inside `<content>`.
 * Full design and pitfalls: ../../HANDOFF.md §6.
 *
 * Do not publish this stub.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-read-hashline'
export const inject = ['tools', 'fs'] as const

export interface Config {
  /** Disable the decorator without unmounting the row. */
  enabled?: boolean
  /** Files at or above this size are not snapshotted. Defaults to SNAPSHOT_MAX_BYTES. */
  maxBytes?: number
}

export function apply(ctx: Context, config: Config = {}): void {
  void ctx
  void config
  // TODO(M1): ctx.on("tools/post-execute", async (exec, result, next) => { ... })
  // See HANDOFF.md §6 for the exact algorithm and failure handling.
}
