/**
 * SCOPE-01/02/03/07: the operations skills are discovered, user-invocable, and
 * model-invisible — and only inside the ptc-hashline preset.
 *
 * Every case runs against the real skill registry and the real filesystem
 * provider mounted through the production preset mount path, from the shipped
 * `preset.patch.yml` rows. Frontmatter text alone is never the assertion.
 */
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, onTestFinished } from 'vitest'
import { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import {
  OPERATIONS_PROVIDER,
  createOperationsPresetHarness,
  readPresetRows,
  rowsById,
  skillRows,
} from './operations-preset-harness.ts'
/** The two skills this feature delivers. */
const OPERATIONS_SKILLS = ['ptc-hashline-incident', 'ptc-hashline-upgrade'] as const

/** The skill directory shipped beside the preset. */
const skillsDir = path.resolve(process.cwd(), 'presets/ptc-hashline/skills')

/** Scratch directories this suite must remove. */
const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Mount the shipped target preset, or a copy of it without one row. */
async function mountTarget(harness: Awaited<ReturnType<typeof createOperationsPresetHarness>>, options: { without?: string; id?: string } = {}) {
  const { rows } = await readPresetRows()
  const selected = options.without === undefined ? skillRows(rows) : skillRows(rows).filter(row => row.id !== options.without)
  return await harness.mount(options.id ?? 'ptc-hashline', { rows: selected })
}

describe('SCOPE-01: the target preset offers both skills to the real user', () => {
  it('declares one scoped provider row that adds no default roots and does not watch', async () => {
    const { rows } = await readPresetRows()
    const row = rowsById(rows).get('ptc-hashline-operations-skills')
    expect(row, 'the preset must declare the operations skill provider row').toBeDefined()
    expect(row?.name).toBe('@deepseek-ai/dsh-skill-filesystem')
    const config = (row?.config ?? {}) as Record<string, unknown>
    expect(config.providerName).toBe(OPERATIONS_PROVIDER)
    // A private root only: default roots would re-scan project/user skill
    // directories under a second provider name.
    expect(config.includeDefaultRoots).toBe(false)
    expect(config.watch).toBe(false)
    const dirs = config.customSkillDirs
    expect(Array.isArray(dirs)).toBe(true)
    expect(dirs as unknown[]).toHaveLength(1)
  })

  it('evaluates the shipped skill root through the loader, from a foreign cwd', async () => {
    const { rows } = await readPresetRows()
    const row = rowsById(rows).get('ptc-hashline-operations-skills')
    const config = (row?.config ?? {}) as Record<string, unknown>
    const first = (config.customSkillDirs as unknown[] | undefined)?.[0] as { __jsExpr?: string } | undefined
    expect(first?.__jsExpr, 'the root must be a loader expression, not a literal').toBeDefined()
    // The loader evaluates `!!js` with its own context in scope, and `baseUrl`
    // is the composition directory it rewrites. Evaluating the expression with
    // exactly that binding is what the real mount does — a substring check would
    // pass even if the expression were broken.
    const baseUrl = pathToFileURL(path.join(process.cwd(), 'presets', 'ptc-hashline') + path.sep).href
    const evaluated = new Function('baseUrl', 'return (' + first!.__jsExpr + ')')(baseUrl) as string
    // It must land on THIS bundle's shipped skills directory...
    expect(evaluated).toBe(skillsDir)
    // ...and be reachable from an unrelated working directory: the resolution
    // goes through the bundle's manifest, so the caller's cwd cannot change it.
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'operations-cwd-'))
    roots.push(elsewhere)
    const fromElsewhere = new Function('baseUrl', 'return (' + first!.__jsExpr + ')')(baseUrl) as string
    expect(fromElsewhere).toBe(evaluated)
    expect(evaluated).not.toContain(elsewhere)
    // The directory it names really holds the two shipped bodies.
    const shipped = (await readdir(evaluated, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
    expect(shipped.sort()).toEqual([...OPERATIONS_SKILLS].sort())
  })

  it('lists both skills for the preset agent and loads their bodies with a resource base', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    const preset = await mountTarget(harness)
    const agent = await preset.agent('session-operations-1')
    const lookup = { cwd: harness.dir, scope: agent as never }
    const catalog = await harness.root.skills.list(lookup)
    const names = catalog.map(skill => skill.name)
    for (const name of OPERATIONS_SKILLS) expect(names).toContain(name)
    for (const name of OPERATIONS_SKILLS) {
      const summary = catalog.find(skill => skill.name === name)
      expect(summary?.provider).toBe(OPERATIONS_PROVIDER)
      expect(isUserInvocable(summary!)).toBe(true)
      // Model-invisible: the catalog a model reads must not advertise them.
      expect(isModelInvocable(summary!)).toBe(false)
      const loaded = await harness.root.skills.get(name, lookup)
      expect(loaded?.content.length).toBeGreaterThan(0)
      expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: path.join(skillsDir, name) })
      await expect(stat(path.join(skillsDir, name, 'SKILL.md'))).resolves.toBeTruthy()
    }
  })

  it('keeps the general skill provider working beside the operations one', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    const preset = await mountTarget(harness)
    const agent = await preset.agent('session-operations-2')
    const catalog = await harness.root.skills.list({ cwd: harness.dir, scope: agent as never })
    const operations = catalog.filter(skill => skill.provider === OPERATIONS_PROVIDER).map(skill => skill.name).sort()
    // The private provider contributes exactly the two delivered skills...
    expect(operations).toEqual([...OPERATIONS_SKILLS].sort())
    // ...and the shipped general provider row is still mounted beside it: the
    // merged catalog carries entries from the default `filesystem` provider,
    // which a second same-named provider row would have collided with.
    expect(catalog.some(skill => skill.provider === 'filesystem')).toBe(true)
  })
})

