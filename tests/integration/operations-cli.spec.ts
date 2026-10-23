/**
 * The operations CLI contract: exit codes, no side effects on a refusal, and
 * baseline output that names its gaps. Exercised both in-process (injected
 * environment) and as a real child process, because a skill runs it through the
 * shell tool.
 */
import { execFile, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { EXIT, installationRoot, main, parseFlags, resolveEnvironment, run } from '../../presets/ptc-hashline/operations/cli.mjs'
import { encodeSegment, projectKey } from '../../presets/ptc-hashline/operations/session-log.mjs'

const execFileAsync = promisify(execFile)
const CLI = path.resolve(process.cwd(), 'presets/ptc-hashline/operations/cli.mjs')
const WORKSPACE = '/work/business-project'
const SESSION = 'session-cli-0001'
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

interface SessionFixture {
  id?: string
  cwd?: string
  route?: { provider: string; model: string }
}

/** Create a sessions root holding one session with the given preset and route. */
async function sessionsRoot(preset: string | undefined, options: SessionFixture = {}): Promise<string> {
  const root = await temp('operations-cli-sessions-')
  const cwd = options.cwd ?? WORKSPACE
  const id = options.id ?? SESSION
  const directory = path.join(root, projectKey(cwd), encodeSegment(id))
  await mkdir(directory, { recursive: true })
  const records: unknown[] = [
    { type: 'session', version: 4, id, cwd, createdAt: 1, isSeeded: false, delegationDepth: 0, ...preset === undefined ? {} : { agentPreset: preset } },
  ]
  if (options.route !== undefined) {
    records.push({ type: 'request/header', seq: 1, data: { header: { config: options.route, tools: [] } } })
  }
  await writeFile(path.join(directory, 'session.v4.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8')
  return root
}

/** Run the CLI as a child process with an explicit environment. */
async function runChild(argv: string[], env: Record<string, string>): Promise<{ code: number; json?: unknown; stderr: string }> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [CLI, ...argv], { env: { ...process.env, ...env }, encoding: 'utf8' })
    return { code: 0, json: JSON.parse(stdout), stderr: '' }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    const stdout = (failure.stdout ?? '').trim()
    return { code: failure.code ?? -1, json: stdout === '' ? undefined : JSON.parse(stdout), stderr: failure.stderr ?? '' }
  }
}

/** Copy one fixture sessions root's project directories into another. */
async function mergeSessions(into: string, from: string): Promise<string> {
  for (const project of await readdir(from)) {
    await cp(path.join(from, project), path.join(into, project), { recursive: true })
  }
  return into
}

describe('context command: the workflow guard', () => {
  it('exits 0 for the target preset and 2 for anything else', async () => {
    const eligibleRoot = await sessionsRoot('ptc-hashline')
    const eligible = await run(['context'], { env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }, sessionsRoot: eligibleRoot })
    expect(eligible.code).toBe(EXIT.ok)
    expect(eligible.value.eligible).toBe(true)

    const wrongRoot = await sessionsRoot('standard')
    const wrong = await run(['context'], { env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }, sessionsRoot: wrongRoot })
    expect(wrong.code).toBe(EXIT.stopped)
    expect(wrong.value.status).toBe('wrong-preset')
  })

  it('reads the session id from the environment, never from a default', async () => {
    const root = await sessionsRoot('ptc-hashline')
    const verdict = await run(['context'], { env: { PWD: WORKSPACE }, sessionsRoot: root })
    expect(verdict.code).toBe(EXIT.stopped)
    expect(verdict.value.reason).toContain('DSH_SESSION_ID')
  })
  it('cannot be authorized by naming another session (SCOPE-05)', async () => {
    // The invoking session is NOT the target preset...
    const root = await sessionsRoot('ptc-gate')
    const invoking = await sessionsRoot('ptc-hashline', { id: 'session-history', cwd: '/work/history' })
    const merged = await mergeSessions(root, invoking)
    // ...while a historical session in the same root really is ptc-hashline.
    const verdict = await run(
      ['context', '--session', 'session-history', '--cwd', '/work/history'],
      { env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }, sessionsRoot: merged },
    )
    expect(verdict.code).toBe(EXIT.stopped)
    expect(verdict.value.eligible).toBe(false)
    expect(verdict.value.status).toBe('wrong-preset')
    // The named session is reported as the analyzed TARGET, not as authority.
    expect(verdict.value.target.session).toBe('session-history')
    // The evidence is the INVOKING session's own projection.
    expect(verdict.value.evidence.source).toContain(SESSION)
    expect(verdict.value.evidence.source).not.toContain('session-history')
  })

  it('runs as a child process and writes nothing on a refusal', async () => {
    const state = await temp('operations-cli-state-')
    const before = await readdir(state, { recursive: true })
    // The child reads the real host home, so point it at a fixture home whose
    // sessions root holds no such session: the answer must be a stop.
    const direct = await runChild(['context'], { DSH_SESSION_ID: SESSION, PWD: WORKSPACE, DSH_HOME: path.dirname(state) })
    expect(direct.code).toBe(2)
    expect((await readdir(state, { recursive: true })).sort()).toEqual(before.sort())
  })
})

