/**
 * DRY-RUN rehearsal of the joint real-model acceptance pipeline (intent-gate P6 + tool-routing T4).
 *
 * What it proves: the pipeline the [collection guide](../../docs/plans/2026-10-28-joint-evaluation-collection.md)
 * describes actually runs end to end on real artifacts — session artifact → extractor report
 * (declaration + cost + tool path) → runs.json → reconciliation — and that the commands accept
 * the shapes the guide tells a maintainer to produce.
 *
 * What it does NOT prove, and must never be read as: model behaviour. The two artifacts below
 * are FIXED fixtures written by this script (a scripted provider's output, not a model's), so
 * this rehearsal covers the plumbing only. Real acceptance still needs the frozen cases, the
 * user's approved model/parameters/prices/caps, and 40 real conversations.
 *
 * Everything runs in-process through the SAME entry points the CLI uses
 * (`extract-runtime-evidence.mjs#main`, `joint-plan.mjs#main`), because this sandbox denies
 * child processes; the argument parsing and exit codes under test are the real ones.
 * @module dsh-tool-hashline/scripts/evaluation/joint-rehearsal
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { main as extractMain } from '../extract-runtime-evidence.mjs'
import { main as planMain } from './joint-plan.mjs'

/** One durable session record, in the format the shipped decoder reads. */
const rec = (type, seq, data) => JSON.stringify({ type, seq, time: 0, data })

/** The case ids this rehearsal exercises: one intent-gate case and one tool-path case. */
export const REHEARSAL_CASES = Object.freeze(['G1', 'T3'])

/** A gate-case session: undeclared attempt → repair → declaration → business step. */
const gateSession = () => [
  JSON.stringify({ type: 'session', version: 4, id: 'rehearsal-G1', cwd: '.', agentPreset: 'ptc-hashline' }),
  rec('user/message', 1, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '判断支付能否上线。' }] }),
  rec('assistant/attempt', 2, { turn: 1, step: 1, stream: [], usage: { inputTokens: 11, outputTokens: 7 } }),
  rec('turn/end', 3, { turn: 1, reason: { kind: 'error', error: { code: 'INTENT_DECLARATION_MISSING' } } }),
  rec('user/message', 4, { role: 'user', source: { kind: 'intent-gate-watchdog', form: 'notice', summary: 'repair' }, content: [{ type: 'text', text: '[intent-gate] Your previous reply for this request was withheld: no marker.' }] }),
  rec('assistant/message', 5, { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Intent: assess the hold versus the exception path; I will ask which one applies.' }] }, stream: [] }),
  rec('tool/call', 6, { turn: 2, step: 2, callId: 'q-call', name: 'ask_user_question', arguments: '{}' }),
  rec('tool/result', 7, { turn: 2, step: 2, message: { role: 'tool', toolCallId: 'q-call', source: { kind: 'tool', callId: 'q-call' }, content: [{ type: 'text', text: '{"answers":[{"id":"pick","selected":["按默认暂缓评估"]}]}' }] } }),
  rec('turn/end', 8, { turn: 2, reason: { kind: 'completed' } }),
]

/** A tool-case session: read → edit on the declared target. */
const toolSession = () => [
  JSON.stringify({ type: 'session', version: 4, id: 'rehearsal-T3', cwd: '.', agentPreset: 'ptc-hashline' }),
  rec('user/message', 1, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把 retries 从 3 改成 5。' }] }),
  rec('assistant/message', 2, { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'Intent: set retries to 5; I will read fixtures/config.json then edit it.' }] }, stream: [], usage: { inputTokens: 13, outputTokens: 9 } }),
  rec('tool/call', 3, { turn: 1, step: 1, callId: 'root-3', name: 'run_code', arguments: JSON.stringify({ code: "const r = await tools.read({ file_path: 'fixtures/config.json' }); await tools.edit({ input: '[fixtures/config.json#' + r.tag + ']\\nPUT 3.=3:\\n+  \"retries\": 5' }); return 'ok'", description: 'update' }) }),
  rec('tool/ptc-dispatch-start', 4, { rootCallId: 'root-3', parentCallId: 'root-3', subCallId: 'root-3:ptc:1', name: 'read', arguments: { file_path: 'fixtures/config.json' } }),
  rec('tool/ptc-dispatch', 5, { rootCallId: 'root-3', parentCallId: 'root-3', subCallId: 'root-3:ptc:1', name: 'read', arguments: { file_path: 'fixtures/config.json' }, isError: false, content: [] }),
  rec('tool/ptc-dispatch-start', 6, { rootCallId: 'root-3', parentCallId: 'root-3', subCallId: 'root-3:ptc:2', name: 'edit', arguments: { input: '[fixtures/config.json#ABCD]' } }),
  rec('tool/ptc-dispatch', 7, { rootCallId: 'root-3', parentCallId: 'root-3', subCallId: 'root-3:ptc:2', name: 'edit', arguments: { input: '[fixtures/config.json#ABCD]' }, isError: false, content: [] }),
  rec('tool/result', 8, { turn: 1, step: 1, toolCallId: 'root-3', message: { role: 'tool', toolCallId: 'root-3', source: { kind: 'tool', callId: 'root-3' }, content: [{ type: 'text', text: 'ok' }] } }),
  rec('turn/end', 9, { turn: 1, reason: { kind: 'completed' } }),
]

