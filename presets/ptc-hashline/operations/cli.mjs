#!/usr/bin/env node
/**
 * Operations CLI: the entry point the two skills call (D1, D9, SCOPE-04/05,
 * CONFIG-01, and the baseline slice of the ticket).
 *
 * Everything here is read-only unless the caller explicitly assigns a
 * configuration role. The commands are deliberately small and composable so a
 * skill body states the order instead of re-implementing the checks in prose:
 *
 *   context   verify THIS session's preset projection (exit 2 when it is not
 *             the target preset — the workflow must then stop)
 *   config    read or save the maintenance repository and evidence directory
 *   baseline  report the actual running combination
 *
 * Only Node builtins: the shipped bundle must run from any working directory
 * with no checkout, no `.scratch` and no root `scripts/` beside it.
 *
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/cli
 */
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { collectBaseline } from './baseline.mjs'
import { describeConfig, requireRole, saveConfig, stateDirectory } from './config.mjs'
import { verifyInvocationContext } from './context.mjs'

/** Exit codes: 0 answered, 2 stopped by the workflow guard, 3 refused usage. */
export const EXIT = { ok: 0, stopped: 2, refused: 3 }

/** The bundle's installation root, derived from this file's own location. */
export function installationRoot() {
  // .../presets/ptc-hashline/operations/cli.mjs -> the bundle root.
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
}

class UsageError extends Error {}

/**
 * Parse `--flag value` and bare `--flag` arguments.
 * @param {string[]} argv arguments after the command
 * @returns {Record<string, string | true>} the parsed flags
 */
export function parseFlags(argv) {
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!flag.startsWith('--')) throw new UsageError('unexpected argument: ' + flag)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      flags[flag.slice(2)] = true
      continue
    }
    flags[flag.slice(2)] = value
    index += 1
  }
  return flags
}

/**
 * The host facts this CLI reads, all injected so a test never touches a real home.
 * @typedef {object} Environment
 * @property {NodeJS.ProcessEnv} env the process environment (host-managed values)
 * @property {string} [sessionsRoot] override of the sessions root
 * @property {string} [stateDir] override of the operations state directory
 */

/**
 * Resolve the host facts the CLI needs.
 * @param {Environment} environment injected environment
 * @returns {{sessionsRoot: string, stateDir: string, dshHome: string, sessionId?: string, cwd: string}}
 */
export function resolveEnvironment(environment) {
  const env = environment.env ?? {}
  const dshHome = env.DSH_HOME ?? join(homedir(), '.dsh')
  const sessionsRoot = environment.sessionsRoot ?? join(dshHome, 'sessions')
  const stateDir = environment.stateDir ?? stateDirectory(dshHome)
  // DSH_SESSION_ID is a host-managed shell fact. The CLI takes it from the
  // environment the SHELL was given; a run_code program cannot read it, which
  // is why the skill invokes this through the shell tool.
  const sessionId = typeof env.DSH_SESSION_ID === 'string' && env.DSH_SESSION_ID.trim() !== '' ? env.DSH_SESSION_ID : undefined
  const cwd = typeof env.PWD === 'string' && env.PWD !== '' ? env.PWD : process.cwd()
  return { sessionsRoot, stateDir, dshHome, ...sessionId === undefined ? {} : { sessionId }, cwd }
}

/**
 * Run one command.
 * @param {string[]} argv command plus arguments
 * @param {Environment} [environment] injected host facts (tests pass fixtures)
 * @returns {Promise<{code: number, value: object}>} the exit code and the report
 */
