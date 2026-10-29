/**
 * Per-task judgement of WHICH tool path a session actually used (tool-routing plan T2).
 *
 * What this module is for: the routing plan's question is not "was read called?" but "did the
 * task's own target actually flow through the applicable SDK path, and is there evidence of a
 * bypass". So the reader below is keyed on the TASK GOAL plus the TARGET FILES, and it reports
 * four things separately, because they are four different claims:
 *
 *   1. ADOPTION    — which tools were really dispatched, paired start↔settle by subCallId;
 *   2. PATH        — whether the target file's update used read → edit (Hashline) or a declared
 *                    exception (create / shell / build);
 *   3. CORRECTNESS — left to whoever checks the file on disk; this module never claims it;
 *   4. BYPASS      — split into PROVEN (a real dispatch that covers the file, e.g. a shell write
 *                    touching the target) and CANDIDATE (the program's own source mentions
 *                    `node:fs`/`child_process`). A candidate is NOT proof of a side effect, and
 *                    the plan is explicit about that, so a candidate can never be counted as a
 *                    bypass — but it does block a clean "tool path applied" verdict, because a
 *                    task with an unexplained native-FS program has not earned one.
 *
 * Missing evidence never becomes a negative finding: an unsettled dispatch, an unreadable
 * program body, or a target with no dispatch at all is UNKNOWN (and is listed as a gap), not
 * zero-bypass and not a failure.
 *
 * Inputs are the decoded durable session records the operations log reader already produces
 * (`presets/ptc-hashline/operations/session-log.mjs`), i.e. `{ type, seq, time, data }`.
 * @module dsh-tool-hashline/scripts/tool-usage-judgement
 */
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
// The decoder is the one the operations bundle already ships, so a session artifact is read
// exactly as the skills and the runtime-evidence extractor read it (frames, tears, bad lines).
import { decodeArtifact, parseRecords } from '../presets/ptc-hashline/operations/session-log.mjs'

/** The judgement a task can receive. Never a boolean: "unknown" is a first-class outcome. */
export const TASK_VERDICT = Object.freeze({
  /** The target flowed through the applicable SDK path with no unexplained candidate. */
  APPLIED: 'applied-tool-path',
  /** The task is one the plan allows to use another path (create, build, shell, no files). */
  EXCEPTION: 'normal-exception',
  /** The task needed no file work, so zero read/edit is correct, not a failure. */
  NO_FILE_WORK: 'no-file-work',
  /** Something that would have to be true is not visible in the evidence. */
  UNKNOWN: 'unknown',
  /** Positive evidence of a path the plan forbids for this task (silent bypass). */
  BYPASS: 'bypass',
})

/** Task kinds the plan names, each with its own applicable path. */
export const TASK_KIND = Object.freeze({
  TEXT_READ: 'text-read',
  TEXT_UPDATE: 'text-update',
  CREATE: 'create',
  SEARCH: 'search',
  SHELL: 'shell',
  NO_FILE: 'no-file-work',
})

/**
 * Why a task could not be judged cleanly. These are STABLE codes on purpose: two runs of two
 * different candidates can then be compared ("the same reason kept appearing") without diffing
 * prose, and a report reader can look the code up in {@link REASON_DICTIONARY}.
 */
export const UNKNOWN_REASON = Object.freeze({
  /** A dispatch started and never settled: the call's outcome is not evidence. */
  UNSETTLED_DISPATCH: 'unsettled-dispatch',
  /** The task declared no target file, so no path can be attributed to it. */
  NO_TARGET: 'no-target-declared',
  /** Nothing in the log mentions the target: absence of evidence, not evidence of absence. */
  NO_DISPATCH_FOR_TARGET: 'no-dispatch-mentions-the-target',
  /** The program body mentions native FS or a child process AND the target: not proof, not clean. */
  NATIVE_CANDIDATE: 'unexplained-native-candidate-touching-target',
  /** A read happened but no edit followed, so the update path is incomplete. */
  UPDATE_WITHOUT_EDIT: 'update-without-edit',
  /** An edit was attempted without a read of the same target. */
  EDIT_WITHOUT_READ: 'edit-without-read',
  /** A read task where the read tool never touched the target. */
  READ_NOT_USED: 'read-tool-not-used-for-target',
  /** A create task with no create call visible. */
  NO_CREATE_CALL: 'no-create-call',
  /** A search task with no search call visible. */
  NO_SEARCH_CALL: 'no-search-call',
  /** A shell task with no shell call visible. */
  NO_SHELL_CALL: 'no-shell-call',
  /** The task kind is not one this judge knows. */
  UNKNOWN_KIND: 'unknown-task-kind',
  /** The session artifact itself was torn or had unparsable records. */
  ARTIFACT_INCOMPLETE: 'session-artifact-incomplete',
})

