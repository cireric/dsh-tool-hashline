/** Type surface for the upstream-sync check entry (scripts/sync-check.mjs). */

export const SYNC_FLAGS: string[]

export function parseArgs(argv: string[]): Record<string, string | true>

export function main(argv: string[], environment?: Record<string, unknown>): Promise<number>