export async function run(argv, environment = { env: {} }) {
  const [command, ...rest] = argv
  const facts = resolveEnvironment(environment)
  const flags = parseFlags(rest)
  // ELIGIBILITY comes from the INVOKING session only — the host-managed
  // DSH_SESSION_ID. No flag can substitute for it (SCOPE-05): a caller naming
  // a historical ptc-hashline session must not thereby authorize this one.
  const verdictFor = () => verifyInvocationContext({
    sessionsRoot: facts.sessionsRoot,
    cwd: facts.cwd,
    sessionId: facts.sessionId,
    // A hand-typed preset is recorded, never trusted.
    presetArgument: typeof flags.preset === 'string' ? flags.preset : undefined,
  })
  // The TARGET is the session being analyzed, which the spec explicitly allows
  // to be a different, historical ptc-hashline session. It is reported
  // separately and never feeds the eligibility decision.
  const target = {
    session: typeof flags['target-session'] === 'string' ? flags['target-session']
      : typeof flags.session === 'string' ? flags.session : facts.sessionId ?? 'unknown',
    cwd: typeof flags['target-cwd'] === 'string' ? flags['target-cwd']
      : typeof flags.cwd === 'string' ? flags.cwd : facts.cwd,
    note: 'Reported only: the analyzed session never authorizes this one.',
  }
  if (command === 'context') {
    const verdict = await verdictFor()
    return { code: verdict.eligible ? EXIT.ok : EXIT.stopped, value: { ...verdict, target } }
  }
  if (command === 'config') {
    // `flags` is parsed once above; this command only reads assignments.
    const assignments = {
      ...typeof flags['set-maintenance-repo'] === 'string' ? { maintenanceRepository: flags['set-maintenance-repo'] } : {},
      ...typeof flags['set-evidence-dir'] === 'string' ? { evidenceDirectory: flags['set-evidence-dir'] } : {},
    }
    if (Object.keys(assignments).length === 0) {
      const described = await describeConfig(facts.stateDir)
      return { code: EXIT.ok, value: { command: 'config', stateDirectory: facts.stateDir, ...described } }
    }
    const saved = await saveConfig({
      directory: facts.stateDir,
      ...assignments,
      create: flags.create === true,
    })
    return { code: EXIT.ok, value: { command: 'config', stateDirectory: facts.stateDir, ...saved } }
  }
  if (command === 'baseline') {
    const described = await describeConfig(facts.stateDir)
    // An unusable role is reported, not silently dropped: the reason travels
    // into the baseline's `unknown` gaps so the skill body can relay it.
    const roleStatus = (role) => {
      try {
        return { path: requireRole(described, role) }
      } catch (error) {
        return { reason: error instanceof Error ? error.message : String(error) }
      }
    }
    const context = await verdictFor()
    const maintenance = roleStatus('maintenanceRepository')
    const baseline = collectBaseline({
      installationRoot: installationRoot(),
      // A configured role is reported as itself; an unconfigured or unusable
      // one stays 'unknown' rather than falling back to any working directory,
      // and its reason is listed among the gaps below.
      ...maintenance.path === undefined ? {} : { maintenanceRepository: maintenance.path },
      // Provider/model come from the host's own request record for THIS
      // session; a session that never sent a request leaves them unknown.
      ...typeof context.evidence?.provider !== 'string' ? {} : { provider: context.evidence.provider },
      ...typeof context.evidence?.model !== 'string' ? {} : { model: context.evidence.model },
      presetId: context.evidence?.effectivePreset ?? undefined,
      presetSource: context.evidence?.source,
    })
    const value = {
      command: 'baseline',
      baseline: {
        ...baseline,
        // An unusable role is a named gap, not a silent absence.
        unknown: maintenance.reason === undefined ? baseline.unknown : [...baseline.unknown, 'maintenance repository: ' + maintenance.reason],
      },
      // The analyzed target is reported beside the eligibility verdict, never
      // folded into it.
      target,
      context: { eligible: context.eligible, status: context.status, ...context.reason === undefined ? {} : { reason: context.reason } },
    }
    return { code: EXIT.ok, value }
  }
  throw new UsageError('unknown command ' + JSON.stringify(command ?? '') + '; expected context, config or baseline')
}

/**
 * CLI entry point.
 * @param {string[]} argv arguments after the executable
 * @returns {Promise<number>} the process exit code
 */
export async function main(argv) {
  let result
  try {
    result = await run(argv, { env: process.env })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(message + '\n')
    return EXIT.refused
  }
  process.stdout.write(JSON.stringify(result.value, null, 2) + '\n')
  return result.code
}

/* istanbul ignore next -- CLI entry, exercised through the tests as a child process. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
