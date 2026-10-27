/**
 * Durable configuration for the operations skills (CONFIG-01, D9).
 *
 * One machine has ONE maintenance repository and ONE evidence directory. They
 * are saved the first time the user names them explicitly, reused from any
 * business working directory afterwards, and never derived from the caller's
 * cwd. A path that disappeared or cannot be written stops the corresponding
 * write and asks the user to fix it; read-only analysis may continue.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/config
 */
import { constants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Configuration file name inside the operations state directory. */
export const CONFIG_FILE = 'config.json'

/** The two roles this configuration pins. */
export const CONFIG_ROLES = ['maintenanceRepository', 'evidenceDirectory']

/**
 * The default state directory for this skill, under the host's own home.
 *
 * The path is a convention (`$DSH_HOME/state/<owner-id>/`), not a secret: the
 * caller passes the host home explicitly so no environment variable is read
 * from inside a program.
 * @param {string} dshHome the host home directory
 * @returns {string} this skill's state directory
 */
export function stateDirectory(dshHome) {
  return join(dshHome, 'state', 'ptc-hashline-operations')
}

/**
 * Read the saved configuration.
 *
 * A missing file is an empty configuration, not an error: the first explicit
 * assignment is what creates it. A malformed file IS an error, because guessing
 * a maintenance repository is exactly the failure this role exists to prevent.
 * @param {string} directory the state directory
 * @returns {Promise<object>} the parsed configuration plus its source facts
 */
export async function readConfig(directory) {
  const path = join(directory, CONFIG_FILE)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, exists: false, values: {} }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new Error('configuration at ' + path + ' is not valid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('configuration at ' + path + ' must be a JSON object')
  }
  return { path, exists: true, values: parsed }
}

/**
 * Whether a directory exists and is writable by this process.
 * @param {string} path the directory to probe
 * @returns {Promise<{ok: boolean, detail?: string}>} the probe result
 */
export async function probeDirectory(path) {
  try {
    await access(path, constants.W_OK)
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Save explicit assignments and report the state of both roles.
 *
 * The caller supplies absolute paths: a relative path would silently mean the
 * business cwd, which this configuration exists to keep out of the decision.
 * @param {object} options
 * @param {string} options.directory the state directory
 * @param {string} [options.maintenanceRepository] an explicitly named repository
 * @param {string} [options.evidenceDirectory] an explicitly named evidence directory
 * @param {string} [options.dshCheckout] an explicitly named sync source (stored, not created)
 * @param {boolean} [options.create] create the named directories when absent
 * @returns {Promise<object>} the saved values plus per-role health
 */
export async function saveConfig(options) {
  const assignments = {
    ...options.maintenanceRepository === undefined ? {} : { maintenanceRepository: requireAbsolute('maintenanceRepository', options.maintenanceRepository) },
    ...options.evidenceDirectory === undefined ? {} : { evidenceDirectory: requireAbsolute('evidenceDirectory', options.evidenceDirectory) },
  }
  // Validate every assignment before --create or either configuration write.
  const dshCheckout = options.dshCheckout === undefined ? undefined : requireAbsolute('dshCheckout', options.dshCheckout)
  const current = await readConfig(options.directory)
  const values = { ...current.values, ...assignments }
  if (dshCheckout !== undefined) {
    const previous = current.values.sync
    values.sync = { ...(previous !== null && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}), dshCheckout }
  }
  if (options.create === true) {
    for (const value of Object.values(assignments)) await mkdir(value, { recursive: true })
  }
  await mkdir(dirname(current.path), { recursive: true })
  await writeFile(current.path, JSON.stringify(values, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  return await describeConfig(options.directory)
}

/**
 * Merge one namespaced setting into the same configuration file.
 *
 * A feature that owns a small setting of its own (the upstream-sync check and
 * its DSH source path) must not need a THIRD configuration store: it writes a
 * namespace in this file, so there is exactly one place a maintainer looks, and
 * the two documented write-roles keep their own probed health unchanged.
 * @param {object} options
 * @param {string} options.directory the state directory
 * @param {string} options.namespace the top-level key to merge into
 * @param {Record<string, unknown>} options.values the settings to write
 * @returns {Promise<object>} the described configuration afterwards
 */
export async function saveSettings(options) {
  const namespace = options.namespace
  if (typeof namespace !== 'string' || namespace.trim() === '') throw new Error('a settings namespace must be a non-empty string')
  if (namespace === 'maintenanceRepository' || namespace === 'evidenceDirectory') {
    throw new Error(namespace + ' is a configured ROLE; assign it through saveConfig so its health is probed')
  }
  const current = await readConfig(options.directory)
  const previous = current.values[namespace]
  const merged = previous !== null && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {}
  for (const [key, value] of Object.entries(options.values ?? {})) {
    if (value === undefined) delete merged[key]
    else merged[key] = value
  }
  const values = { ...current.values, [namespace]: merged }
  await mkdir(dirname(current.path), { recursive: true })
  await writeFile(current.path, JSON.stringify(values, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  return await describeConfig(options.directory)
}

/**
 * Report the configuration with the health of each role.
 *
 * Roles are independent on purpose: an unwritable evidence directory stops the
 * evidence write but must not stop read-only analysis of a maintenance
 * repository, and vice versa.
 * @param {string} directory the state directory
 * @returns {Promise<object>} values, per-role health, and whether each is pinned
 */
export async function describeConfig(directory) {
  const current = await readConfig(directory)
  const roles = {}
  for (const role of CONFIG_ROLES) {
    const value = typeof current.values[role] === 'string' ? current.values[role] : undefined
    if (value === undefined) {
      roles[role] = { configured: false, usable: false, detail: 'not configured; the user must name it explicitly' }
      continue
    }
    const probe = await probeDirectory(value)
    roles[role] = {
      configured: true,
      usable: probe.ok,
      path: value,
      ...probe.ok ? {} : { detail: 'unusable: ' + probe.detail + '; fix the path before this role writes anything' },
    }
  }
  return { path: current.path, exists: current.exists, values: current.values, roles }
}

/**
 * Resolve a saved role path to an absolute path, or refuse.
 * @param {object} described a {@link describeConfig} result
 * @param {'maintenanceRepository'|'evidenceDirectory'} role the role to resolve
 * @returns {string} the absolute path
 * @throws when the role is unconfigured or unusable
 */
export function requireRole(described, role) {
  const entry = described.roles[role]
  if (entry === undefined) throw new Error('unknown configuration role: ' + role)
  if (!entry.configured) {
    throw new Error('configuration role "' + role + '" is not configured; ask the user to name it explicitly, never default to the working directory')
  }
  if (!entry.usable) throw new Error('configuration role "' + role + '" is unusable: ' + entry.detail)
  return resolve(entry.path)
}

function requireAbsolute(role, value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(role + ' must be a non-empty path')
  if (!isAbsolute(value)) {
    throw new Error(role + ' must be an absolute path (got ' + JSON.stringify(value) + '); a relative path would silently mean the current business directory')
  }
  return resolve(value)
}