/** Gaps in the EVIDENCE (as opposed to reasons a task stays undecided). */
export const EVIDENCE_GAP = Object.freeze({
  CALL_WITHOUT_ID: 'tool-call-without-call-id',
  START_WITHOUT_ID: 'dispatch-start-without-sub-call-id',
  SETTLE_WITHOUT_START: 'settle-without-start',
  START_WITHOUT_SETTLE: 'start-without-settle',
  PROGRAM_UNREADABLE: 'program-body-unreadable',
})

/** One-line meanings, so a report reader does not have to read this module. */
export const REASON_DICTIONARY = Object.freeze({
  [UNKNOWN_REASON.UNSETTLED_DISPATCH]: '一次派发开始了却没有结算事件；这不是"没发生"，是"没证据"。',
  [UNKNOWN_REASON.NO_TARGET]: '任务没有声明目标文件，无法把任何路径归到它名下。',
  [UNKNOWN_REASON.NO_DISPATCH_FOR_TARGET]: '日志里没有任何派发提到该目标；缺证据不等于零旁路。',
  [UNKNOWN_REASON.NATIVE_CANDIDATE]: '程序正文里出现原生 fs/子进程且提到了目标文件；这是候选信号，不是副作用证明，但足以拒绝"干净"。',
  [UNKNOWN_REASON.UPDATE_WITHOUT_EDIT]: '有 read 没有 edit，更新路径不完整。',
  [UNKNOWN_REASON.EDIT_WITHOUT_READ]: '有 edit 但没有先 read 同一目标。',
  [UNKNOWN_REASON.READ_NOT_USED]: '读取任务没有通过 read 工具读该目标（例如只搜索过）。',
  [UNKNOWN_REASON.NO_CREATE_CALL]: '创建任务里没有看到创建调用。',
  [UNKNOWN_REASON.NO_SEARCH_CALL]: '搜索任务里没有看到搜索调用。',
  [UNKNOWN_REASON.NO_SHELL_CALL]: 'shell/构建任务里没有看到平台 shell 调用。',
  [UNKNOWN_REASON.UNKNOWN_KIND]: '任务类型不在本判读已知集合内。',
  [UNKNOWN_REASON.ARTIFACT_INCOMPLETE]: '会话 artifact 自身有洞（撕裂帧/坏行），不能支撑任何"没有发生"的断言。',
  [EVIDENCE_GAP.CALL_WITHOUT_ID]: 'tool/call 事件缺 callId，无法与其他事件配对。',
  [EVIDENCE_GAP.START_WITHOUT_ID]: 'tool/ptc-dispatch-start 缺 subCallId，无法配对。',
  [EVIDENCE_GAP.SETTLE_WITHOUT_START]: '看到结算但没看到开始：可能是范围外开始，也可能日志缺行。',
  [EVIDENCE_GAP.START_WITHOUT_SETTLE]: '看到开始但没看到结算：该调用结果未知。',
  [EVIDENCE_GAP.PROGRAM_UNREADABLE]: 'run_code 的参数读不出程序正文，无法检查原生 FS 候选。',
})