describe('config command: explicit assignment only', () => {
  it('shows an unconfigured state without inventing a default', async () => {
    const state = await temp('operations-cli-state-')
    const result = await run(['config'], { env: {}, stateDir: state })
    expect(result.code).toBe(EXIT.ok)
    expect(result.value.roles.maintenanceRepository.configured).toBe(false)
    expect(result.value.roles.evidenceDirectory.configured).toBe(false)
  })

  it('saves both roles when the user names them', async () => {
    const state = await temp('operations-cli-state-')
    const repository = await temp('operations-cli-repo-')
    const evidence = await temp('operations-cli-evidence-')
    const result = await run(['config', '--set-maintenance-repo', repository, '--set-evidence-dir', evidence], { env: {}, stateDir: state })
    expect(result.code).toBe(EXIT.ok)
    expect(result.value.values.maintenanceRepository).toBe(repository)
    expect(result.value.values.evidenceDirectory).toBe(evidence)
    const reread = await run(['config'], { env: {}, stateDir: state })
    expect(reread.value.values.maintenanceRepository).toBe(repository)
  })

  it('refuses a relative assignment', async () => {
    const state = await temp('operations-cli-state-')
    await expect(run(['config', '--set-maintenance-repo', 'relative'], { env: {}, stateDir: state }))
      .rejects.toThrow(/absolute path/u)
  })
})