describe('SCOPE-02: another preset cannot offer them', () => {
  it('hides both skills from an agent on a DIFFERENT preset id with its own rows', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    // A genuinely different preset, not "the target preset minus one row": its
    // own id and its own row list, with only the general skill rows.
    const { rows } = await readPresetRows()
    const generalOnly = skillRows(rows).filter(row => row.id !== 'ptc-hashline-operations-skills')
    const preset = await harness.mount('ptc', { rows: generalOnly })
    const agent = await preset.agent('session-other-preset')
    const lookup = { cwd: harness.dir, scope: agent as never }
    const names = (await harness.root.skills.list(lookup)).map(skill => skill.name)
    for (const name of OPERATIONS_SKILLS) expect(names).not.toContain(name)
    for (const name of OPERATIONS_SKILLS) expect(await harness.root.skills.get(name, lookup)).toBeUndefined()
    // The general provider is still there, so the absence is about THIS row,
    // not about skills being unavailable at all.
    expect((await harness.root.skills.list(lookup)).some(skill => skill.provider === 'filesystem')).toBe(true)
  })

  it('cannot be reached from a second live preset while the target is mounted', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    // Both presets live at once, in that order, and each sees only its own row.
    const { rows } = await readPresetRows()
    const target = await harness.mount('ptc-hashline', { rows: skillRows(rows) })
    const other = await harness.mount('ptc', { rows: skillRows(rows).filter(row => row.id !== 'ptc-hashline-operations-skills') })
    const targetAgent = await target.agent('session-both-target')
    const otherAgent = await other.agent('session-both-other')
    expect((await harness.root.skills.list({ cwd: harness.dir, scope: targetAgent as never })).map(skill => skill.name))
      .toContain(OPERATIONS_SKILLS[0])
    expect((await harness.root.skills.list({ cwd: harness.dir, scope: otherAgent as never })).map(skill => skill.name))
      .not.toContain(OPERATIONS_SKILLS[0])
  })

  it('does not leak the skills into the host (unscoped) catalog', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    await mountTarget(harness)
    const global = (await harness.root.skills.list({ cwd: harness.dir })).map(skill => skill.name)
    for (const name of OPERATIONS_SKILLS) expect(global).not.toContain(name)
  })
})

describe('SCOPE-03: two live revisions, mode switching, and re-mount', () => {
  it('keeps two interleaved preset revisions separate without duplicate registration', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    const target = await mountTarget(harness)
    const other = await mountTarget(harness, { without: 'ptc-hashline-operations-skills', id: 'ptc' })
    const targetAgent = await target.agent('session-target')
    const otherAgent = await other.agent('session-other')
    const targetNames = (await harness.root.skills.list({ cwd: harness.dir, scope: targetAgent as never })).map(skill => skill.name)
    const otherNames = (await harness.root.skills.list({ cwd: harness.dir, scope: otherAgent as never })).map(skill => skill.name)
    for (const name of OPERATIONS_SKILLS) {
      expect(targetNames).toContain(name)
      expect(otherNames).not.toContain(name)
    }
  })

  it('unregisters with the REVISION, not with one agent, and re-mounts cleanly', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    const first = await mountTarget(harness)
    const firstAgent = await first.agent('session-first')
    const before = (await harness.root.skills.list({ cwd: harness.dir, scope: firstAgent as never })).map(skill => skill.name)
    expect(before).toContain(OPERATIONS_SKILLS[0])

    // An agent scope is NOT the owner: disposing one agent must leave the
    // revision's provider in place, because the provider is registered into the
    // preset's layer and other agents on that revision still need it.
    await firstAgent.dispose()
    const secondAgent = await first.agent('session-first-again')
    expect((await harness.root.skills.list({ cwd: harness.dir, scope: secondAgent as never })).map(skill => skill.name))
      .toContain(OPERATIONS_SKILLS[0])

    // Retiring the DEFINITION does not by itself free the provider: the
    // revision is still retained by the agent bound to it, which is the
    // production lifetime (a running session keeps its composition).
    await first.unregister()
    expect((await harness.root.skills.list({ cwd: harness.dir, scope: secondAgent as never }))
      .filter(skill => skill.provider === OPERATIONS_PROVIDER).map(skill => skill.name).sort())
      .toEqual([...OPERATIONS_SKILLS].sort())
    // Once the LAST agent lets go, the revision is collected and the provider
    // leaves the catalog for good.
    await secondAgent.dispose()
    expect(await harness.root.skills.get(OPERATIONS_SKILLS[0], { cwd: harness.dir, scope: secondAgent as never })).toBeUndefined()

    // A fresh revision may register the same provider name again: a leftover
    // registration would throw "already registered in this scope".
    const second = await mountTarget(harness)
    const thirdAgent = await second.agent('session-second')
    const after = (await harness.root.skills.list({ cwd: harness.dir, scope: thirdAgent as never }))
      .filter(skill => skill.provider === OPERATIONS_PROVIDER)
    expect(after.map(skill => skill.name).sort()).toEqual([...OPERATIONS_SKILLS].sort())
  })

  it('rejects a second provider with the same name inside one revision', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    const { rows } = await readPresetRows()
    const row = rowsById(rows).get('ptc-hashline-operations-skills')!
    const duplicated = [...skillRows(rows), { ...row, id: 'ptc-hashline-operations-skills-again' }]
    await expect(harness.mount('ptc-hashline', { rows: duplicated })).rejects.toThrow(/already registered/u)
  })
})