/** Tools whose dispatch is a file/state change on the program's own account. */
const WRITE_TOOLS = new Set(['write', 'edit', 'bash', 'pwsh', 'shell', 'subagent', 'subagent_fork'])
/** Tools that only read. */
const READ_TOOLS = new Set(['read', 'grep', 'glob'])
/** The fixed set of static bypass candidates the program body is scanned for. */
const NATIVE_FS_PATTERNS = [
  { name: 'node:fs', pattern: /(?:require\s*\(\s*['"]node:fs|from\s+['"]node:fs|require\s*\(\s*['"]fs['"]|from\s+['"]fs['"])/u },
  { name: 'fs.write', pattern: /(?:writeFile|appendFile|createWriteStream|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync)/u },
  { name: 'child_process', pattern: /(?:child_process|execSync|spawnSync|execFileSync|spawn\s*\(|exec\s*\()/u },
]

/**
 * One settled-with-evidence view of a session's dispatches.
 * @param events - durable session events, in log order.
 * @returns { calls, programs, gaps } where calls are paired dispatches.
 */
export function readToolUsage(events) {
  const starts = new Map()
  const calls = []
  const gaps = []
  const programs = []
  const order = Array.isArray(events) ? events : []
  for (const event of order) {
    const data = event?.data
    switch (event?.type) {
      case 'tool/call': {
        // A model-direct call carries its own identity and (for run_code) the program text.
        if (typeof data?.callId !== 'string') { gaps.push({ kind: EVIDENCE_GAP.CALL_WITHOUT_ID, seq: event?.seq ?? null }); break }
        if (data.name === 'run_code') {
          const code = programSourceOf(data.arguments)
          programs.push({ callId: data.callId, ...code })
        }
        calls.push({ callId: data.callId, name: String(data.name ?? ''), state: data.name === 'run_code' ? 'settled-unknown' : 'settled-unknown', layer: 'model-direct' })
        break
      }
      case 'tool/ptc-dispatch-start': {
        if (typeof data?.subCallId !== 'string') { gaps.push({ kind: EVIDENCE_GAP.START_WITHOUT_ID, seq: event?.seq ?? null }); break }
        starts.set(data.subCallId, { subCallId: data.subCallId, parentCallId: data.parentCallId, name: String(data.name ?? ''), arguments: data.arguments, layer: 'ptc' })
        break
      }
      case 'tool/ptc-dispatch': {
        const subCallId = data?.subCallId
        const started = typeof subCallId === 'string' ? starts.get(subCallId) : undefined
        if (started === undefined) {
          gaps.push({ kind: EVIDENCE_GAP.SETTLE_WITHOUT_START, subCallId: subCallId ?? null, seq: event?.seq ?? null })
          break
        }
        starts.delete(subCallId)
        calls.push({
          subCallId,
          parentCallId: started.parentCallId,
          name: started.name,
          arguments: started.arguments,
          isError: data?.isError === true,
          state: data?.isError === true ? 'failed' : 'completed',
          layer: 'ptc',
        })
        break
      }
      default: break
    }
  }
  // A start with no settle is incomplete evidence — never a call that quietly vanished.
  for (const [subCallId, started] of starts) {
    calls.push({ subCallId, parentCallId: started.parentCallId, name: started.name, arguments: started.arguments, state: 'started', layer: 'ptc' })
    gaps.push({ kind: EVIDENCE_GAP.START_WITHOUT_SETTLE, subCallId })
  }
  return { calls, programs, gaps }
}

/** The program text of one run_code call, or an unreadable marker. */
function programSourceOf(argumentsJson) {
  if (typeof argumentsJson !== 'string') return { code: undefined, readable: false }
  try {
    const parsed = JSON.parse(argumentsJson)
    const code = typeof parsed?.code === 'string' ? parsed.code : undefined
    return code === undefined ? { code: undefined, readable: false } : { code, readable: true }
  } catch {
    return { code: undefined, readable: false }
  }
}

/**
 * Whether one dispatch concerns a path. Only the argument shapes the SDK really has are read:
 * `read`/`write` take `file_path`, `edit` takes a `[path#tag]` header inside `input`, and the
 * shell tools take a command string.
 */
export function dispatchTouches(call, target) {
  const args = call?.arguments
  if (args === null || typeof args !== 'object') return false
  const needle = String(target)
  if (typeof args.file_path === 'string') return { via: 'file_path', exact: args.file_path.endsWith(needle) || args.file_path === needle }
  if (typeof args.input === 'string' && args.input.startsWith('[')) {
    const end = args.input.indexOf('#')
    const path = end === -1 ? args.input.slice(1, args.input.indexOf(']')) : args.input.slice(1, end)
    return { via: 'edit-header', exact: path.endsWith(needle) || path === needle }
  }
  if (typeof args.command === 'string') return { via: 'shell-command', exact: args.command.includes(needle) }
  if (typeof args.pattern === 'string') return { via: 'pattern', exact: args.pattern.includes(needle) }
  return false
}

/** Only an exact path/header match counts as evidence about that file. */
function touches(call, target) {
  const hit = dispatchTouches(call, target)
  return hit !== false && hit.exact === true
}

/** Static candidates in one program body. Never proof — see the module docstring. */
export function scanProgramCandidates(program, targets) {
  if (program?.readable !== true) return { readable: false, candidates: [] }
  const candidates = []
  for (const { name, pattern } of NATIVE_FS_PATTERNS) {
    if (!pattern.test(program.code)) continue
    const mentionsTarget = (targets ?? []).some(target => program.code.includes(String(target)))
    candidates.push({ signal: name, mentionsTarget })
  }
  return { readable: true, candidates }
}

/**
 * Judge ONE task against the evidence.
 * @param input - { task: { id, kind, targets? }, events }.
 * @returns a judgement: verdict, adoption, path, gaps, provenBypass, candidates.
 */
export function judgeTaskUsage(input) {
  const task = input?.task ?? {}
  const events = Array.isArray(input?.events) ? input.events : []
  const targets = Array.isArray(task.targets) ? task.targets.map(String) : []
  const kind = task.kind ?? TASK_KIND.TEXT_UPDATE
  const { calls, programs, gaps } = readToolUsage(events)
  const unsettled = calls.filter(call => call.state === 'started')

  const adoption = { read: 0, edit: 0, write: 0, grep: 0, glob: 0, shell: 0, other: [] }
  for (const call of calls) {
    if (call.state !== 'completed' && call.state !== 'failed') continue
    if (call.name === 'read') adoption.read += 1
    else if (call.name === 'edit') adoption.edit += 1
    else if (call.name === 'write') adoption.write += 1
    else if (call.name === 'grep') adoption.grep += 1
    else if (call.name === 'glob') adoption.glob += 1
    else if (call.name === 'bash' || call.name === 'pwsh' || call.name === 'shell') adoption.shell += 1
    else if (call.name !== 'run_code') adoption.other.push(call.name)
  }

  const settled = calls.filter(call => call.state === 'completed' || call.state === 'failed')
  /** Which settled dispatch touched which target, per tool — the raw path evidence. */
  const path = { readTarget: [], editTarget: [], writeTarget: [], shellTarget: [] }
  for (const call of settled) {
    for (const target of targets) {
      if (!touches(call, target)) continue
      if (call.name === 'read') path.readTarget.push({ target, call })
      else if (call.name === 'edit') path.editTarget.push({ target, call })
      else if (call.name === 'write') path.writeTarget.push({ target, call })
      else if (call.name === 'bash' || call.name === 'pwsh' || call.name === 'shell') path.shellTarget.push({ target, call })
    }
  }
  /**
   * A PROVEN bypass is kind-dependent, because the same tool is the right answer for one task
   * and the forbidden shortcut for another: writing an existing file is the exact case the
   * Hashline default exists to prevent, while writing a NEW file is the create path. Shell
   * never stands in for a text update or a text read.
   */
  const provenBypass = []
  if (kind === TASK_KIND.TEXT_UPDATE || kind === TASK_KIND.TEXT_READ) {
    for (const entry of path.writeTarget) provenBypass.push({ reason: 'write-on-existing-target', target: entry.target, call: entry.call })
    for (const entry of path.shellTarget) provenBypass.push({ reason: 'shell-touches-target', target: entry.target, call: entry.call })
  }

  const candidate = []
  for (const program of programs) {
    const scanned = scanProgramCandidates(program, targets)
    if (scanned.readable !== true) { gaps.push({ kind: EVIDENCE_GAP.PROGRAM_UNREADABLE, callId: program.callId }); continue }
    for (const found of scanned.candidates) candidate.push({ callId: program.callId, ...found })
  }

  const result = {
    taskId: String(task.id ?? 'unknown'),
    kind,
    verdict: TASK_VERDICT.UNKNOWN,
    adoption,
    path,
    provenBypass,
    candidates: candidate,
    gaps: [...gaps],
    unknowns: [],
  }

  if (kind === TASK_KIND.NO_FILE) {
    // A network/research task with no file work: zero file tools is the CORRECT outcome.
    result.verdict = TASK_VERDICT.NO_FILE_WORK
    return result
  }
  if (unsettled.length > 0) {
    result.unknowns.push({ kind: UNKNOWN_REASON.UNSETTLED_DISPATCH, count: unsettled.length, names: unsettled.map(call => call.name) })
    return result
  }
  if (targets.length === 0) {
    result.unknowns.push({ kind: UNKNOWN_REASON.NO_TARGET })
    return result
  }
  const sawAnyTarget = path.readTarget.length + path.editTarget.length + path.writeTarget.length + path.shellTarget.length > 0
  if (!sawAnyTarget) {
    result.unknowns.push({ kind: UNKNOWN_REASON.NO_DISPATCH_FOR_TARGET })
    return result
  }
  if (provenBypass.length > 0) {
    result.verdict = TASK_VERDICT.BYPASS
    return result
  }
  const candidateForTarget = candidate.some(entry => entry.mentionsTarget === true)
  if (candidateForTarget) {
    // Not proof, so not a FAIL — but the task cannot be called clean either.
    result.unknowns.push({ kind: UNKNOWN_REASON.NATIVE_CANDIDATE })
    return result
  }
  if (kind === TASK_KIND.TEXT_UPDATE) {
    const readFirst = path.readTarget.length > 0
    const editAfter = path.editTarget.length > 0
    if (readFirst && editAfter) { result.verdict = TASK_VERDICT.APPLIED; return result }
    result.unknowns.push({ kind: readFirst ? UNKNOWN_REASON.UPDATE_WITHOUT_EDIT : UNKNOWN_REASON.EDIT_WITHOUT_READ })
    return result
  }
  if (kind === TASK_KIND.TEXT_READ) {
    if (path.readTarget.length > 0) { result.verdict = TASK_VERDICT.APPLIED; return result }
    result.unknowns.push({ kind: UNKNOWN_REASON.READ_NOT_USED })
    return result
  }
  if (kind === TASK_KIND.CREATE) {
    // Create is the declared exception: it is the one task where writing a file the plan says
    // did not exist is correct. What it may not do is reach the target through a shell redirect.
    if (path.shellTarget.length > 0) {
      result.verdict = TASK_VERDICT.BYPASS
      result.provenBypass = []
      for (const entry of path.shellTarget) result.provenBypass.push({ reason: 'shell-creates-target', target: entry.target, call: entry.call })
      return result
    }
    if (path.writeTarget.length > 0 || adoption.write > 0 || adoption.edit > 0) { result.verdict = TASK_VERDICT.EXCEPTION; return result }
    result.unknowns.push({ kind: UNKNOWN_REASON.NO_CREATE_CALL })
    return result
  }
  if (kind === TASK_KIND.SEARCH) {
    if (adoption.grep > 0 || adoption.glob > 0) { result.verdict = TASK_VERDICT.EXCEPTION; return result }
    result.unknowns.push({ kind: UNKNOWN_REASON.NO_SEARCH_CALL })
    return result
  }
  if (kind === TASK_KIND.SHELL) {
    if (adoption.shell > 0) { result.verdict = TASK_VERDICT.EXCEPTION; return result }
    result.unknowns.push({ kind: UNKNOWN_REASON.NO_SHELL_CALL })
    return result
  }
  result.unknowns.push({ kind: UNKNOWN_REASON.UNKNOWN_KIND })
  return result
}

/** A one-line, log-safe account of a judgement (no arguments, no bodies). */
export function summarizeJudgement(judgement) {
  return [
    String(judgement.taskId),
    String(judgement.kind),
    String(judgement.verdict),
    'read=' + String(judgement.adoption.read),
    'edit=' + String(judgement.adoption.edit),
    'write=' + String(judgement.adoption.write),
    'shell=' + String(judgement.adoption.shell),
    'provenBypass=' + String(judgement.provenBypass.length),
    'candidates=' + String(judgement.candidates.length),
    'gaps=' + String(judgement.gaps.length),
    'unknowns=' + String(judgement.unknowns.length),
  ].join(' ')
}

/**
 * Judge a whole session ARTIFACT against a task manifest — the entry point a maintainer uses on
 * a real session file.
 *
 * The artifact is read with the shipped decoder (concatenated Zstandard frames or plain JSONL
 * v4). A torn frame or an unparsable line is REPORTED, and the judgement of every task keeps
 * its `unknown` verdict instead of being capped as clean: a log with holes cannot support an
 * absence claim.
 * @param input - { sourcePath, tasks: [{ id, kind, targets }] }.
 * @returns { source, format, frames, torn, records, failures, judgements, summary }.
 */
export async function judgeSessionArtifact(input) {
  const sourcePath = String(input?.sourcePath ?? '')
  const tasks = Array.isArray(input?.tasks) ? input.tasks : []
  const buffer = await readFile(sourcePath)
  const decoded = decodeArtifact(buffer)
  const parsed = parseRecords(decoded.text)
  const complete = decoded.tornStart === undefined && parsed.failures.length === 0
  const judgements = tasks.map(task => {
    const judgement = judgeTaskUsage({ task, events: parsed.records })
    if (!complete) {
      // Evidence with holes can never yield the clean verdicts; keep the reason visible.
      if (judgement.verdict === TASK_VERDICT.APPLIED || judgement.verdict === TASK_VERDICT.EXCEPTION) judgement.verdict = TASK_VERDICT.UNKNOWN
      judgement.gaps.push({ kind: UNKNOWN_REASON.ARTIFACT_INCOMPLETE })
    }
    return judgement
  })
  return {
    source: sourcePath,
    format: decoded.format,
    frames: decoded.frames,
    torn: decoded.tornStart ?? null,
    records: parsed.records.length,
    failures: parsed.failures,
    complete,
    judgements,
    summary: judgements.map(summarizeJudgement),
  }
}

/** Read a task manifest: `{ tasks: [{ id, kind, targets }] }`, or a bare array of tasks. */
export function tasksOf(manifest) {
  // Accepted shapes: a bare array, `{ tasks: [...] }`, or the joint case document itself
  // (`{ cases: [...] }`) so the collection guide can point --tasks at the frozen case file.
  const raw = Array.isArray(manifest)
    ? manifest
    : Array.isArray(manifest?.tasks)
      ? manifest.tasks
      : Array.isArray(manifest?.cases)
        ? manifest.cases
        : []
  // A joint manifest carries BOTH lines: an intent-gate case (`line: 'gate'`) is judged by
  // reading its conversation, never by target paths, so it is not a tool-path task.
  return raw.filter(task => task?.line !== 'gate').map(task => ({
    id: String(task?.id ?? 'unknown'),
    kind: String(task?.kind ?? TASK_KIND.TEXT_UPDATE),
    targets: Array.isArray(task?.targets) ? task.targets.map(String) : [],
  }))
}

/**
 * CLI: `node scripts/tool-usage-judgement.mjs --source <session-artifact> --tasks <manifest.json> [--out <file>]`
 * No arguments, no bodies and no program source are written out — only the one-line summaries.
 */
async function main(argv) {
  const option = name => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const sourcePath = option('--source')
  const tasksPath = option('--tasks')
  if (sourcePath === undefined || tasksPath === undefined) {
    throw new Error('usage: node scripts/tool-usage-judgement.mjs --source <session-artifact> --tasks <manifest.json> [--out <file>]')
  }
  const manifest = JSON.parse(await readFile(tasksPath, 'utf8'))
  const result = await judgeSessionArtifact({ sourcePath, tasks: tasksOf(manifest) })
  const text = [
    'source=' + result.source,
    'format=' + result.format,
    'frames=' + String(result.frames),
    'records=' + String(result.records),
    'torn=' + (result.torn === null ? 'no' : String(result.torn)),
    'failures=' + String(result.failures.length),
    ...result.summary,
  ].join('\n') + '\n'
  const out = option('--out')
  if (out === undefined) process.stdout.write(text)
  else await writeFile(out, text, 'utf8')
  return result.complete ? 0 : 2
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    console.error('tool-usage-judgement: ' + String(error?.message ?? error))
    process.exitCode = 1
  })
}
