/**
 * CONFIG-01: one maintenance repository and one evidence directory, saved once
 * from an explicit user assignment and reused from any business cwd. A role
 * that became unusable stops only its own writes.
 */
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CONFIG_FILE,
  describeConfig,
  probeDirectory,
  readConfig,
  requireRole,
  saveConfig,
  stateDirectory,
} from '../../presets/ptc-hashline/operations/config.mjs'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(async dir => {
    // A read-only probe directory must be writable again before removal.
    await chmod(dir, 0o700).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  }))
})

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

describe('CONFIG-01: one saved configuration, reused across business cwds', () => {
  it('creates the configuration on the first explicit assignment and reuses it', async () => {
    const state = await temp('operations-config-')
    const repository = await temp('operations-repo-')
    const evidence = await temp('operations-evidence-')
    const saved = await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
    expect(saved.values.maintenanceRepository).toBe(repository)
    expect(saved.values.evidenceDirectory).toBe(evidence)
    expect(saved.roles.maintenanceRepository.usable).toBe(true)
    expect(saved.roles.evidenceDirectory.usable).toBe(true)
    // The file lives where the convention says, mode 0600.
    const info = await stat(path.join(state, CONFIG_FILE))
    expect(info.mode & 0o777).toBe(0o600)
    // A later call from an unrelated working directory reads the same values.
    const reread = await describeConfig(state)
    expect(reread.values.maintenanceRepository).toBe(repository)
    expect(reread.values.evidenceDirectory).toBe(evidence)
  })

  it('keeps the previous role when only the other one is reassigned', async () => {
    const state = await temp('operations-config-')
    const firstRepo = await temp('operations-repo-')
    const firstEvidence = await temp('operations-evidence-')
    await saveConfig({ directory: state, maintenanceRepository: firstRepo, evidenceDirectory: firstEvidence })
    const secondRepo = await temp('operations-repo-')
    const saved = await saveConfig({ directory: state, maintenanceRepository: secondRepo })
    expect(saved.values.maintenanceRepository).toBe(secondRepo)
    expect(saved.values.evidenceDirectory).toBe(firstEvidence)
  })

  it('reports an unconfigured role without inventing a default', async () => {
    const state = await temp('operations-config-')
    const described = await describeConfig(state)
    expect(described.exists).toBe(false)
    expect(described.roles.maintenanceRepository.configured).toBe(false)
    expect(described.roles.evidenceDirectory.configured).toBe(false)
    expect(() => requireRole(described, 'maintenanceRepository')).toThrow(/not configured/u)
    expect(() => requireRole(described, 'evidenceDirectory')).toThrow(/never default to the working directory/u)
  })

  it('stops only the unusable role and keeps the other usable', async () => {
    const state = await temp('operations-config-')
    const repository = await temp('operations-repo-')
    const evidence = await temp('operations-evidence-')
    await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
    // Remove the evidence directory: it becomes unusable while the repository
    // stays fine, and read-only analysis can continue.
    await rm(evidence, { recursive: true, force: true })
    const described = await describeConfig(state)
    expect(described.roles.evidenceDirectory.usable).toBe(false)
    expect(described.roles.evidenceDirectory.detail).toContain('fix the path')
    expect(described.roles.maintenanceRepository.usable).toBe(true)
    expect(requireRole(described, 'maintenanceRepository')).toBe(repository)
    expect(() => requireRole(described, 'evidenceDirectory')).toThrow(/unusable/u)
  })

  it('refuses a relative path instead of letting it mean the business cwd', async () => {
    const state = await temp('operations-config-')
    await expect(saveConfig({ directory: state, maintenanceRepository: 'relative/repo' }))
      .rejects.toThrow(/absolute path/u)
    // Nothing was written for the refused assignment.
    expect((await readConfig(state)).exists).toBe(false)
  })

  it('surfaces malformed configuration instead of guessing', async () => {
    const state = await temp('operations-config-')
    await mkdir(state, { recursive: true })
    await writeFile(path.join(state, CONFIG_FILE), '{not json', 'utf8')
    await expect(describeConfig(state)).rejects.toThrow(/not valid JSON/u)
    await expect(saveConfig({ directory: state, maintenanceRepository: '/tmp/x' })).rejects.toThrow(/not valid JSON/u)
  })

  it('does not treat a writable-looking but missing directory as usable', async () => {
    expect((await probeDirectory('/definitely/not/here-' + String(process.pid))).ok).toBe(false)
  })

  it('derives the state directory from the host home by convention', () => {
    expect(stateDirectory('/host/home')).toBe(path.join('/host/home', 'state', 'ptc-hashline-operations'))
  })

  it('creates the named directories when asked, and never on its own', async () => {
    const state = await temp('operations-config-')
    const parent = await temp('operations-parent-')
    const repository = path.join(parent, 'repo')
    const evidence = path.join(parent, 'evidence')
    // Without `create`, the roles are configured but unusable.
    const withoutCreate = await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence })
    expect(withoutCreate.roles.maintenanceRepository.usable).toBe(false)
    const withCreate = await saveConfig({ directory: state, maintenanceRepository: repository, evidenceDirectory: evidence, create: true })
    expect(withCreate.roles.maintenanceRepository.usable).toBe(true)
    expect(withCreate.roles.evidenceDirectory.usable).toBe(true)
    expect(await readFile(path.join(state, CONFIG_FILE), 'utf8')).toContain('maintenanceRepository')
  })
})
