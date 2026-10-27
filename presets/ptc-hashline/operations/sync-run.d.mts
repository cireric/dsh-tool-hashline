/** Type surface for the read-only command runner (operations/sync-run.mjs). */

export class QueryTimeoutError extends Error {
  name: string
  timeout: true
  timeoutMs: number
  constructor(command: string, timeoutMs: number)
}

export function captureRunner(file: string, args: string[], options?: { tmpdir?: string; timeoutMs?: number }): string

export function captureStreams(file: string, args: string[], options?: { tmpdir?: string; timeoutMs?: number; shell?: boolean }): {
  status: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}