/** Write one session artifact and its extractor report, exactly as the collection guide says. */
async function collect({ root, casesPath, tasksJson, caseId, sessionId, lines }) {
  const dir = path.join(root, 'case-' + caseId, 'a')
  await mkdir(dir, { recursive: true })
  const artifact = path.join(dir, 'session.jsonl')
  await writeFile(artifact, lines.join('\n') + '\n', 'utf8')
  const report = path.join(dir, 'report.json')
  const code = await extractMain(['--source', artifact, '--session', sessionId, '--tasks', casesPath, '--out', report])
  return { caseId, session: 'a', artifact, report, exit: code, tasksJson }
}

/**
 * Run the rehearsal.
 * @param input - { root, cases path default to the shipped frozen cases }.
 * @returns a summary of what each step produced and whether the reconciliation is consistent.
 */
export async function rehearsal(input = {}) {
  const root = path.resolve(input.root ?? path.join(process.cwd(), '.tmp', 'joint-rehearsal-' + Date.now()))
  const casesPath = path.resolve(input.casesPath ?? path.join(process.cwd(), 'docs/plans/2026-10-28-joint-real-model-cases.json'))
  await mkdir(root, { recursive: true })

  const gate = await collect({ root, casesPath, caseId: 'G1', sessionId: 'rehearsal-G1', lines: gateSession() })
  const tool = await collect({ root, casesPath, caseId: 'T3', sessionId: 'rehearsal-T3', lines: toolSession() })

  const runs = {
    _note: 'DRY-RUN rehearsal output: fixed fixtures produced by scripts/evaluation/joint-rehearsal.mjs, NOT model transcripts.',
    runs: [
      { caseId: gate.caseId, session: gate.session, report: JSON.parse(await readFile(gate.report, 'utf8')) },
      { caseId: tool.caseId, session: tool.session, report: JSON.parse(await readFile(tool.report, 'utf8')) },
    ],
  }
  const runsPath = path.join(root, 'runs.json')
  await writeFile(runsPath, JSON.stringify(runs, null, 2) + '\n', 'utf8')
  const reconciliationPath = path.join(root, 'reconciliation.json')
  const reconcileExit = await planMain(['--cases', casesPath, '--runs', runsPath, '--out', reconciliationPath])
  const reconciliation = JSON.parse(await readFile(reconciliationPath, 'utf8'))

  const row = caseId => reconciliation.rows.find(entry => entry.caseId === caseId)
  const summary = {
    mode: 'dry-run-rehearsal',
    root,
    extractExits: { G1: gate.exit, T3: tool.exit },
    reconcileExit,
    rows: reconciliation.rows.length,
    gaps: reconciliation.gaps.length,
    totals: reconciliation.totals,
    gateCase: row('G1') === undefined ? null : { declaration: row('G1').declaration, toolPath: row('G1').toolPath },
    toolCase: row('T3') === undefined ? null : { declaration: row('T3').declaration, toolPath: row('T3').toolPath },
  }
  // The pipeline is consistent only if: both artifacts extracted, both cases have a row, the
  // other 38 conversations are GAPS, and the tool case used the declared path.
  summary.consistent = summary.extractExits.G1 === 0 && summary.extractExits.T3 === 0
    && summary.reconcileExit === 0
    && summary.rows === 2
    && summary.gaps === 38
    && summary.toolCase?.toolPath?.verdict === 'applied-tool-path'
  return summary
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rootIndex = process.argv.indexOf('--root')
  rehearsal(rootIndex === -1 ? {} : { root: process.argv[rootIndex + 1] }).then(summary => {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
    process.exitCode = summary.consistent ? 0 : 2
  }, error => {
    console.error('joint-rehearsal: ' + String(error?.message ?? error))
    process.exitCode = 1
  })
}
