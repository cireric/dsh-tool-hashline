/**
 * Running one read-only command and capturing its output.
 *
 * A separate module so both the check and its comparators can use it without
 * importing each other. The capture goes through a FILE DESCRIPTOR rather than a
 * pipe: a confined host sandbox refuses named pipes with EPERM, and a check that
 * answered "unknown" for every external fact there would lose its whole point.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-run
 */
import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** The error a timed-out query raises, so a caller can tell it from a refusal. */
export class QueryTimeoutError extends Error {
  /**
   * @param {string} command the command that timed out
   * @param {number} timeoutMs the budget it was given
   */
  constructor(command, timeoutMs) {
    super(command + ' did not answer within ' + String(timeoutMs) + ' ms')
    this.name = 'QueryTimeoutError'
    this.timeout = true
    this.timeoutMs = timeoutMs
  }
}

/**
 * Run one command and capture its output through a file descriptor.
 * @param {string} file the executable
 * @param {string[]} args its arguments
 * @param {{tmpdir?: string, timeoutMs?: number}} [options] capture directory and time budget
 * @returns {string} the captured stdout+stderr text
 * @throws {QueryTimeoutError} when the command exceeded its time budget
 * @throws {Error} when the command could not run or exited non-zero
 */
export function captureRunner(file, args, options = {}) {
  const directory = mkdtempSync(join(options.tmpdir ?? tmpdir(), 'dsh-sync-'))
  const target = join(directory, 'output')
  try {
    const descriptor = openSync(target, 'w')
    let result
    try {
      result = spawnSync(file, args, {
        stdio: ['ignore', descriptor, descriptor],
        // A query without a budget can hang a maintenance run; the caller decides
        // the number, this only enforces it.
        ...options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: 'SIGTERM' },
      })
    } finally {
      closeSync(descriptor)
    }
    if (result.error !== undefined) {
      if (result.error.code === 'ETIMEDOUT') throw new QueryTimeoutError(file + ' ' + args[0], options.timeoutMs ?? 0)
      throw result.error
    }
    if (result.signal !== null && result.signal !== undefined) throw new QueryTimeoutError(file + ' ' + args[0], options.timeoutMs ?? 0)
    const text = readFileSync(target, 'utf8')
    if (result.status !== 0) {
      const failure = new Error(file + ' exited ' + String(result.status) + ': ' + (text.trim().split('\n')[0] ?? ''))
      failure.status = result.status
      failure.stderr = text
      throw failure
    }
    return text
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Run one command and capture stdout and stderr SEPARATELY.
 *
 * A registry client writes warnings to stderr, so a combined capture would hand
 * the JSON parser a line of prose. Both streams still go through file
 * descriptors, for the same sandbox reason as captureRunner.
 * @param {string} file the executable
 * @param {string[]} args its arguments
 * @param {{tmpdir?: string, timeoutMs?: number}} [options] capture directory and time budget
 * @returns {{status: number | null, stdout: string, stderr: string, timedOut: boolean}} the capture
 * @throws {Error} when the command could not be started at all
 */
export function captureStreams(file, args, options = {}) {
  const directory = mkdtempSync(join(options.tmpdir ?? tmpdir(), 'dsh-sync-'))
  const outPath = join(directory, 'stdout')
  const errPath = join(directory, 'stderr')
  const outDescriptor = openSync(outPath, 'w')
  const errDescriptor = openSync(errPath, 'w')
  let result
  try {
    result = spawnSync(file, args, {
      stdio: ['ignore', outDescriptor, errDescriptor],
      // No shell: the caller that needs a .cmd shim on Windows composes the
      // cmd.exe invocation itself, so this never re-parses arguments.
      ...options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs, killSignal: 'SIGTERM' },
    })
  } finally {
    closeSync(outDescriptor)
    closeSync(errDescriptor)
  }
  const stdout = readFileSync(outPath, 'utf8')
  const stderr = readFileSync(errPath, 'utf8')
  rmSync(directory, { recursive: true, force: true })
  if (result.error !== undefined && result.error.code !== 'ETIMEDOUT') throw result.error
  const timedOut = result.error?.code === 'ETIMEDOUT' || (result.signal !== null && result.signal !== undefined)
  return { status: result.status, stdout, stderr, timedOut }
}
