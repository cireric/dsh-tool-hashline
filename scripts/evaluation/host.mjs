/** Official boot/registry topology reused from test-default-edit-host; no DSH source changes. */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { armRows } from './identity.mjs'
import { protocolHash } from './protocol.mjs'
import { treeState, verifyTree } from './evidence.mjs'
import { collectSessions, writeSessionEvidence } from './session-tree.mjs'
import { createStimulusController } from './stimuli.mjs'
import { installedPatch, requestFiles } from './targets.mjs'
import { captureParsedPlan } from './apply-patch-targets.mjs'

export async function openHost(profile, directory, protocol) {
  const req = createRequire(path.join(profile, 'package.json'))
  const load = name => import(pathToFileURL(req.resolve(name)).href)
  const boot = await load('@deepseek-ai/dsh-app-boot')
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
  const loaded = boot.loadProfileDirectory('evaluation', profile, req.resolve('@deepseek-ai/dsh/package.json'))
  const web = boot.loadOverlayPatches('eval-web-topology', req.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'))
  const overlays = [
    { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
    { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
    { insert: web.flatMap(p => p.insert ?? []).filter(p => p.id === 'subagent-model-selection-settings') },
    { insert: [{ id: 'eval-presets', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'ptc-hashline' } }] },
  ]
  // The loader resolves manually registered arm rows from the root config's
  // directory. It must be this disposable profile, which owns all host packages.
  const config = path.join(profile, 'evaluation-' + randomUUID() + '.yml')
  fs.writeFileSync(config, '[]\n', { flag: 'wx' })
  const ctx = await boot.boot('evaluation', config, [...loaded.layers.flatMap(l => l.patches), ...loaded.patches, ...web.filter(p => p.disabled === true), ...overlays], undefined, pathToFileURL(profile + path.sep).href)
  try {
    const preset = loaded.layers.find(l => l.packageName === 'dsh-tool-hashline')?.patches.flatMap(p => p.insert ?? []).find(r => r.config?.id === 'ptc-hashline')
    if (!preset || protocolHash(preset.config.plugins) !== protocol.tools.presetHash) throw new Error('EVAL_PRESET_DRIFT')
    for (const arm of protocol.comparison) {
      const rows = armRows(preset.config.plugins, arm)
      if (protocolHash(rows) !== protocol.tools.arms[arm]) throw new Error('EVAL_ARM_DRIFT: ' + arm)
      await ctx.get('agentPresets').register({ id: 'eval-' + arm, plugins: rows })
    }
    // Provider credentials are referenced by env NAME in the frozen plugin config.
    // Never read a daily profile. Provider is mounted only after explicit execution.
    const provider = await load(protocol.tools.providerPlugin)
    await ctx.plugin(provider.default ?? provider, protocol.tools.providerConfig)
    if (!ctx.get('llm').listProviders().some(p => p.id === protocol.model.provider)) throw new Error('EVAL_PROVIDER_UNAVAILABLE')
    const Patch = installedPatch(protocol)
    let activeTree
    return {
      ctx, createUserMessage,
      ownsSession(sessionId) { return activeTree?.sessions.has(sessionId) === true },
      async execute(id, arm, cwd, task, signal) {
        const collector = collectSessions(ctx, id, signal)
        activeTree = collector
        const stimuli = createStimulusController(task, cwd, path.join(directory, id + '.stimuli'))
        const editedRoots = new Map(), batches = []
        const checkpoint = (source, rootCallId, boundary, boundaryCallId) => {
          const batch = { id: source.id + ':' + rootCallId + ':' + batches.length, sessionId: source.id, callId: rootCallId, boundary, boundaryCallId, attempt: batches.length, ...(batches.length ? { retryOf: batches.at(-1).id } : {}) }
          try {
            const snapshot = treeState(cwd), checkpointDirectory = path.join(directory, id + '.checkpoint-' + batches.length)
            fs.mkdirSync(checkpointDirectory)
            for (const [name, bytes] of Object.entries(snapshot)) {
              const file = path.join(checkpointDirectory, name)
              fs.mkdirSync(path.dirname(file), { recursive: true })
              fs.writeFileSync(file, bytes)
            }
            batch.final = verifyTree(task.initial, task.expected, snapshot)
          } catch { batch.final = { correct: 'unknown' } }
          batches.push(batch)
        }
        const offResults = ctx.on('tools/result', (exec, result) => {
          const source = collector.sessions.get(exec.agent?.id)
          if (!source) return
          if (exec.name === 'read' && result.isError === false) {
            const toolCwd = ctx.get('workingDirectory').get(exec.agent.session)
            const files = requestFiles('read', exec.arguments, toolCwd, cwd, Patch)
            if (files !== 'unknown') for (const file of files) stimuli.read(file, { sessionId: source.id, callId: exec.callId })
          }
          if (task.batchBoundary !== 'first-edit-program') return
          if (exec.name === 'edit') {
            const rootCallId = exec.rootCallId ?? exec.callId, key = source.id + ':' + rootCallId
            editedRoots.set(key, (editedRoots.get(key) ?? 0) + 1)
            if (result.isError === true) {
              checkpoint(source, rootCallId, 'edit-failure', exec.callId)
              editedRoots.set(key, 0)
            }
          }
          if (exec.name !== 'run_code') return
          const key = source.id + ':' + exec.callId
          if (editedRoots.get(key)) checkpoint(source, exec.callId, 'program-end', exec.callId)
          editedRoots.delete(key)
        }, { global: true })
        const off = ctx.on('tool-edit/policy-receipt', r => {
          collector.sessions.get(r.exec?.agent?.id)?.receipts.push({ callId: r.exec.callId, mode: r.mode, result: r.result, code: r.code, retry: r.retry, declaredFallbacks: r.decision?.fallbacks?.map(f => ['snapshot-limit', 'window-limit', 'user-override'].includes(f.reason) ? f.reason : 'unknown') ?? [], parsedPlan: captureParsedPlan(r) })
        }, { global: true })
        const cancel = () => collector.cancel()
        signal.addEventListener('abort', cancel, { once: true })
        try {
          signal.throwIfAborted()
          const agent = await ctx.get('agentLoop').create(id, { provider: protocol.model.provider, model: protocol.model.model, ...protocol.model.parameters }, { cwd })
          collector.watch(agent.session)
          collector.agents.set(id, agent)
          signal.throwIfAborted()
          await ctx.get('agentPresets').select(agent, 'eval-' + arm)
          const assembly = await ctx.get('systemPrompt').assemble({ scope: agent, agent })
          agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: task.prompt }] }))
          await collector.idle()
          await ctx.get('sessions').flush(agent.session)
          const evidence = writeSessionEvidence(directory, collector, id, batches)
          fs.writeFileSync(path.join(directory, id + '.stimuli.json'), JSON.stringify(stimuli.records), { flag: 'wx' })
          return { ...evidence, batches, stimuli: stimuli.records, promptHash: protocolHash(assembly.sections), ptc: { isolation: ctx.get('ptcRuntime')?.isolation ?? 'unknown', language: ctx.get('ptcRuntime')?.language ?? 'unknown' } }
        } finally {
          signal.removeEventListener('abort', cancel)
          off()
          offResults()
          collector.dispose()
          collector.cancel()
          activeTree = undefined
        }
      },
      dispose: () => ctx.fiber.dispose(),
    }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}

/** Inspect composition without mounting a host, resolving a model or spending tokens. */
export async function captureTools(profile, providerPlugin, credentialEnv, providerConfig = {}) {
  const req = createRequire(path.join(profile, 'package.json'))
  const boot = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href)
  const loaded = boot.loadProfileDirectory('evaluation', profile, req.resolve('@deepseek-ai/dsh/package.json'))
  const rows = loaded.layers.find(l => l.packageName === 'dsh-tool-hashline')?.patches.flatMap(p => p.insert ?? []).find(r => r.config?.id === 'ptc-hashline')?.config.plugins
  if (!rows) throw new Error('EVAL_PRESET_MISSING')
  return { presetHash: protocolHash(rows), arms: Object.fromEntries(['stock-edit', 'hashline-default', 'hashline-fallback'].map(arm => [arm, protocolHash(armRows(rows, arm))])), providerPlugin, credentialEnv, providerConfig }
}