describe('baseline command: real facts, named gaps', () => {
  it('reports the running combination and marks unconfigured roles unknown', async () => {
    const state = await temp('operations-cli-state-')
    const result = await run(['baseline'], { env: {}, stateDir: state })
    expect(result.code).toBe(EXIT.ok)
    const baseline = result.value.baseline
    expect(baseline.roles.installation.root).toBe(installationRoot())
    expect(baseline.roles.maintenanceRepository).toBe('unknown')
    expect(baseline.versions.tools).toMatch(/^\d+\.\d+\.\d+/u)
    expect(baseline.engines.hashline.patch.status).toBe('patched')
    // The baseline also reports why the invocation was or was not eligible,
    // without pretending a missing session is a pass.
    expect(result.value.context.eligible).toBe(false)
    expect(result.value.context.status).toBe('context-unverified')
  })
  it('uses the saved maintenance repository as a role, not as the installation root', async () => {
    const state = await temp('operations-cli-state-')
    // A separate real worktree: in a development LINK the two roles coincide,
    const repository = await temp('operations-cli-repo-')
    execFileSync('git', ['init', '-q', repository])
    // One commit, so HEAD resolves and the dirty signal is meaningful; a
    // repository with no commit is a legitimate `unknown`, tested separately.
    await writeFile(path.join(repository, 'README.md'), 'fixture\n', 'utf8')
    execFileSync('git', ['-C', repository, 'add', '.'])
    execFileSync('git', ['-C', repository, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
    await run(['config', '--set-maintenance-repo', repository], { env: {}, stateDir: state })
    const result = await run(['baseline'], { env: {}, stateDir: state })
    expect(result.value.baseline.roles.maintenanceRepository).toBe(repository)
    expect(result.value.baseline.roles.installation.root).toBe(installationRoot())
    expect(result.value.baseline.roles.installation.root).not.toBe(repository)
    expect(result.value.baseline.repository.dirty).toBe('clean')
    // No lockfile and no patches in this fixture: both are reported as such.
    expect(result.value.baseline.repository.lockfileSha256).toBe('unknown')
    expect(result.value.baseline.repository.patchFiles).toEqual([])
  })

  it('reports the provider and model the host recorded for this session', async () => {
    const state = await temp('operations-cli-state-')
    const root = await sessionsRoot('ptc-hashline', { route: { provider: 'trae', model: 'deepseek-v4.1-flash' } })
    const result = await run(['baseline'], { env: { DSH_SESSION_ID: SESSION, PWD: WORKSPACE }, sessionsRoot: root, stateDir: state })
    expect(result.value.baseline.session.provider).toBe('trae')
    expect(result.value.baseline.session.model).toBe('deepseek-v4.1-flash')
    expect(result.value.baseline.session.preset).toBe('ptc-hashline')
    expect(result.value.baseline.session.presetSource).toContain(SESSION)
    // A session that sent no request leaves the route unknown, not guessed.
    const bare = await run(['baseline'], { env: {}, stateDir: state })
    expect(bare.value.baseline.session.provider).toBe('unknown')
    expect(bare.value.baseline.session.model).toBe('unknown')
  })

  it('records the configured maintenance worktree facts in the baseline', async () => {
    const state = await temp('operations-cli-state-')
    const repository = process.cwd()
    await run(['config', '--set-maintenance-repo', repository], { env: {}, stateDir: state })
    const result = await run(['baseline'], { env: {}, stateDir: state })
    expect(result.value.baseline.roles.maintenanceRepository).toBe(repository)
    expect(result.value.baseline.repository.commit).toMatch(/^[0-9a-f]{7,40}$/u)
    // This checkout carries uncommitted work by construction.
    expect(result.value.baseline.repository.dirty).toBe('dirty')
    expect(result.value.baseline.repository.patchFiles).toHaveLength(2)
  })

  it('names an unusable configured role as a gap instead of dropping it', async () => {
    const state = await temp('operations-cli-state-')
    const repository = await temp('operations-cli-repo-')
    await run(['config', '--set-maintenance-repo', repository], { env: {}, stateDir: state })
    // The worktree disappears: the role is configured but unusable.
    await rm(repository, { recursive: true, force: true })
    const result = await run(['baseline'], { env: {}, stateDir: state })
    expect(result.value.baseline.roles.maintenanceRepository).toBe('unknown')
    expect(result.value.baseline.unknown.join(' ')).toContain('maintenance repository: configuration role')
    // Read-only analysis still completed.
    expect(result.code).toBe(EXIT.ok)
  })
})

describe('usage: refusals are visible and exit non-zero', () => {
  it('rejects an unknown command', async () => {
    await expect(run(['nonsense'], { env: {} })).rejects.toThrow(/unknown command/u)
    expect(await main(['nonsense'])).toBe(EXIT.refused)
  })

  it('rejects a positional argument that is not a flag', async () => {
    expect(() => parseFlags(['stray'])).toThrow(/unexpected argument/u)
  })

  it('treats a bare flag as a boolean', async () => {
    expect(parseFlags(['--create'])).toEqual({ create: true })
    expect(parseFlags(['--session', 'abc'])).toEqual({ session: 'abc' })
  })

  it('derives the installation root from its own location', async () => {
    expect(installationRoot()).toBe(path.resolve(process.cwd()))
  })

  it('reads host facts from the environment it is given', async () => {
    const facts = resolveEnvironment({ env: { DSH_HOME: '/home/x', DSH_SESSION_ID: 'session-a', PWD: '/work/a' } })
    expect(facts.dshHome).toBe('/home/x')
    expect(facts.sessionsRoot).toBe(path.join('/home/x', 'sessions'))
    expect(facts.sessionId).toBe('session-a')
    expect(facts.stateDir).toBe(path.join('/home/x', 'state', 'ptc-hashline-operations'))
  })
})
