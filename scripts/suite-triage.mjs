/**
 * Suite triage: classify WHY each spec could not run in a given environment.
 *
 * Why this exists: the local sandbox cannot start `vitest` (vite bundles its config with esbuild
 * → `EPERM`), so a maintainer runs the specs through a plain-node runner instead and needs to
 * tell four very different things apart afterwards:
 *
 *   runs                        — the spec executed and went green under that runner;
 *   runner-gap                  — the runner lacks a vitest feature (an `it.each`, fake timers…);
 *   environment-sandbox         — the sandbox denied a syscall the spec needs (`EPERM`/`EACCES`);
 *   environment-subprocess      — a nested CLI produced nothing (same denial, seen from outside).
 *
 * The output is a MAP for the next host run, never a product verdict: a spec classified here as
 * "environment-sandbox" must be re-established on a permissive host before anything is claimed
 * about it. This module only classifies lines it is given; it does not run anything.
 * @module dsh-tool-hashline/scripts/suite-triage
 */
import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

/** One parsed triage row. */
export const TRIAGE_KIND = Object.freeze({
  RUNS: 'runs',
  RUNNER_GAP: 'runner-gap (vitest feature)',
  ENVIRONMENT_SANDBOX: 'environment-sandbox (spawn/ACL)',
  ENVIRONMENT_SUBPROCESS: 'environment-subprocess (CLI produced nothing)',
  NEEDS_HUMAN: 'needs-human',
})

/**
 * Classify one row from the per-spec log line.
 * The format is the one the runbook's loop writes:
 * `FILE|<path>|<exit>|<N passed, M failed>|<1|0 sandbox marker>|<1|0 runner marker>|<FAIL lines>|<detail lines>`
 * @param row - { file, code, summary, env, shim, fails, detail }.
 */
export function classifyRow(row) {
  if (row?.code === 0) return TRIAGE_KIND.RUNS
  const detail = String(row?.detail ?? '')
  if (row?.env === true) return TRIAGE_KIND.ENVIRONMENT_SANDBOX
  if (/toThrow|toBeTruthy|toBeTypeOf|is not a function|is not defined/i.test(detail)) return TRIAGE_KIND.RUNNER_GAP
  if (/expected null to be \d/.test(detail)) return TRIAGE_KIND.ENVIRONMENT_SUBPROCESS
  if (/expected true to be false/.test(detail)) return TRIAGE_KIND.ENVIRONMENT_SANDBOX
  return TRIAGE_KIND.NEEDS_HUMAN
}

/** Parse the triage log into rows (blank lines ignored, fields split on `|`). */
export function parseTriageLog(text) {
  return String(text ?? '').split(/\r?\n/u).filter(line => line.startsWith('FILE|')).map(line => {
    const [, file, code, summary, env, shim, fails, detail] = line.split('|')
    return { file, code: Number(code), summary: summary ?? '', env: env === '1', shim: shim === '1', fails: fails ?? '', detail: detail ?? '' }
  })
}

/** Count the classes and render the two artifacts a maintainer keeps. */
export function summarize(rows, options = {}) {
  const classified = rows.map(row => ({ ...row, kind: classifyRow(row) }))
  const counts = {}
  for (const row of classified) counts[row.kind] = (counts[row.kind] ?? 0) + 1
  const json = {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    scopeNote: 'A MAP for the next host run, not a verdict on the product: "runs" means the spec went green under the plain-node runner; every other class is a runner or sandbox limitation that a permissive host must re-establish.',
    counts,
    rows: classified,
  }
  const markdown = [
    '# Suite triage (plain-node runner)',
    '',
    json.scopeNote,
    '',
    '| class | specs |',
    '|---|---|',
    ...Object.entries(counts).map(([kind, value]) => '| ' + kind + ' | ' + String(value) + ' |'),
    '',
    '## Green under this runner',
    '',
    ...classified.filter(row => row.kind === TRIAGE_KIND.RUNS).map(row => '- `' + row.file + '` — ' + row.summary),
    '',
    '## Not green, with the reason as observed',
    '',
    ...classified.filter(row => row.kind !== TRIAGE_KIND.RUNS).map(row => '- `' + row.file + '` [' + row.kind + '] ' + (row.summary || '') + (row.detail === '' ? '' : ' — ' + String(row.detail).slice(0, 120))),
    '',
  ].join('\n')
  return { counts, json, markdown, classified }
}

/** CLI: `node scripts/suite-triage.mjs --from <triage.log> [--out <dir>]` (exit 0 always; it only classifies). */
export async function main(argv) {
  const option = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const from = option('--from')
  if (from === undefined) throw new Error('usage: --from <triage.log> [--out <dir>]')
  const rows = parseTriageLog(await readFile(from, 'utf8'))
  const result = summarize(rows)
  const out = option('--out')
  if (out === undefined) {
    process.stdout.write(JSON.stringify(result.counts, null, 2) + '\n')
    return 0
  }
  await writeFile(path.join(out, 'suite-triage.json'), JSON.stringify(result.json, null, 2) + '\n', 'utf8')
  await writeFile(path.join(out, 'suite-triage.md'), result.markdown, 'utf8')
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error('suite-triage: ' + String(error?.message ?? error))
    process.exitCode = 1
  })
}
