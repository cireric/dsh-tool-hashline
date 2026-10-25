/**
 * Resolved `tool-read` configuration.
 *
 * The three window caps mirror the host's `readLimit` / `readMaxLineLength` /
 * `readMaxBytes` defaults. They are **mirrored constants**, not values read from
 * the host: this plugin must not import a host implementation or read
 * `tool-fs`'s config (see the requirements spec NFR-4/FR-10). The preset writes
 * the same numbers on both rows and `check:preset` asserts they stay equal.
 * @module @dsh-tool-hashline/tool-read/config
 */

/** Default and maximum number of lines returned by one `read` call. */
export const DEFAULT_LIMIT = 2000

/** Default maximum characters returned for a single line. */
export const DEFAULT_MAX_LINE_LENGTH = 2000

/** Default maximum bytes returned for selected file lines (50 KiB). */
export const DEFAULT_MAX_BYTES = 51_200

/** Default ceiling on the normalized UTF-8 text a snapshot tag is minted for (4 MiB). */
export const DEFAULT_SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024

/** Plugin config as authored in the preset. */
export interface Config {
  /** `false` keeps this plugin from registering `read` (pair it with stock `tool-fs.read`). */
  enabled?: boolean
  /** Normalized UTF-8 bytes at or above this value are not snapshotted. */
  snapshotMaxBytes?: number
  /** Window byte cap, same semantics as the host's `readMaxBytes`. */
  maxBytes?: number
  /** Window line cap, same semantics as the host's `readLimit`. */
  limit?: number
  /** Per-line character cap, same semantics as the host's `readMaxLineLength`. */
  maxLineLength?: number
  /** Enable the managed default-edit policy's guidance in this registration only. */
  defaultEditPolicyGuidance?: boolean
}

/** Config after defaulting and validation. */
export interface ResolvedConfig {
  enabled: boolean
  snapshotMaxBytes: number
  maxBytes: number
  limit: number
  maxLineLength: number
  defaultEditPolicyGuidance: boolean
}

function positiveInteger(value: number, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`tool-read config "${key}" must be a finite positive integer`)
  }
  return value
}

/**
 * Apply defaults and reject non-positive or non-finite numeric config.
 *
 * Invalid values fail the mount (throwing here fails `ctx.plugin`) instead of
 * being silently corrected, and the message names the offending config key.
 * @param config - the authored plugin config.
 * @returns the validated config with every numeric field resolved.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  return {
    enabled: config.enabled !== false,
    defaultEditPolicyGuidance: config.defaultEditPolicyGuidance === true,
    snapshotMaxBytes: positiveInteger(config.snapshotMaxBytes ?? DEFAULT_SNAPSHOT_MAX_BYTES, 'snapshotMaxBytes'),
    maxBytes: positiveInteger(config.maxBytes ?? DEFAULT_MAX_BYTES, 'maxBytes'),
    limit: positiveInteger(config.limit ?? DEFAULT_LIMIT, 'limit'),
    maxLineLength: positiveInteger(config.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH, 'maxLineLength'),
  }
}
