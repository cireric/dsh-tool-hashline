/** Emit an editable, fully expanded task pack. No profile, provider or model I/O. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const generator = "import fs from 'node:fs'\nconst data = JSON.parse(fs.readFileSync('source.json', 'utf8'))\nfs.writeFileSync('generated.txt', data.items.map(item => item.toUpperCase()).join('\\n') + '\\n')\n"

export function defaultTasks() {
  // Repeated unchanged bytes are constants, never derived from actual model output.
  const longLine = 'L'.repeat(5000)
  const padding = 'padding=unchanged\n'.repeat(250000)
  const task = (id, family, prompt, initial, expected, options = {}) => ({
    id, family, class: 'known-applicable', batchBoundary: 'first-edit-program', prompt, initial, expected, ...options,
  })
  const tasks = [
    task('single', 'single-point', 'In account.txt change status=pending to status=active. Preserve all other bytes.',
      { 'account.txt': 'status=pending\nowner=example\n' }, { 'account.txt': 'status=active\nowner=example\n' }),
    task('repeated', 'repeated-fragment', 'In records.txt change status to active only inside [second]. The identical pending value in [first] must stay unchanged.',
      { 'records.txt': '[first]\nstatus=pending\n[second]\nstatus=pending\n' }, { 'records.txt': '[first]\nstatus=pending\n[second]\nstatus=active\n' }),
    task('multi', 'multi-site', 'Change both pending statuses in a.txt to active, and change enabled=false to enabled=true in b.txt. Preserve all other bytes.',
      { 'a.txt': 'left=pending\nkeep=yes\nright=pending\n', 'b.txt': 'enabled=false\nowner=example\n' },
      { 'a.txt': 'left=active\nkeep=yes\nright=active\n', 'b.txt': 'enabled=true\nowner=example\n' }),
    task('consecutive', 'consecutive-edits', 'In sequence.txt first insert middle=ready after start=yes and verify that intermediate state. Then change tail=pending to tail=active using the current file. Preserve the other content.',
      { 'sequence.txt': 'start=yes\ntail=pending\n' }, { 'sequence.txt': 'start=yes\nmiddle=ready\ntail=active\n' }),
    task('drift', 'external-change', 'Read account.txt before editing. Change only status=pending to status=active. Another process may update audit; preserve its latest value. If the file changes, inspect current content before recovering.',
      { 'account.txt': 'status=pending\naudit=original\n' }, { 'account.txt': 'status=active\naudit=peer\n' },
      { stimuli: [{ id: 'peer', path: 'account.txt', afterRead: 1, before: 'status=pending\naudit=original\n', after: 'status=pending\naudit=peer\n' }] }),
    task('unrelated-long', 'unrelated-long-line', 'In mixed.txt change status=pending on the last line to status=active. The unrelated long first line must remain byte-for-byte unchanged. Read the target line separately if needed.',
      { 'mixed.txt': longLine + '\nstatus=pending\n' }, { 'mixed.txt': longLine + '\nstatus=active\n' }),
    task('target-long', 'target-long-line', 'In long.txt change the terminal status=pending on its long single line to status=active. Preserve every preceding L and the final newline. Read through the normal tool first; a read-only local Node command is also authorized to obtain the complete text if its window is insufficient. Do not invent truncated bytes or change tool configuration.',
      { 'long.txt': longLine + ':status=pending\n' }, { 'long.txt': longLine + ':status=active\n' }, { class: 'declared-exception' }),
    task('snapshot-limit', 'restricted-degradation', 'In large.txt change only its first line status=pending to status=active. Preserve all padding and the final newline. Read through the normal tool first. Read-only local Node commands are authorized to acquire complete source content if read cannot mint a tag; follow the actual tool policy and stop if no valid edit route is available. Do not change tool configuration.',
      { 'large.txt': 'status=pending\n' + padding }, { 'large.txt': 'status=active\n' + padding }, { class: 'declared-exception' }),
    task('rewrite', 'large-rewrite', 'Rewrite routes.txt as version=2 followed by 128 route lines /route/1=active through /route/128=active in numeric order. Remove all legacy values. Every line ends in LF, including the last.',
      { 'routes.txt': 'version=1\n' + Array.from({ length: 128 }, (_, i) => '/route/' + (i + 1) + '=legacy\n').join('') },
      { 'routes.txt': 'version=2\n' + Array.from({ length: 128 }, (_, i) => '/route/' + (i + 1) + '=active\n').join('') }),
    task('satisfied', 'already-satisfied', 'Verify account.txt has status=active and owner=example. If already satisfied, leave all bytes unchanged; do not manufacture an edit.',
      { 'account.txt': 'status=active\nowner=example\n' }, { 'account.txt': 'status=active\nowner=example\n' }, { class: 'no-change-needed', batchBoundary: 'task-end' }),
    task('create', 'creation', 'Create new.txt containing exactly created=yes followed by LF. Do not create other files.',
      {}, { 'new.txt': 'created=yes\n' }, { class: 'declared-exception', batchBoundary: 'task-end' }),
    task('override', 'user-override', 'For this task I explicitly request replace mode with old_string/new_string for account.txt: replace status=pending with status=active, preserving owner and final LF. This request covers only this file and this change; if your tool does not support that mode, report the limitation.',
      { 'account.txt': 'status=pending\nowner=example\n' }, { 'account.txt': 'status=active\nowner=example\n' }, { class: 'declared-exception' }),
    task('generator', 'special-tool', 'generated.txt is maintained by the supplied generate.mjs from source.json. Run node generate.mjs in this task directory to regenerate it. Do not hand-edit generated.txt or modify the generator/source. Verify the resulting file. This local generator invocation is authorized.',
      { 'source.json': '{"items":["alpha","beta"]}\n', 'generate.mjs': generator, 'generated.txt': 'STALE\n' },
      { 'source.json': '{"items":["alpha","beta"]}\n', 'generate.mjs': generator, 'generated.txt': 'ALPHA\nBETA\n' }, { class: 'declared-exception', batchBoundary: 'task-end' }),
  ]
  return tasks.map(t => ({ ...t, targets: Object.keys(t.expected).filter(file => t.expected[file] !== t.initial[file]).map(file => ({ id: file, path: file, goal: t.prompt, class: t.class })) }))
}

export function buildTaskSuiteConfig() {
  const config = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./experiment.example.json', import.meta.url)), 'utf8'))
  config.id = 'default-edit-suite-v1-candidate'
  config.kind = 'probe'
  config.limits = [
    'Thirteen-family candidate pack, not a completed formal experiment or benefit claim.',
    'One case per family is not representative coverage. Review tasks and thresholds before any formal run.',
    'Final bytes cannot independently prove intermediate-step or generator-invocation compliance; inspect traces.',
    'Long-line and snapshot cases assume the pinned preset caps; review the actual frozen configuration.',
    'Strict Hashline may fail exception tasks. Retain failures; never revise expected from actual output.',
  ]
  config.tasks = defaultTasks()
  const excluded = new Map([
    ['satisfied', 'Task requires verification without an edit.'],
    ['create', 'Creation may use write and has no edit checkpoint.'],
    ['generator', 'Project generator is an external tool; edit checkpoint is not the metric.'],
  ])
  config.passConditions.firstCandidateScope = {
    include: config.tasks.filter(t => !excluded.has(t.id)).map(t => t.id),
    exclude: [...excluded].map(([taskId, reason]) => ({ taskId, reason })),
  }
  return config
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [out, ...extra] = process.argv.slice(2)
  try {
    if (!out || extra.length) throw new Error('usage: task-suite.mjs <new-editable-experiment.json>')
    fs.writeFileSync(out, JSON.stringify(buildTaskSuiteConfig(), null, 2) + '\n', { flag: 'wx' })
    console.log('candidate task pack written; fill model, budgets and conditions, then prepare; no model requests made')
  } catch (error) { console.error('task suite refused: ' + error.message); process.exitCode = 2 }
}