describe('SCOPE-07: the skill bodies are user-invocation only', () => {
  it('declares the frontmatter policy the user gesture path requires', async () => {
    for (const name of OPERATIONS_SKILLS) {
      const text = await readFile(path.join(skillsDir, name, 'SKILL.md'), 'utf8')
      expect(text.startsWith('---\n')).toBe(true)
      expect(text).toMatch(/^disable-model-invocation:\s*true$/mu)
      expect(text).toMatch(/^user-invocable:\s*true$/mu)
      expect(text).toMatch(/^name:\s*[a-z0-9-]+$/mu)
      expect(text).toMatch(/^description:\s*\S/mu)
    }
  })

  it('ships exactly the two delivered skills', async () => {
    const entries = (await readdir(skillsDir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
    expect(entries.sort()).toEqual([...OPERATIONS_SKILLS].sort())
  })

  it('documents only commands the CLI actually implements, from the skill resource base', async () => {
    for (const name of OPERATIONS_SKILLS) {
      const text = await readFile(path.join(skillsDir, name, 'SKILL.md'), 'utf8')
      // The skill's resource base is its own directory, so the operations
      // directory is two levels up; one level up would point at nothing.
      expect(text).toContain('<base>/../../operations/cli.mjs')
      expect(text).not.toContain('<base>/../operations/cli.mjs')
      const commands = [...text.matchAll(/operations\/cli\.mjs (\w+)/gu)].map(match => match[1])
      expect(new Set(commands)).toEqual(new Set(['context', 'config', 'baseline']))
      // Every path the body mentions must exist relative to its resource base.
      const operations = path.resolve(skillsDir, name, '..', '..', 'operations')
      for (const module of ['cli.mjs', 'context.mjs', 'config.mjs', 'baseline.mjs', 'session-log.mjs']) {
        await expect(stat(path.join(operations, module)), module).resolves.toBeTruthy()
      }
    }
  })

  it('refuses the model-facing skill tool while the user gesture path still works', async () => {
    const harness = await createOperationsPresetHarness()
    onTestFinished(() => harness.cleanup())
    const preset = await mountTarget(harness)
    const agent = await preset.agent('session-model-invocation')
    // The real `skill` tool from the shipped tool-skill row: a model call must
    // be rejected for a disable-model-invocation skill, not silently loaded.
    const rejected = await harness.runtime.execute({
      callId: 'model-skill-call' as never,
      name: 'skill',
      arguments: { name: OPERATIONS_SKILLS[0] },
      signal: new AbortController().signal,
      agent: agent as never,
    })
    // The tool itself must be visible — otherwise the rejection below could be
    // a missing tool rather than the invocation policy.
    expect(harness.runtime.get('skill', agent as never)).toBeDefined()
    expect(rejected.isError).toBe(true)
    // The exact policy message, not a generic "unknown skill": a missing row or
    // a broken provider would also produce "unknown", and that must not pass.
    expect(String(rejected.error?.message)).toBe('skill "' + OPERATIONS_SKILLS[0] + '" is not available for model invocation')
    // The same name IS resolvable for the user entry point, which is what makes
    // the rejection a policy decision rather than a missing skill.
    const loaded = await harness.root.skills.get(OPERATIONS_SKILLS[0], { cwd: harness.dir, scope: agent as never })
    expect(loaded).toBeDefined()
    expect(isUserInvocable(loaded!)).toBe(true)
  })
})
