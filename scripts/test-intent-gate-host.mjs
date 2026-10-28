/**
 * Installed-host acceptance for the REQUEST-LEVEL intent gate (spec 2026-10-27,
 * ticket 01: declare before publish and dispatch).
 *
 * This is a deterministic host-contract test, not a real-model evaluation: a fixed
 * adapter supplies model output, the whole target preset is mounted through the official
 * registry/loader, and the real AgentLoop/Session persistence/process PTC do the rest. No
 * production row is removed or replaced to make a case pass.
 *
 * The seam is the user-visible one: a public `followup` user message goes in; what comes
 * out is judged on four separate observation points, because they are four different
 * claims —
 *   1. was the reply PUBLISHED?      (`agent/assistant-stream` text frames, plus the durable
 *                                    `assistant/message` append)
 *   2. was a call RECORDED?          (`tool/call` session events)
 *   3. did a program/tool START?     (`tool/ptc-dispatch-start` session events)
 *   4. did something change on disk? (`tools/result` plus an instrumented `fs.writeText`)
 * A rejected reply must score zero on all four; an accepted one must be intact on all four.
 *
 * Usage:
 *   node scripts/test-intent-gate-host.mjs <--pack|isolated-profile-directory> <fresh-evidence-directory>
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const [profileArgument, evidenceArgument, onlyArgument] = process.argv.slice(2)
// A comma-separated list keeps one run inside its wall-clock budget; every case still runs
// exactly once, in exactly one evidence directory.
const ONLY = onlyArgument === undefined ? undefined : onlyArgument.split(',').map(part => part.trim()).filter(part => part !== '')
if (!profileArgument || !evidenceArgument) throw new Error('usage: node scripts/test-intent-gate-host.mjs <--pack|isolated-profile-directory> <fresh-evidence-directory>')
const root = path.resolve(evidenceArgument)
if (ONLY === undefined && fs.existsSync(path.join(root, 'host-result.json'))) throw new Error('Use a fresh evidence directory; existing host-result.json is preserved.')
fs.mkdirSync(root, { recursive: true })

let profile
if (profileArgument === '--pack') {
    const { installBundle, composeProfile } = await import('./delivery-acceptance.mjs')
    const notes = []
    const install = await installBundle([], notes)
    await composeProfile(install, notes)
    profile = install.profile
    fs.writeFileSync(path.join(root, 'installation.json'), JSON.stringify({ profile, bundleRoot: install.bundleRoot, notes }, null, 2) + '\n')
    console.log('Retained isolated profile: ' + profile)
} else {
    profile = path.resolve(profileArgument)
}
const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-profile-acceptance') throw new Error('This driver only accepts the disposable dsh-profile-acceptance installation produced by test:delivery --keep or --pack.')

const workspace = fs.mkdtempSync(path.join(root, 'workspace-'))
process.env.DSH_HOME = path.join(root, 'dsh-home')
process.env.DSH_TELEMETRY_DISABLED = '1'
process.chdir(workspace)
const req = createRequire(path.join(profile, 'package.json'))
const load = async name => import(pathToFileURL(req.resolve(name)).href)

const boot = await load('@deepseek-ai/dsh-app-boot')
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const loaded = boot.loadProfileDirectory('e2', profile, req.resolve('@deepseek-ai/dsh/package.json'))
const webPatches = boot.loadOverlayPatches('e2-web-host-topology', req.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'))
const webHostDisables = webPatches.filter(patch => typeof patch.id === 'string' && patch.disabled === true)
const webHostRows = webPatches.flatMap(patch => patch.insert ?? []).filter(row => row.id === 'subagent-model-selection-settings')
const config = path.join(profile, 'e2-root.yml')
fs.writeFileSync(config, '[]\n')
const overlays = [
    { id: 'headless-startup', disabled: true },
    { id: 'headless-runner', disabled: true },
    // Automatic titles and telemetry stay off: the gate's scope claim (helper calls are
    // never gated) is proved on purpose in the waterfall tier, not by a host that cannot
    // make such a call at all.
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { insert: webHostRows },
    { insert: [{ id: 'e2-agent-presets', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'ptc-hashline' } }] },
]

const findings = {
    profile,
    startedAt: new Date().toISOString(),
    overlays,
    bundleLayers: loaded.layers.map(layer => layer.packageName),
    scriptedLlmRequests: 0,
    realModelRequests: 0,
    timingRule: 'Every timestamp is taken outside the gate: the fixed adapter stamps its own chunks, and agent/assistant-stream stamps the first published text frame. Per case, timing describes the FIRST (gated) attempt: requestToFirstProviderChunkMs (time to the provider\'s first chunk), providerSpanMs (the provider\'s own first-to-last chunk time, NOT user-visible time), providerFinishToFirstPublishedMs (how long the buffering gate held the finished reply before releasing it — zero publication is expected when the attempt is rejected), requestToFirstPublishedMs (what the user actually waits for the first visible text of a declared reply).',
}
const bundleRoot = path.dirname(req.resolve('dsh-tool-hashline/package.json'))
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
findings.installed = {
    bundleRoot,
    gateModule: path.join(bundleRoot, 'presets/ptc-hashline/intent-gate-watchdog.mjs'),
    gateModuleSha256: sha256(path.join(bundleRoot, 'presets/ptc-hashline/intent-gate-watchdog.mjs')),
    personaSha256: sha256(path.join(bundleRoot, 'presets/ptc-hashline/personas/orchestrator.md')),
    versions: Object.fromEntries(['@deepseek-ai/dsh', '@hy-sde-org/dsh-tool-edit', '@hy-sde-org/dsh-hashline'].map(name => [name, JSON.parse(fs.readFileSync(req.resolve(name + '/package.json'), 'utf8')).version])),
}

let ctx
const log = []
/** Timing of the case currently running: measured by the adapter and the publication stream. */
let lastTiming
let lastContinuationTiming
const push = entry => log.push({ at: Date.now(), ...entry })
const attemptQueue = new Map()

/** Deterministic inter-chunk gap: the provider is a stream, not a single burst. */
const CHUNK_GAP_MS = 15
let attemptCounter = 0
/** Resolved by the case when it has delivered its steering input mid-attempt. */
let releaseHold = null
const waitForSteer = () => new Promise(resolve => { releaseHold = resolve })
class Fixed extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
        findings.scriptedLlmRequests++
        const attemptId = ++attemptCounter
        // A hand-built one-shot (an auxiliary call made outside any turn) has no initiator;
        // that is exactly the shape this adapter must also be able to answer.
        let actor
        try { actor = ctx.get('agents').requireInitiator() } catch { actor = undefined }
        const queue = actor === undefined ? undefined : attemptQueue.get(actor.id)
        const attempt = queue?.length ? queue.shift() : fallbackAttempt()
        const startedAt = Date.now()
        const session = options.sessionId ?? null
        // What the provider is actually being asked: the count and the tail of the message
        // list. A repair is rebuilt from the session log, so the tail is how the acceptance
        // shows the correction notice reached the regenerated request.
        const tail = options.messages?.at(-1)
        push({
            kind: 'request',
            attempt: attemptId,
            agent: actor?.id ?? null,
            session,
            purpose: options.purpose ?? null,
            hadSystem: options.system !== undefined,
            // The declaration-only repair must be offered NO tool at all: this is what the
            // provider was handed, logged at the adapter boundary, not a plugin claim.
            tools: (options.tools ?? []).map(tool => tool.name),
            chunks: attempt.length,
            messageCount: options.messages?.length ?? 0,
            tail: tail === undefined ? undefined : {
                role: tail.role,
                sourceKind: tail.source?.kind,
                text: (tail.content ?? []).filter(block => block?.type === 'text').map(block => block.text).join('').slice(0, 80),
            },
        })
        for (const chunk of attempt) {
            if (chunk.type === HOLD) {
                // Park the attempt: this is how the case gets a deterministic "correction
                // arrives while the reply is still being generated" window. The release
                // handle is armed BEFORE the marker is published, so the case cannot observe
                // the hold and then miss the handshake.
                const released = waitForSteer()
                push({ kind: 'attempt-held', attempt: attemptId, agent: actor?.id ?? null, session })
                await released
                push({ kind: 'attempt-released', attempt: attemptId, agent: actor?.id ?? null, session })
                continue
            }
            if (chunk.type === 'text-delta' || chunk.type === 'finish') push({ kind: 'provider-chunk', attempt: attemptId, agent: actor?.id ?? null, session, type: chunk.type, text: chunk.text?.slice(0, 40) })
            yield chunk
            // A real adapter streams: a small deterministic gap between chunks is what makes
            // "when did the user see text" measurable at all.
            await new Promise(resolve => setTimeout(resolve, CHUNK_GAP_MS))
        }
        push({ kind: 'provider-finished', attempt: attemptId, agent: actor?.id ?? null, session, spanMs: Date.now() - startedAt })
    }
}
/** A model reply with no declaration line: what a child or a non-target preset may send. */
const fallbackAttempt = () => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'child or non-target reply without a declaration line' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'child or non-target reply without a declaration line' } },
    { type: 'finish', reason: { kind: 'stop' } },
]

const usage = { inputTokens: 11, outputTokens: 7, totalTokens: 18 }
/** Sentinel the fixed adapter parks on (never yielded to the loop). */
const HOLD = '__hold__'
const textAttempt = (text, { finish = { kind: 'stop' }, replay, hold = false } = {}) => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    ...hold ? [{ type: HOLD }] : [],
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage },
    { type: 'finish', reason: finish, ...(replay === undefined ? {} : { replayState: replay }) },
]
const programAttempt = (text, code, { replay, hold = false } = {}) => {
    const args = JSON.stringify({ code, description: 'intent gate acceptance program' })
    return [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text },
        ...hold ? [{ type: HOLD }] : [],
        { type: 'block-end', index: 0, block: { type: 'text', text } },
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 1, id: 'call-' + Math.random().toString(36).slice(2), name: 'run_code', argumentsDelta: args },
        { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call-fixed', name: 'run_code', arguments: args } },
        { type: 'usage', usage },
        { type: 'finish', reason: { kind: 'tool-calls' }, ...(replay === undefined ? {} : { replayState: replay }) },
    ]
}

const effects = []
let hostFs
const counters = () => ({
    publishedText: log.filter(entry => entry.kind === 'published-text').length,
    assistantMessages: log.filter(entry => entry.kind === 'assistant-message').length,
    toolCalls: log.filter(entry => entry.kind === 'tool-call').length,
    dispatchStarts: log.filter(entry => entry.kind === 'dispatch-start').length,
    toolResults: log.filter(entry => entry.kind === 'tool-result').length,
    errors: log.filter(entry => entry.kind === 'request-error').length,
    effects: effects.length,
})

const test = async (id, fn) => {
    if (ONLY !== undefined && !ONLY.some(part => id.includes(part))) return
    const before = counters()
    const mark = log.length
    try {
        const evidence = await fn()
        findings.cases.push({ id, status: 'PASS', timing: lastTiming, continuationTiming: lastContinuationTiming, ...evidence })
        console.log('CASE ' + id + ' PASS')
    } catch (error) {
        findings.cases.push({ id, status: 'FAIL', error: error.message, stack: String(error?.stack ?? '').split('\n').slice(0, 6).join(' | '), trace: log.slice(mark) })
        console.error('CASE ' + id + ' FAIL ' + error.message)
    }
    void before
}

try {
    findings.only = ONLY ?? null
    findings.logs = []
    ctx = await boot.boot('e2', config, [...loaded.layers.flatMap(layer => layer.patches), ...loaded.patches, ...webHostDisables, ...overlays], c => {
        c.logger.exporter({ levels: { default: 2 }, export: ({ name, type, args }) => { if (type === 'warn' || type === 'error') findings.logs.push({ name, type, args: args.map(a => (a instanceof Error ? (a.stack ?? a.message) : String(a))) }) } })
    }, pathToFileURL(profile + path.sep).href)

    ctx.get('llm').registerAdapter(['ig-fixed'], new Fixed())

    ctx.on('agent/assistant-stream', payload => {
        const frame = payload?.frame
        if (frame?.type === 'chunk' && frame.chunk?.type === 'text-delta') push({ kind: 'published-text', agent: payload.agent?.id, session: payload.agent?.session?.id, text: frame.chunk.text })
    }, { global: true })
    ctx.on('session/event', (session, event) => {
        if (event.type === 'assistant/message') push({ kind: 'assistant-message', session: session.id, text: (event.data?.message?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join(''), usage: event.data?.usage, replayState: event.data?.message?.source?.replayState })
        if (event.type === 'tool/call') push({ kind: 'tool-call', session: session.id, name: event.data?.name, arguments: event.data?.arguments })
        if (event.type === 'tool/ptc-dispatch-start') push({ kind: 'dispatch-start', session: session.id, name: event.data?.name })
        if (event.type === 'assistant/attempt') push({ kind: 'assistant-attempt', session: session.id, stream: event.data?.stream?.map(chunk => chunk.chunk?.type ?? chunk.type), usage: event.data?.stream?.map(entry => entry.chunk ?? entry).find(chunk => chunk?.type === 'usage')?.usage })
        if (event.type === 'user/message') push({ kind: 'user-message', session: session.id, sourceKind: event.data?.source?.kind, text: (event.data?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('') })
    }, { global: true })
    ctx.on('tools/result', (exec, result) => {
        // The returned value is copied as plain JSON so a case can follow an identity a
        // tool handed back (a spawned child's id) without reaching into plugin state.
        let value
        try { value = JSON.parse(JSON.stringify(result?.value ?? null)) } catch { value = undefined }
        push({ kind: 'tool-result', session: exec.agent?.id, name: exec.name, isError: result?.isError === true, value })
    }, { global: true })
    ctx.on('agent/error', payload => {
        push({ kind: 'request-error', session: payload.agent?.id, message: String(payload.error?.message ?? payload.error), code: String(payload.error?.code ?? ''), failure: payload.error?.failure })
    }, { global: true })

    hostFs = ctx.get('fs')
    const originalWrite = hostFs.writeText.bind(hostFs)
    hostFs.writeText = async (...args) => {
        const effect = { path: args[0]?.displayPath, intent: args[2]?.kind }
        effects.push(effect)
        push({ kind: 'write-effect', path: String(args[0]?.displayPath ?? '') })
        try { const out = await originalWrite(...args); effect.outcome = 'returned'; return out }
        catch (error) { effect.outcome = 'threw'; effect.error = String(error?.message); throw error }
    }

    findings.presets = await ctx.get('agentPresets').list()
    findings.services = ['tools', 'agents', 'agentLoop', 'agentPresets', 'ptcRuntime', 'subagents', 'fs', 'sessionPersistence'].map(name => ({ name, present: ctx.get(name) !== undefined }))

    const created = []
    const create = async (preset = 'ptc-hashline') => {
        const agent = await ctx.get('agentLoop').create('ig-' + Date.now() + '-' + Math.random().toString(36).slice(2), { provider: 'ig-fixed', model: 'fixed' }, { cwd: workspace })
        await ctx.get('agentPresets').select(agent, preset)
        created.push(agent)
        return agent
    }
    // Bounded: a case that leaves an agent mid-turn must fail that case, not hang the run.
    const settleAll = async () => {
        await Promise.all(created.map(agent => Promise.race([
            agent.whenIdle().catch(() => {}),
            new Promise(resolve => setTimeout(() => { push({ kind: 'settle-timeout', session: agent.session?.id }); resolve(undefined) }, 20_000).unref()),
        ])))
    }
    /** Wait, bounded, for one observable condition (never used to assert, only to collect). */
    const waitForLog = async (predicate, ms = 30_000, from = 0) => {
        const started = Date.now()
        while (Date.now() - started < ms) {
            if (log.slice(from).some(predicate)) return true
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        return log.slice(from).some(predicate)
    }
    /** Wait, bounded, for a background child that has not been scheduled yet to reach its end. */
    const waitForChildReply = async (sessionId, ms = 30_000) => {
        const started = Date.now()
        while (Date.now() - started < ms) {
            if (log.some(entry => entry.kind === 'assistant-message' && entry.session === sessionId)) return true
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        return log.some(entry => entry.kind === 'assistant-message' && entry.session === sessionId)
    }
    findings.presetRows = (() => {
        const declarations = loaded.layers.find(layer => layer.packageName === 'dsh-tool-hashline').patches.flatMap(patch => patch.insert ?? [])
        const target = declarations.find(entry => entry.config?.id === 'ptc-hashline')
        const rows = target.config.plugins
        const gate = rows.find(row => row.id === 'intent-gate-watchdog')
        return { gate: { name: gate.name, config: gate.config }, rowIds: rows.map(row => row.id) }
    })()

    const agent = await create('ptc-hashline')
    findings.agentId = agent.id
    findings.composedPreset = ctx.get('agentPresets').composedPreset(agent.ctx)
    const assembly = await ctx.get('systemPrompt').assemble({ scope: agent, agent })
    const persona = assembly.sections.find(section => /persona/iu.test(section.name))
    findings.persona = {
        sectionName: persona?.name,
        hasPhaseZero: (persona?.text ?? '').includes('Phase 0'),
        saysNoBuckets: /no bucket vocabulary/iu.test(persona?.text ?? ''),
        saysLiteralMarker: (persona?.text ?? '').includes('Intent:'),
        stillDemandsSixBuckets: /Buckets, exactly six/iu.test(persona?.text ?? ''),
    }
    findings.toolNames = ctx.get('tools').schemas(agent).map(schema => schema.name).filter(name => ['read', 'edit', 'run_code', 'subagent'].includes(name)).sort()
    findings.ptc = { isolation: ctx.get('ptcRuntime')?.isolation, language: ctx.get('ptcRuntime')?.language }

    const write = (name, text) => fs.writeFileSync(path.join(workspace, name), text)
    const disk = name => fs.readFileSync(path.join(workspace, name), 'utf8')
    const caseLog = mark => log.slice(mark)
    const own = (entries, agent) => entries.filter(entry => entry.agent === agent.id || entry.session === agent.session.id)
    const waitIdle = async target => {
        await Promise.race([target.whenIdle().catch(() => {}), new Promise((_, reject) => setTimeout(() => reject(new Error('case timed out')), 60_000).unref())])
    }
    /** One public user message, with the attempts this case wants the model to produce. */
    const runCase = async (target, attempts, userText) => {
        await settleAll()
        const mark = log.length
        const effectsBefore = effects.length
        attemptQueue.set(target.id, attempts.slice())
        target.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: userText }] }))
        await waitIdle(target)
        await settleAll()
        const entries = caseLog(mark)
        const scoped = own(entries, target)
        const timingFor = requestIndex => {
            const requests = scoped.filter(entry => entry.kind === 'request')
            const request = requests[requestIndex]
            if (request === undefined) return undefined
            const attempt = scoped.filter(entry => entry.attempt === request.attempt)
            const firstChunk = attempt.find(entry => entry.kind === 'provider-chunk')
            const finishChunk = attempt.find(entry => entry.kind === 'provider-chunk' && entry.type === 'finish')
            // Publication is attributed by TIME WINDOW, not by index: an attempt owns the
            // publications that happen between its own request and the next one.
            const nextRequest = requests[requestIndex + 1]
            const firstPublished = scoped.find(entry => entry.kind === 'published-text'
                && entry.at >= request.at
                && (nextRequest === undefined || entry.at < nextRequest.at))
            return {
                purpose: request.purpose,
                requestToFirstProviderChunkMs: firstChunk === undefined ? undefined : firstChunk.at - request.at,
                providerSpanMs: firstChunk === undefined || finishChunk === undefined ? undefined : finishChunk.at - firstChunk.at,
                providerFinishToFirstPublishedMs: finishChunk === undefined || firstPublished === undefined ? undefined : firstPublished.at - finishChunk.at,
                requestToFirstPublishedMs: firstPublished === undefined ? undefined : firstPublished.at - request.at,
                published: firstPublished !== undefined,
            }
        }
        const timing = timingFor(0)
        const continuationTiming = timingFor(1)
        lastTiming = timing
        lastContinuationTiming = continuationTiming
        return {
            entries,
            own: scoped,
            mark,
            timing,
            effects: effects.slice(effectsBefore),
            published: scoped.filter(entry => entry.kind === 'published-text').map(entry => entry.text).join(''),
            errors: scoped.filter(entry => entry.kind === 'request-error'),
        }
    }

    const programWithEffect = "await tools.read({ file_path: 'planned.txt' }).catch(() => 'missing'); await tools.write({ file_path: 'forbidden.txt', content: 'should not exist\\n' }); return 'wrote it'"

    findings.cases = []
    // Ticket 02 evidence helpers: read the four observation points per session.
    const NOTICE_KIND = 'intent-gate-watchdog'
    const scopeOf = (entries, agent) => entries.filter(entry => entry.agent === agent.id || entry.session === agent.session.id)
    const noticesOf = (entries, agent) => entries.filter(entry => entry.kind === 'user-message' && entry.session === agent.session.id && entry.sourceKind === NOTICE_KIND)
    const requestsOf = (entries, agent) => entries.filter(entry => entry.kind === 'request' && entry.session === agent.session.id && entry.purpose === null)
    const attemptsOf = (entries, agent) => entries.filter(entry => entry.kind === 'assistant-attempt' && entry.session === agent.session.id)

    /** The repair notice and the continuation are two different messages from one producer. */
    const REPAIR_PREFIX = '[intent-gate] Your previous reply for this request was withheld'
    const CONTINUATION_PREFIX = '[intent-gate] Your declaration for this request was accepted'
    const repairsOf = (entries, agent) => noticesOf(entries, agent).filter(entry => entry.text.startsWith(REPAIR_PREFIX))
    const continuationsOf = (entries, agent) => noticesOf(entries, agent).filter(entry => entry.text.startsWith(CONTINUATION_PREFIX))
    /** The declaration-only step is the request whose provider call was given zero tools. */
    const declarationStepOf = (entries, agent) => requestsOf(entries, agent).find(request => Array.isArray(request.tools) && request.tools.length === 0)

    const DECLARATION = 'Intent: add a line to the acceptance fixture and show it back; I will read the file first, then write it.'

    await test('IG01-01-accepted-pure-answer-is-published-and-faithful', async () => {
        const next = await create()
        const text = 'Intent: explain what the fixture does; I will answer in prose without touching any file.'
        const result = await runCase(next, [textAttempt(text, { replay: { response: 'replay-1' } })], 'Explain the fixture.')
        const messages = result.own.filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages.length, 1, 'exactly one accepted assistant message')
        assert.equal(messages[0].text, text)
        assert.deepEqual(messages[0].usage, usage)
        assert.deepEqual(messages[0].replayState, { response: 'replay-1' })
        assert.equal(result.published, text, 'the published stream carries the accepted text verbatim')
        assert.equal(result.own.filter(entry => entry.kind === 'tool-call').length, 0)
        assert.equal(result.errors.length, 0)
        return { published: result.published.slice(0, 80), usage: messages[0].usage, replayState: messages[0].replayState, timing: result.timing }
    })

    await test('IG01-02-accepted-multi-tool-program-runs-and-continuation-owes-nothing', async () => {
        write('multi-a.txt', 'one\ntwo\n')
        write('multi-b.txt', 'three\nfour\n')
        const next = await create()
        const declaration = DECLARATION
        const code = "const a = await tools.read({ file_path: 'multi-a.txt' }); await tools.write({ file_path: 'multi-a.txt', content: 'ONE\\nTWO\\n' }); const b = await tools.read({ file_path: 'multi-b.txt' }); await tools.write({ file_path: 'multi-b.txt', content: 'THREE\\nFOUR\\n' }); return { a: a.tag, b: b.tag }"
        const result = await runCase(next, [
            programAttempt(declaration, code, { replay: { response: 'replay-program', blocks: [{}, {}] } }),
            // the machine-opened continuation step: no declaration, and it must still be
            // published (IG-B-01: 同请求工具续步不重复)
            textAttempt('Both fixtures are updated.'),
        ], 'Update both fixtures.')
        const calls = result.own.filter(entry => entry.kind === 'tool-call')
        const results = result.own.filter(entry => entry.kind === 'tool-result')
        const messages = result.own.filter(entry => entry.kind === 'assistant-message')
        assert.ok(calls.length >= 1, 'the program call was recorded')
        assert.ok(String(calls[0].arguments).includes('multi-a.txt'), 'tool arguments are preserved')
        assert.ok(results.some(entry => entry.name === 'run_code'), 'the program executed')
        assert.equal(disk('multi-a.txt'), 'ONE\nTWO\n')
        assert.equal(disk('multi-b.txt'), 'THREE\nFOUR\n')
        assert.equal(messages.length, 2, 'accepted declaration reply plus the continuation reply')
        assert.equal(messages[0].text, declaration)
        assert.deepEqual(messages[0].replayState, { response: 'replay-program', blocks: [{}, {}] })
        assert.equal(messages[1].text, 'Both fixtures are updated.')
        assert.equal(result.errors.length, 0)
        return { dispatchStarts: result.own.filter(entry => entry.kind === 'dispatch-start').length, effects: result.effects.length, continuationPublished: messages[1].text, timing: result.timing }
    })

    await test('IG01-03-marker-tolerates-case-and-spacing', async () => {
        const next = await create()
        const result = await runCase(next, [textAttempt('   intent :  lowercase marker with spaces around the colon')], 'Say hi.')
        const messages = result.own.filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages.length, 1)
        assert.equal(messages[0].text, '   intent :  lowercase marker with spaces around the colon')
        return { published: result.published.slice(0, 60) }
    })

    await test('IG01-04-marker-split-across-chunks-and-blocks', async () => {
        const next = await create()
        const attempt = [
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: 'Int' },
            { type: 'text-delta', index: 0, text: 'ent:' },
            { type: 'block-end', index: 0, block: { type: 'text', text: 'Intent:' } },
            { type: 'block-start', index: 1, blockType: 'text' },
            { type: 'text-delta', index: 1, text: ' ship the declaration check' },
            { type: 'block-end', index: 1, block: { type: 'text', text: ' ship the declaration check' } },
            { type: 'usage', usage },
            { type: 'finish', reason: { kind: 'stop' } },
        ]
        const result = await runCase(next, [attempt], 'Any question.')
        const messages = result.own.filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages.length, 1, 'a marker split across chunks and blocks is not judged per chunk')
        assert.equal(messages[0].text, 'Intent: ship the declaration check')
        return { published: result.published }
    })

    await test('IG01-05-missing-marker-stops-before-publication', async () => {
        const next = await create()
        const result = await runCase(next, [textAttempt('Sure — I deleted the branch and pushed the result.'), textAttempt('Still no declaration line.')], 'Clean up the branch.')
        const errors = result.errors
        const requests = requestsOf(result.entries, next)
        assert.equal(result.published, '', 'nothing of the rejected reply was published')
        assert.equal(result.own.filter(entry => entry.kind === 'assistant-message').length, 0, 'no assistant message was appended')
        assert.equal(errors.length, 2, 'the withheld attempt and the failed declaration step each report their own failure')
        assert.match(errors[0].message, /\[intent-gate\]/u)
        assert.equal(errors[0].code, 'INTENT_DECLARATION_MISSING', 'the first miss opens the repair instead of ending the request')
        assert.equal(errors[1].code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED', 'the single repair was spent and the declaration step missed too')
        assert.equal(requests.length, 2, 'exactly one repair generation: never a third')
        assert.deepEqual(requests[1].tools, [], 'the declaration step is offered no tool at all')
        assert.equal(requests[1].tail.sourceKind, NOTICE_KIND, 'the declaration step ends with the gate notice')
        assert.equal(noticesOf(result.entries, next).length, 1, 'exactly one correction notice was recorded')
        return { published: '', error: errors.at(-1).message.slice(0, 120), code: errors.at(-1).code, declarationTools: requests[1].tools }
    })

    await test('IG01-06-empty-body-stops-before-publication', async () => {
        const next = await create()
        const result = await runCase(next, [textAttempt('Intent:    '), textAttempt('Intent:  ')], 'Do something.')
        const errors = result.errors
        assert.equal(result.published, '')
        assert.equal(errors.length, 2)
        assert.equal(errors[0].code, 'INTENT_DECLARATION_EMPTY')
        assert.equal(errors[1].code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')
        assert.equal(noticesOf(result.entries, next).length, 1)
        return { codes: errors.map(error => error.code) }
    })

    await test('IG01-07-undeclared-program-zero-start-and-zero-side-effect', async () => {
        const next = await create()
        const result = await runCase(next, [programAttempt('Doing it now.', programWithEffect), programAttempt('Still doing it.', programWithEffect)], 'Write the file.')
        const errors = result.errors
        assert.equal(result.published, '', 'no text published')
        assert.equal(result.own.filter(entry => entry.kind === 'tool-call').length, 0, 'no tool call was even recorded')
        assert.equal(result.own.filter(entry => entry.kind === 'dispatch-start').length, 0, 'no program/tool started')
        assert.equal(result.own.filter(entry => entry.kind === 'tool-result').length, 0, 'no tool body ran')
        assert.equal(result.effects.length, 0, 'no write was attempted through the host fs')
        assert.equal(fs.existsSync(path.join(workspace, 'forbidden.txt')), false, 'no file appeared')
        assert.equal(errors.length, 2)
        assert.equal(errors[0].code, 'INTENT_DECLARATION_MISSING')
        // the declaration step was offered no tool, so its call is a contract violation: the
        // request pauses instead of executing, and the violation is what the user is told
        assert.equal(errors[1].code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')
        assert.match(errors[1].message, /意图声明未能生成/u)
        assert.deepEqual(requestsOf(result.entries, next)[1].tools, [], 'the declaration step could not act even if it tried')
        const attempt = result.own.filter(entry => entry.kind === 'assistant-attempt')
        return { zeroDispatch: true, zeroEffects: true, attemptStream: attempt[0]?.stream, attempts: attempt.length, error: errors.at(-1).message.slice(0, 100) }
    })

    await test('IG01-08-final-text-wins-over-a-declaring-delta', async () => {
        const next = await create()
        const attempt = [
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: 'Intent: this delta will be replaced' },
            { type: 'block-end', index: 0, block: { type: 'text', text: 'the final text carries no marker' } },
            { type: 'usage', usage },
            { type: 'finish', reason: { kind: 'stop' } },
        ]
        const result = await runCase(next, [attempt, attempt], 'Anything.')
        const errors = result.errors
        assert.equal(result.published, '')
        assert.equal(errors.length, 2)
        assert.equal(errors.at(-1).code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')
        return { codes: errors.map(error => error.code), published: '' }
    })

    await test('IG01-09-every-new-user-message-owes-a-declaration', async () => {
        const next = await create()
        const first = await runCase(next, [textAttempt('Intent: answer the first question; I will reply in prose.')], 'First question.')
        assert.equal(first.errors.length, 0)
        const second = await runCase(next, [textAttempt('Second answer, no declaration.')], 'Second question.')
        assert.equal(second.published, '')
        assert.equal(second.errors[0].code, 'INTENT_DECLARATION_MISSING', 'the new request missed the declaration')
        assert.equal(second.errors.length, 2, 'the declaration step then missed too, and the request paused')
        return { firstAccepted: true, secondRejected: true }
    })

    await test('IG01-10-delegated-child-is-not-gated', async () => {
        const next = await create()
        // Continuable background delegation: the tool returns an id and the child runs on
        // its own, so this case must follow that child to its own quiescence.
        const program = "const spawned = await tools.subagent({ description: 'intent gate child probe', prompt: 'Reply with one sentence.' }); return { subagentId: spawned.subagentId }"
        const result = await runCase(next, [programAttempt(DECLARATION, program)], 'Delegate a child probe.')
        const runCodeResult = result.own.filter(entry => entry.kind === 'tool-result' && entry.name === 'run_code').at(-1)
        const subagentId = runCodeResult?.value?.result?.subagentId
        assert.ok(typeof subagentId === 'string', 'the program returned the child id')
        const child = ctx.get('agents').get(subagentId)
        assert.ok(child, 'the spawned child is a live agent')
        created.push(child)
        // A continuable child is scheduled, not awaited: its first turn may start after the
        // tool returned, so wait (bounded) for its own reply and then for its quiescence.
        await waitForChildReply(subagentId)
        await Promise.race([child.whenIdle().catch(() => {}), new Promise((_, reject) => setTimeout(() => reject(new Error('child timed out')), 60_000).unref())])
        await settleAll()
        // read the live log, not the case snapshot: the child settles after runCase returned
        const childEntries = log.slice(result.mark)
        const childRequests = childEntries.filter(entry => entry.kind === 'request' && entry.session === subagentId)
        const childErrors = childEntries.filter(entry => entry.kind === 'request-error' && entry.session === subagentId)
        const childMessages = childEntries.filter(entry => entry.kind === 'assistant-message' && entry.session === subagentId)
        const childPublished = childEntries.filter(entry => entry.kind === 'published-text' && entry.session === subagentId)
        assert.ok(childRequests.length >= 1, 'the child really made a model request')
        assert.equal(childErrors.length, 0, 'no child request was stopped by the gate')
        assert.ok(childMessages.length >= 1, 'the child reply was published')
        assert.match(childMessages[0].text, /without a declaration line/u, 'the child reply carried no declaration')
        assert.ok(childPublished.length >= 1, 'the child text reached the publication stream')
        return { subagentId, childRequests: childRequests.length, childPublished: childMessages.map(entry => entry.text), childErrors: childErrors.length }
    })

    await test('IG01-11-non-target-preset-is-not-gated', async () => {
        const webPackage = req.resolve('@deepseek-ai/dsh-web-app/package.json')
        const webManifest = JSON.parse(fs.readFileSync(webPackage, 'utf8'))
        let standard
        for (const item of [webManifest.dsh.bundle.patch].flat())
            for (const entry of boot.loadOverlayPatches('standard-preset', path.resolve(path.dirname(webPackage), item)).flatMap(patch => patch.insert ?? []))
                if (entry.config?.id === 'standard') standard = entry.config
        assert.ok(standard, 'installed official standard definition missing')
        await ctx.get('agentPresets').register(standard)
        const native = await create('standard')
        const result = await runCase(native, [textAttempt('No declaration line on the stock preset.')], 'Say something.')
        assert.equal(result.published, 'No declaration line on the stock preset.')
        assert.equal(result.errors.length, 0)
        // ... and the managed preset still gates afterwards
        const managed = await create('ptc-hashline')
        const gated = await runCase(managed, [textAttempt('No declaration line on the managed preset.')], 'Say something.')
        assert.equal(gated.published, '')
        assert.equal(gated.errors[0].code, 'INTENT_DECLARATION_MISSING')
        return { standardPublished: result.published, managedRejected: true }
    })

    await test('IG01-13-auxiliary-model-call-is-not-required-to-declare', async () => {
        const next = await create()
        // The exact shape the installed compaction engine uses (purpose: 'compaction' at
        // dsh-compaction-basic/lib/index.js:320, and 'session-title' at
        // dsh-session-title-llm/lib/index.js:196): a hand-built call in the same session.
        const chunks = []
        for await (const chunk of ctx.get('llm').stream({ provider: 'ig-fixed', model: 'fixed', messages: [{ role: 'user', content: [{ type: 'text', text: 'summarize the conversation' }] }], purpose: 'compaction', sessionId: next.session.id })) chunks.push(chunk)
        const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
        const finish = chunks.find(chunk => chunk.type === 'finish')
        assert.ok(text.includes('without a declaration line'), 'the auxiliary text came back untouched')
        assert.equal(finish?.reason?.kind, 'stop', 'no policy failure replaced the auxiliary finish')
        // ... and the session still gates its own real request afterwards.
        const result = await runCase(next, [textAttempt('No declaration after an auxiliary call.')], 'Say something.')
        assert.equal(result.published, '')
        assert.equal(result.errors[0].code, 'INTENT_DECLARATION_MISSING')
        return { auxiliaryText: text.slice(0, 60), auxiliaryFinish: finish?.reason?.kind, managedStillGated: true }
    })

    await test('IG01-12-declared-buffer-cap-stops-instead-of-releasing', async () => {
        const declarations = loaded.layers.find(layer => layer.packageName === 'dsh-tool-hashline').patches.flatMap(patch => patch.insert ?? [])
        const target = declarations.find(entry => entry.config?.id === 'ptc-hashline')
        const rows = structuredClone(target.config.plugins)
        const gateRow = rows.find(row => row.id === 'intent-gate-watchdog')
        gateRow.config = { maxBufferedChars: 64, maxBufferMs: 120000 }
        await ctx.get('agentPresets').register({ id: 'ig-limit', plugins: rows })
        const limited = await create('ig-limit')
        const result = await runCase(limited, [textAttempt('Intent: ' + 'x'.repeat(200))], 'A long answer.')
        const errors = result.errors
        assert.equal(result.published, '')
        assert.equal(errors.length, 1)
        assert.equal(errors[0].code, 'INTENT_DECLARATION_LIMIT')
        return { code: errors[0].code, published: '' }
    })


    // ── ticket 02: bounded repair, failure accounting and cost fidelity ────────────────

    await test('IG02-01-one-repair-recovers-a-pure-answer', async () => {
        const next = await create()
        const declared = 'Intent: explain the fixture and stop there; I will answer in prose only.'
        const answer = 'The fixture holds two lines and a content tag.'
        const result = await runCase(next, [
            textAttempt('I looked at it and it seems fine.', { replay: { response: 'rejected-answer' } }),
            textAttempt(declared, { replay: { response: 'declaration-replay' } }),
            textAttempt(answer, { replay: { response: 'repaired-answer' } }),
        ], 'Explain the fixture.')
        const entries = result.entries
        const requests = requestsOf(entries, next)
        const repairs = repairsOf(entries, next)
        const continuations = continuationsOf(entries, next)
        const messages = scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(requests.length, 3, 'withheld attempt, declaration-only repair, business step of the same request')
        assert.deepEqual(requests[1].tools, [], 'the repair was offered no tool at all')
        assert.ok(requests[2].tools.includes('run_code'), 'the business step has its tools back')
        assert.equal(repairs.length, 1, 'exactly one correction notice entered the session log')
        assert.match(repairs[0].text, /Intent:/u)
        assert.match(repairs[0].text, /DECLARATION-ONLY/u)
        assert.match(repairs[0].text, /grants no new authority/u)
        assert.equal(requests[1].tail.sourceKind, NOTICE_KIND, 'the declaration step ends with the correction notice')
        assert.ok(requests[1].messageCount > requests[0].messageCount, 'the rebuilt request carries the notice as an extra message')
        assert.equal(continuations.length, 1, 'the accepted declaration is followed by a continuation, not by a repeated declaration')
        assert.match(continuations[0].text, /Do not repeat or restate the Intent: line/u)
        assert.equal(requests[2].tail.sourceKind, NOTICE_KIND)
        assert.equal(messages.length, 2, 'only the declaration and the answer became durable')
        assert.equal(messages[0].text, declared)
        assert.deepEqual(messages[0].replayState, { response: 'declaration-replay' })
        assert.equal(messages[1].text, answer)
        assert.deepEqual(messages[1].replayState, { response: 'repaired-answer' }, 'the answer carries its own replay metadata, not the rejected one')
        assert.equal(result.published, declared + answer, 'the withheld text was never published, and the declaration precedes the work')
        assert.equal(result.errors.length, 1, 'only the withheld attempt is reported; the repair is not a failure')
        assert.equal(attemptsOf(entries, next).length, 1, 'the rejected attempt left no durable assistant message')
        return { requests: requests.length, repairs: repairs.length, continuations: continuations.length, order: 'declaration-then-answer', repairedReplay: messages[1].replayState, timing: result.timing, continuationTiming: result.continuationTiming }
    })

    await test('IG02-02-one-repair-recovers-a-tool-program-without-running-the-old-one', async () => {
        const next = await create()
        const rejectedProgram = "await tools.write({ file_path: 'forbidden.txt', content: 'should not exist\\n' }); return 'wrote it'"
        const acceptedProgram = "await tools.write({ file_path: 'allowed.txt', content: 'written once\\n' }); return 'done'"
        const result = await runCase(next, [
            programAttempt('Doing the write now.', rejectedProgram),
            textAttempt(DECLARATION),
            programAttempt('Writing the allowed file now.', acceptedProgram),
        ], 'Write the allowed file.')
        const entries = result.entries
        const requests = requestsOf(entries, next)
        assert.equal(fs.existsSync(path.join(workspace, 'forbidden.txt')), false, 'the rejected program never ran')
        assert.equal(disk('allowed.txt'), 'written once\n', 'the repaired program ran exactly once')
        assert.equal(result.effects.length, 1, 'exactly one write reached the host fs')
        assert.equal(result.effects[0].path !== undefined, true)
        assert.deepEqual(requests[1].tools, [], 'the declaration step cannot act: no tool is offered')
        assert.ok(requests[2].tools.includes('run_code'))
        const results = scopeOf(entries, next).filter(entry => entry.kind === 'tool-result' && entry.name === 'run_code')
        assert.equal(results.length, 1, 'one program executed, in the business step only')
        const messages = scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[0].text, DECLARATION, 'the accepted declaration is the first durable reply')
        assert.equal(messages[1].text, 'Writing the allowed file now.')
        assert.ok(result.published.startsWith(DECLARATION), 'the withheld reply was never published')
        assert.equal(result.errors.length, 1)
        assert.equal(repairsOf(entries, next).length, 1)
        return { effects: result.effects.length, published: messages[0].text.slice(0, 40), declarationTools: requests[1].tools, timing: result.timing }
    })

    await test('IG02-03-a-second-miss-stops-with-the-repair-exhausted', async () => {
        const next = await create()
        const result = await runCase(next, [
            textAttempt('first undeclared answer', { replay: { response: 'rejected-1' } }),
            textAttempt('second undeclared answer', { replay: { response: 'rejected-2' } }),
        ], 'Answer me.')
        const entries = result.entries
        const errors = result.errors
        const requests = requestsOf(entries, next)
        assert.equal(requests.length, 2, 'at most one repair generation: never a third attempt')
        assert.deepEqual(requests[1].tools, [], 'the repair could not act even if it wanted to')
        assert.equal(repairsOf(entries, next).length, 1, 'the correction notice was recorded once')
        assert.equal(continuationsOf(entries, next).length, 0, 'a failed declaration continues nothing')
        assert.equal(result.published, '', 'nothing was published')
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'tool-call').length, 0)
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0)
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message').length, 0)
        assert.equal(errors.length, 2, 'the withheld attempt and the failed declaration step are both reported')
        assert.equal(errors[1].code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')
        assert.match(errors[1].message, /意图声明未能生成，工作尚未执行/u)
        const attempts = attemptsOf(entries, next)
        assert.equal(attempts.length, 2, 'both rejected attempts left a durable attempt record')
        return { attempts: attempts.length, attemptsUsage: attempts.map(entry => entry.usage ?? 'unknown'), code: errors[1].code, declarationTools: requests[1].tools }
    })

    await test('IG02-04-a-new-user-input-gets-its-own-repair', async () => {
        const next = await create()
        await runCase(next, [textAttempt('undeclared one'), textAttempt('undeclared two')], 'First ask.')
        const second = await runCase(next, [
            textAttempt('undeclared three'),
            textAttempt('Intent: answer the second ask; I will reply in prose.'),
            textAttempt('Here is the answer to the second ask.'),
        ], 'Second ask.')
        const all = log.slice()
        assert.equal(second.errors.length, 1, 'only the withheld attempt of the second request failed')
        assert.equal(repairsOf(all, next).length, 2, 'each user input spent its own single repair')
        assert.equal(continuationsOf(all, next).length, 1, 'the second request was continued after its declaration')
        assert.ok(second.published.startsWith('Intent: answer the second ask'), 'the declaration came first')
        assert.ok(second.published.endsWith('Here is the answer to the second ask.'))
        return { repairs: repairsOf(all, next).length, continuations: continuationsOf(all, next).length, published: second.published.slice(0, 40) }
    })

    await test('IG02-05-cancellation-keeps-host-semantics-and-spends-no-repair', async () => {
        const next = await create()
        const cancelled = await runCase(next, [[
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: 'partial text before the cancel' },
            { type: 'finish', reason: { kind: 'aborted', failure: { message: 'cancelled', code: 'ABORTED' } } },
        ]], 'Cancel this one.')
        const errors = cancelled.errors
        assert.equal(noticesOf(cancelled.entries, next).length, 0, 'a cancellation is never repaired')
        assert.equal(errors.length, 1)
        assert.equal(errors[0].code, 'ABORTED')
        assert.equal(cancelled.effects.length, 0)
        assert.equal(scopeOf(cancelled.entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0)
        // the cancelled request did not touch the next one's budget
        const after = await runCase(next, [
            textAttempt('undeclared after cancel'),
            textAttempt('Intent: answer after the cancel; I will reply.'),
            textAttempt('Answered after the cancel.'),
        ], 'Try again.')
        assert.equal(after.errors.length, 1, 'only the withheld attempt of the new request failed')
        assert.equal(repairsOf(log.slice(), next).length, 1, 'the next request still got its repair')
        assert.equal(continuationsOf(log.slice(), next).length, 1)
        return { cancelledPublished: cancelled.published.slice(0, 40), repairs: repairsOf(log.slice(), next).length }
    })

    await test('IG02-06-real-provider-failure-keeps-its-meaning-and-no-repair', async () => {
        const next = await create()
        const failed = await runCase(next, [[{ type: 'finish', reason: { kind: 'error', failure: { message: 'socket hang up', code: 'NETWORK' } } }]], 'Fetch something.')
        const errors = failed.errors
        assert.equal(errors.length, 1)
        assert.equal(errors[0].code, 'NETWORK', 'a transport failure is not relabelled as a declaration miss')
        assert.equal(noticesOf(failed.entries, next).length, 0)
        const after = await runCase(next, [
            textAttempt('undeclared after the failure'),
            textAttempt('Intent: answer after the failure; I will reply.'),
            textAttempt('Answered after the failure.'),
        ], 'Retry the ask.')
        assert.equal(after.errors.length, 1, 'only the withheld attempt of the new request failed')
        assert.equal(repairsOf(log.slice(), next).length, 1, 'the failure spent no repair')
        assert.equal(continuationsOf(log.slice(), next).length, 1)
        return { failureCode: errors[0].code, repairs: repairsOf(log.slice(), next).length }
    })

    await test('IG02-07-truncation-is-not-a-declaration-miss', async () => {
        const next = await create()
        const truncatedText = 'a long answer that never declared anything'
        const truncatedCall = JSON.stringify({ code: "await tools.write({ file_path: 'truncated.txt', content: 'x' })" })
        const truncated = await runCase(next, [[
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text: truncatedText },
            { type: 'block-end', index: 0, block: { type: 'text', text: truncatedText } },
            { type: 'block-start', index: 1, blockType: 'tool-call' },
            { type: 'tool-call-delta', index: 1, id: 'call-t', name: 'run_code', argumentsDelta: truncatedCall },
            { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call-t', name: 'run_code', arguments: truncatedCall } },
            { type: 'finish', reason: { kind: 'max-tokens' } },
        ]], 'Answer at length.')
        assert.equal(noticesOf(truncated.entries, next).length, 0, 'truncation spends no repair')
        assert.equal(scopeOf(truncated.entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0, 'a truncated program never starts')
        assert.equal(fs.existsSync(path.join(workspace, 'truncated.txt')), false)
        assert.equal(truncated.published, truncatedText, 'truncated text keeps host behaviour')
        const after = await runCase(next, [textAttempt('Intent: answer after truncation; I will reply.')], 'Ask again.')
        assert.equal(after.errors.length, 0)
        return { published: truncated.published.slice(0, 30), dispatch: 0 }
    })

    await test('IG02-08-limit-is-distinct-from-a-declaration-miss-and-spends-no-repair', async () => {
        const declarations = loaded.layers.find(layer => layer.packageName === 'dsh-tool-hashline').patches.flatMap(patch => patch.insert ?? [])
        const target = declarations.find(entry => entry.config?.id === 'ptc-hashline')
        const rows = structuredClone(target.config.plugins)
        rows.find(row => row.id === 'intent-gate-watchdog').config = { maxBufferedChars: 64, maxBufferMs: 120000, maxRepairs: 1 }
        await ctx.get('agentPresets').register({ id: 'ig-limit-02', plugins: rows })
        const limited = await create('ig-limit-02')
        const over = await runCase(limited, [textAttempt('Intent: ' + 'x'.repeat(200))], 'A long answer.')
        const errors = over.errors
        assert.equal(errors.length, 1)
        assert.equal(errors[0].code, 'INTENT_DECLARATION_LIMIT')
        assert.equal(noticesOf(over.entries, limited).length, 0, 'a mechanism stop is not repaired')
        assert.equal(over.published, '')
        // the bound is not a declaration miss, so the request keeps its repair
        const still = await runCase(limited, [textAttempt('undeclared, short')], 'A short one.')
        assert.equal(noticesOf(still.entries, limited).length, 1, 'the character cap spent no declaration repair')
        return { limitCode: errors[0].code, noticesAfter: noticesOf(still.entries, limited).length }
    })

    await test('IG02-09-a-generic-retry-policy-cannot-multiply-the-repair', async () => {
        // A cooperative retry plugin: it asks the chain first and only claims a failure the
        // gate did not. This is the shape the loop documents (default undefined = terminal).
        const retryBudget = new Map()
        await ctx.plugin({
            name: 'test-generic-retry',
            apply(pluginCtx) {
                pluginCtx.on('agent/request-error', async (payload, next) => {
                    const outcome = await next()
                    if (outcome !== undefined) return outcome
                    const id = payload?.agent?.session?.id
                    const left = retryBudget.get(id) ?? 0
                    if (left > 0 && payload?.signal?.aborted !== true) {
                        retryBudget.set(id, left - 1)
                        return { kind: 'retry' }
                    }
                    return outcome
                })
            },
        })
        const next = await create()
        retryBudget.set(next.session.id, 1)
        const result = await runCase(next, [
            textAttempt('undeclared one'),
            textAttempt('undeclared two'),
            textAttempt('undeclared three'),
        ], 'Answer with retries around.')
        const entries = result.entries
        // The generic policy claims the failure BEFORE the gate's declaration step exists, and
        // what the gate guarantees is that a retried attempt never buys a second repair: the
        // request's single declaration budget is spent by the first miss either way.
        assert.equal(repairsOf(entries, next).length, 0, 'no declaration repair was issued: the generic retry owned the failure')
        assert.equal(result.published, '', 'no attempt was published')
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0)
        const requests = requestsOf(entries, next).length
        assert.ok(requests <= 4, 'the retry policy cannot make the gate grant more repairs: ' + requests)
        assert.equal(retryBudget.get(next.session.id), 0, 'the generic policy spent only its own budget')
        assert.ok(result.errors.length >= 1)
        assert.equal(result.errors.at(-1).code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED', 'after its own retry the request ends as a spent repair, never as a second repair')
        return { requests, repairs: repairsOf(entries, next).length, genericRetriesLeft: retryBudget.get(next.session.id) }
    })


    await test('IG02-10-unknown-cost-stays-unknown', async () => {
        const next = await create()
        // Two attempts that report no usage at all: the record must say "unknown", never 0.
        const noUsage = (text) => [
            { type: 'block-start', index: 0, blockType: 'text' },
            { type: 'text-delta', index: 0, text },
            { type: 'block-end', index: 0, block: { type: 'text', text } },
            { type: 'finish', reason: { kind: 'stop' } },
        ]
        const result = await runCase(next, [
            noUsage('undeclared and unmetered'),
            noUsage('Intent: answer without metering; I will reply.'),
            noUsage('Here is the unmetered answer.'),
        ], 'Answer.')
        const entries = result.entries
        const attempts = attemptsOf(entries, next)
        const messages = scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(attempts.length, 1, 'the rejected attempt is a durable record')
        assert.equal(attempts[0].usage, undefined, 'an adapter that reported no usage leaves no cost, not a zero')
        assert.equal(messages.length, 2, 'the declaration and the answer are separate records')
        assert.equal(messages[0].usage, undefined, 'the declaration does not invent a cost either')
        assert.equal(messages[1].usage, undefined, 'nor does the answer')
        assert.equal(result.published, 'Intent: answer without metering; I will reply.Here is the unmetered answer.')
        return { attemptUsage: attempts[0].usage ?? 'unknown', declarationUsage: messages[0].usage ?? 'unknown', acceptedUsage: messages[1].usage ?? 'unknown' }
    })


    // ── 2026-10-28 declaration repair: the shape the plan's matrix asks for ─────────────
    await test('IG08-01-the-declaration-is-published-before-the-work-of-the-same-request', async () => {
        const next = await create()
        const declared = 'Intent: append the acceptance line and show it back; I will read the file, then write it.'
        const code = "const before = await tools.read({ file_path: 'order.txt' }); await tools.write({ file_path: 'order.txt', content: 'start\\ndone\\n' }); return { tag: before.tag }"
        write('order.txt', 'start\n')
        const result = await runCase(next, [
            programAttempt('Appending the line now.', code),
            textAttempt(declared),
            programAttempt('The declaration is on the record; writing the line now.', code),
        ], 'Append the acceptance line.')
        const entries = result.entries
        const requests = requestsOf(entries, next)
        const messages = scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message')
        // the request identity is preserved: same agent, same session, three generations of ONE request
        assert.equal(new Set(requests.map(request => request.agent)).size, 1, 'the same main agent generates all three')
        assert.equal(new Set(requests.map(request => request.session)).size, 1, 'all three belong to the same session/request')
        assert.deepEqual(requests[1].tools, [], 'generation 2 is the declaration-only repair')
        assert.ok(requests[2].tools.includes('run_code'), 'generation 3 is the business step, with tools')
        assert.match(String(requests[2].tail.text), /accepted/u, 'the business step is opened by the continuation notice')
        assert.equal(messages[0].text, declared, 'the declaration is the first durable reply')
        // ORDER at the publication surface: the declaration is published before any dispatch
        const declarationIndex = entries.findIndex(entry => entry.kind === 'assistant-message' && entry.text === declared)
        const firstDispatch = entries.findIndex(entry => entry.kind === 'dispatch-start')
        assert.ok(declarationIndex >= 0, 'the declaration was published')
        assert.ok(firstDispatch > declarationIndex, 'nothing was dispatched before the declaration was published')
        assert.equal(disk('order.txt'), 'start\ndone\n', 'the business program executed exactly once')
        assert.equal(result.effects.length, 1)
        const repairs = repairsOf(entries, next)
        const continuations = continuationsOf(entries, next)
        assert.equal(repairs.length, 1)
        assert.equal(continuations.length, 1)
        return { generations: requests.length, declarationTools: requests[1].tools, businessTools: requests[2].tools, declarationBeforeDispatch: true, repairCost: attemptsOf(entries, next).map(entry => entry.usage ?? 'unknown') }
    })

    await test('IG08-02-a-call-in-the-declaration-step-is-a-protocol-pause-with-zero-execution', async () => {
        const next = await create()
        // The declaration text is perfect; the call is the violation, and no tool was offered.
        const result = await runCase(next, [
            programAttempt('Doing it now.', "await tools.write({ file_path: 'declared-but-acted.txt', content: 'x\\n' }); return 'ok'"),
            programAttempt(DECLARATION, "await tools.write({ file_path: 'declared-but-acted.txt', content: 'x\\n' }); return 'ok'"),
        ], 'Write the file.')
        const entries = result.entries
        const requests = requestsOf(entries, next)
        assert.equal(requests.length, 2, 'no third generation')
        assert.deepEqual(requests[1].tools, [], 'the declaration step was offered no tool')
        assert.equal(result.published, '', 'the declaration step published nothing')
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'tool-call').length, 0, 'no call was even recorded')
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0, 'no program started')
        assert.equal(result.effects.length, 0)
        assert.equal(fs.existsSync(path.join(workspace, 'declared-but-acted.txt')), false)
        assert.equal(repairsOf(entries, next).length, 1, 'the single repair was spent')
        assert.equal(continuationsOf(entries, next).length, 0, 'a failed declaration continues nothing')
        assert.equal(result.errors.at(-1).code, 'INTENT_DECLARATION_REPAIR_EXHAUSTED')
        assert.match(result.errors.at(-1).message, /不提供任何工具/u)
        return { generations: requests.length, declarationTools: requests[1].tools, zeroDispatch: true, zeroEffects: true, pause: result.errors.at(-1).code }
    })

    await test('IG08-03-a-cancel-during-the-declaration-step-publishes-and-continues-nothing', async () => {
        const next = await create()
        const caseMark = log.length
        const pending = runCase(next, [
            textAttempt('undeclared before the repair'),
            textAttempt('Intent: answer when allowed; I will reply in prose.', { hold: true }),
            textAttempt('this attempt must never be published'),
        ], 'Answer me.')
        await waitForLog(entry => entry.kind === 'attempt-held', 30_000, caseMark)
        next.cancel({ kind: 'user' })
        // the fixed adapter parks on a handshake: release it so the aborted stream can end
        if (releaseHold !== null) releaseHold()
        const result = await pending
        const entries = result.entries
        assert.equal(continuationsOf(entries, next).length, 0, 'a cancelled declaration starts no continuation')
        assert.equal(scopeOf(entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0, 'no program started')
        assert.equal(result.effects.length, 0)
        assert.equal(result.published, '', 'the cancelled declaration was never published')
        assert.equal(repairsOf(entries, next).length, 1, 'the repair stays spent: a cancel never refunds it')
        // and the next real input still declares, with its own request budget
        const after = await runCase(next, [
            textAttempt('Intent: answer after the cancel; I will reply in prose.'),
            textAttempt('Answered after the cancel.'),
        ], 'Answer after the cancel.')
        assert.equal(after.errors.length, 0)
        assert.ok(after.published.startsWith('Intent: answer after the cancel'))
        return { continuation: 0, dispatch: 0, published: '', repairs: 1 }
    })

    await test('IG08-04-the-diagnostic-names-the-class-and-never-copies-the-withheld-text', async () => {
        const next = await create()
        const marker = 'WITHHELD-BODY-MARKER-9f31'
        const logMark = findings.logs.length
        const result = await runCase(next, [
            textAttempt('I inspected it and ' + marker + ' was fine.', { replay: { response: 'rejected-diag' } }),
            textAttempt('Intent: answer the diagnostic ask; I will reply in prose.'),
            textAttempt('Answered.'),
        ], 'Diagnose me.')
        assert.equal(result.errors.length, 1, 'the withheld attempt is reported')
        const diagnostics = findings.logs.slice(logMark)
            .filter(entry => String(entry.args[0] ?? '').includes('intent-gate-diagnostic'))
            .map(entry => {
                const text = String(entry.args[0])
                return JSON.parse(text.slice(text.indexOf('{')))
            })
        assert.ok(diagnostics.length >= 1, 'the gate logged a structured diagnostic')
        const diagnostic = diagnostics.find(entry => entry.reason === 'missing-marker')
        assert.ok(diagnostic, 'the miss is classified by name')
        assert.equal(diagnostic.stage, 'first')
        assert.equal(diagnostic.providerKind, 'stop')
        assert.equal(diagnostic.repairs, 0)
        assert.equal(typeof diagnostic.bodyChars, 'number')
        assert.equal(diagnostic.bodyEmpty, false)
        assert.equal(diagnostic.toolCallBlocks, 0)
        assert.equal(diagnostic.limits.maxDeclarationChars, 2000)
        const serialized = JSON.stringify(diagnostics)
        assert.equal(serialized.includes(marker), false, 'the withheld body is never copied into a diagnostic')
        assert.equal(JSON.stringify(findings.logs.slice(logMark)).includes(marker), false, 'nor into any other log line')
        return { diagnostics: diagnostics.length, reason: diagnostic.reason, stage: diagnostic.stage, repairs: diagnostic.repairs, bodyChars: diagnostic.bodyChars }
    })

    // ── ticket 03: input exceptions and the user's own retry path ───────────────────────
    const userMessagesOf = (entries, agent) => entries.filter(entry => entry.kind === 'user-message' && entry.session === agent.session.id && entry.sourceKind === 'user')

    await test('IG03-01-bare-acknowledgement-needs-no-declaration-and-no-second-model', async () => {
        const next = await create()
        const reply = '不客气，需要时再叫我。'
        const result = await runCase(next, [textAttempt(reply)], '谢谢！')
        assert.equal(result.published, reply, 'the social reply was published')
        assert.equal(result.errors.length, 0)
        assert.equal(noticesOf(result.entries, next).length, 0, 'no repair was needed or spent')
        assert.equal(requestsOf(result.entries, next).length, 1, 'exactly one model call: the check adds no second model')
        // the exemption did not consume this request's repair either
        const after = await runCase(next, [
            textAttempt('no declaration here'),
            textAttempt('Intent: answer the next ask; I will reply.'),
            textAttempt('Here is the answer to the next ask.'),
        ], 'Now answer properly.')
        assert.equal(repairsOf(log.slice(), next).length, 1, 'the following request still had its own repair')
        assert.equal(after.errors.length, 1, 'only the withheld attempt of that request failed')
        return { requests: 1, repairsAfter: repairsOf(log.slice(), next).length }
    })

    await test('IG03-02-the-same-words-with-a-new-constraint-owe-a-declaration', async () => {
        const next = await create()
        const result = await runCase(next, [
            textAttempt('改好了，第二行已经是 B。'),
            textAttempt('Intent: change line 2 of a.txt to B; I will read it then edit it.'),
            textAttempt('Done: line 2 is B.'),
        ], '收到，但把 a.txt 的第二行改成 B')
        assert.equal(repairsOf(result.entries, next).length, 1, 'the input owed a declaration, so it was repaired once')
        assert.equal(continuationsOf(result.entries, next).length, 1)
        assert.equal(result.published, 'Intent: change line 2 of a.txt to B; I will read it then edit it.Done: line 2 is B.', 'only the declared reply was published, then the work')
        assert.equal(result.errors.length, 1)
        return { requests: requestsOf(result.entries, next).length, repairs: 1, continuations: 1 }
    })

    await test('IG03-03-bare-continuation-rides-the-existing-understanding', async () => {
        const next = await create()
        const first = await runCase(next, [textAttempt('Intent: explain the fixture; I will answer in prose.')], 'Explain the fixture.')
        assert.equal(first.errors.length, 0)
        const second = await runCase(next, [textAttempt('接着上一段说完。')], '继续')
        assert.equal(second.published, '接着上一段说完。', 'the continuation reply carried no marker and was still published')
        assert.equal(second.errors.length, 0)
        assert.equal(noticesOf(log.slice(), next).length, 0, 'no repair was spent on a clear continuation')
        return { continuationPublished: second.published, notices: 0 }
    })

    await test('IG03-04-a-continuation-carrying-a-new-goal-owes', async () => {
        const next = await create()
        await runCase(next, [textAttempt('Intent: explain the fixture; I will answer in prose.')], 'Explain the fixture.')
        const result = await runCase(next, [
            textAttempt('先接着说完，然后删掉。'),
            textAttempt('Intent: finish the explanation and delete b.txt; I will do both in order.'),
            textAttempt('Explanation finished and b.txt deleted.'),
        ], '继续，同时把 b.txt 删掉')
        assert.equal(repairsOf(result.entries, next).length, 1, 'the added goal turned it into a new request')
        assert.equal(continuationsOf(result.entries, next).length, 1)
        assert.equal(result.published, 'Intent: finish the explanation and delete b.txt; I will do both in order.Explanation finished and b.txt deleted.')
        return { repairs: 1, published: result.published.slice(0, 40) }
    })

    await test('IG03-05-a-continuation-without-understanding-owes', async () => {
        const next = await create()
        const result = await runCase(next, [
            textAttempt('好的，我继续。'),
            textAttempt('Intent: explain what the fixture does; I will answer in prose.'),
            textAttempt('The fixture does exactly one thing.'),
        ], '继续')
        assert.equal(repairsOf(result.entries, next).length, 1, 'a bare "继续" in a fresh session has nothing to carry')
        assert.equal(continuationsOf(result.entries, next).length, 1)
        assert.ok(result.published.startsWith('Intent: explain what the fixture does'))
        return { repairs: 1, continuations: 1 }
    })

    await test('IG03-06-an-exemption-never-excuses-an-action', async () => {
        const next = await create()
        const rejectedProgram = "await tools.write({ file_path: 'forbidden-social.txt', content: 'x\\n' }); return 'ok'"
        const acceptedProgram = "await tools.write({ file_path: 'social-write.txt', content: 'x\\n' }); return 'ok'"
        const result = await runCase(next, [
            programAttempt('好的，我把文件写一下。', rejectedProgram),
            textAttempt('Intent: write the fixture file; I will write it once.'),
            programAttempt('Writing the fixture file now.', acceptedProgram),
        ], '谢谢')
        assert.equal(fs.existsSync(path.join(workspace, 'forbidden-social.txt')), false, 'the undeclared program never ran')
        assert.equal(result.effects.length, 1, 'only the declared program wrote')
        const messages = scopeOf(result.entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[0].text, 'Intent: write the fixture file; I will write it once.')
        assert.ok(result.published.startsWith('Intent: write the fixture file'), 'the undeclared reply was never published')
        assert.equal(repairsOf(result.entries, next).length, 1)
        assert.equal(continuationsOf(result.entries, next).length, 1)
        return { effects: result.effects.length, repairs: 1 }
    })

    await test('IG03-07-user-continuation-and-machine-continuation-are-traceable', async () => {
        const next = await create()
        const machine = await runCase(next, [
            programAttempt(DECLARATION, "return 'done'"),
            textAttempt('the machine-opened step answers without a marker'),
        ], 'Run the probe.')
        const machineMessages = scopeOf(machine.entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(machineMessages.length, 2, 'the declared reply and the machine continuation were both published')
        assert.equal(machineMessages[1].text, 'the machine-opened step answers without a marker')
        assert.equal(noticesOf(machine.entries, next).length, 0, 'the machine continuation cost no repair and needed no declaration')
        assert.deepEqual(userMessagesOf(machine.entries, next).map(entry => entry.text), ['Run the probe.'], 'a machine-opened step adds no user message')
        const userContinuation = await runCase(next, [textAttempt('接着上一段说完。')], '继续')
        assert.equal(userContinuation.published, '接着上一段说完。')
        assert.equal(noticesOf(log.slice(), next).length, 0, 'neither continuation cost a repair')
        assert.deepEqual(userMessagesOf(log.slice(), next).map(entry => entry.text), ['Run the probe.', '继续'], 'the user continuation IS a durable user message: the two kinds stay distinguishable')
        return { machineMessages: machineMessages.length, userInputs: 2 }
    })

    await test('IG03-08-after-an-exhausted-stop-a-bare-continue-declares-with-a-fresh-repair', async () => {
        const next = await create()
        await runCase(next, [textAttempt('undeclared one'), textAttempt('undeclared two')], 'First ask.')
        const resumed = await runCase(next, [
            textAttempt('好的，我继续。'),
            textAttempt('Intent: resume the first ask; I will restate the goal and continue.'),
            textAttempt('Resuming where the stopped request left off.'),
        ], '继续')
        assert.equal(repairsOf(resumed.entries, next).length, 1, 'the continuation owed a declaration and used a fresh repair')
        assert.equal(continuationsOf(resumed.entries, next).length, 1)
        assert.equal(resumed.published, 'Intent: resume the first ask; I will restate the goal and continue.Resuming where the stopped request left off.')
        assert.equal(resumed.errors.length, 1)
        return { repairs: repairsOf(log.slice(), next).length, published: resumed.published.slice(0, 40) }
    })

    await test('IG03-09-sessions-do-not-borrow-each-others-understanding', async () => {
        const first = await create()
        await runCase(first, [textAttempt('Intent: explain the fixture; I will answer in prose.')], 'Explain the fixture.')
        const second = await create()
        const result = await runCase(second, [
            textAttempt('我接着别的会话说。'),
            textAttempt('Intent: start this session by explaining the fixture; I will answer in prose.'),
            textAttempt('This session starts with the explanation.'),
        ], '继续')
        assert.equal(repairsOf(result.entries, second).length, 1, 'another session has no understanding to carry, so "继续" owed a declaration')
        assert.equal(continuationsOf(result.entries, second).length, 1)
        assert.ok(result.published.startsWith('Intent: start this session by explaining the fixture'))
        return { repairs: 1, continuations: 1 }
    })


    // ── ticket 04: clarification waiting and answer routing ───────────────────────────
    const ASK_PROGRAM = file => "const a = await tools.ask_user_question({ questions: [{ id: 'pick', header: 'Pick', question: 'Which option for " + file + "?', options: [{ label: 'A' }, { label: 'B' }] }] }); await tools.write({ file_path: '" + file + "', content: JSON.stringify(a) + '\\n' }); return a"
    /** A scripted answerer on the host's own question seam (the UI's role in production). */
    let scriptedAnswer = null
    await ctx.plugin({
        name: 'test-question-answerer',
        apply(pluginCtx) {
            pluginCtx.on('user-questions/request', async (request, next) => {
                if (scriptedAnswer === null) return await next()
                const answer = scriptedAnswer
                push({ kind: 'question-answered', label: answer })
                return { answers: request.questions.map(question => ({ id: question.id, selected: [answer] })) }
            })
        },
    })
    /** A preset variant in which ask_user_question times out into the host's pending result. */
    let timedPresetRegistered = false
    const registerTimedPreset = async () => {
        if (timedPresetRegistered) return
        const declared = loaded.layers.find(layer => layer.packageName === 'dsh-tool-hashline').patches.flatMap(patch => patch.insert ?? [])
        const rows = structuredClone(declared.find(entry => entry.config?.id === 'ptc-hashline').config.plugins)
        rows.find(row => row.id === 'tool-ask-user').config = { mode: 'timed', timeout: 1 }
        await ctx.get('agentPresets').register({ id: 'ig-timed', plugins: rows })
        timedPresetRegistered = true
    }

    await test('IG04-01-a-question-pauses-the-program-until-the-user-answers', async () => {
        const next = await create()
        scriptedAnswer = 'A'
        const result = await runCase(next, [programAttempt(DECLARATION, ASK_PROGRAM('asked-answer.txt'))], 'Pick one for the fixture.')
        scriptedAnswer = null
        const entries = log.slice(result.mark)
        const askedAt = entries.findIndex(entry => entry.kind === 'dispatch-start' && entry.name === 'ask_user_question')
        const answeredAt = entries.findIndex(entry => entry.kind === 'question-answered')
        const wroteAt = entries.findIndex(entry => entry.kind === 'write-effect' && entry.path.includes('asked-answer.txt'))
        assert.ok(askedAt >= 0, 'the question was asked through the host question tool')
        assert.ok(answeredAt > askedAt, 'the answer arrived after the question')
        assert.ok(wroteAt > answeredAt, 'the program only acted after the answer, so the request was paused in between')
        const messages = scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[0].text, DECLARATION)
        assert.ok(result.published.startsWith(DECLARATION))
        assert.equal(result.errors.length, 0)
        assert.match(disk('asked-answer.txt'), /"A"/u, 'the answer reached the program')
        return { askedAt, answeredAt, wroteAt, published: result.published.slice(0, 30) }
    })

    await test('IG04-02-an-unanswered-question-stops-later-action', async () => {
        await registerTimedPreset()
        const next = await create('ig-timed')
        const result = await runCase(next, [
            programAttempt(DECLARATION, ASK_PROGRAM('pending-answer.txt')),
            programAttempt('Intent: act on an answer I do not have yet; I will write the file.', "await tools.write({ file_path: 'acted-early.txt', content: 'x\\n' }); return 'ok'"),
        ], 'Ask me, then act.')
        const errors = result.errors
        assert.equal(fs.existsSync(path.join(workspace, 'acted-early.txt')), false, 'nothing acted while the question was unanswered')
        assert.equal(errors.length, 1)
        assert.equal(errors[0].code, 'INTENT_DECLARATION_AWAITING_ANSWER')
        assert.match(errors[0].message, /待答/u)
        assert.equal(noticesOf(result.entries, next).length, 0, 'an unanswered question is not a wording problem to repair')
        return { code: errors[0].code, acted: false, notices: 0 }
    })

    await test('IG04-03-a-host-answer-owes-a-declaration', async () => {
        await registerTimedPreset()
        const next = await create('ig-timed')
        const asked = await runCase(next, [programAttempt(DECLARATION, ASK_PROGRAM('routed-answer.txt'))], 'Ask me.')
        const pendingResult = asked.own.filter(entry => entry.kind === 'tool-result' && entry.name === 'ask_user_question').at(-1)
        const callId = pendingResult?.value?.pending === true ? pendingResult.value.callId : undefined
        assert.equal(typeof callId, 'string', 'the host reported the question as pending with a call id')
        attemptQueue.set(next.id, [
            textAttempt('好的，那就按 A 做。'),
            textAttempt('Intent: proceed with option A for the fixture; I will write it.'),
            textAttempt('Proceeding with option A.'),
        ])
        const accepted = ctx.get('userQuestions').answer(next, callId, { answers: [{ id: 'pick', selected: ['A'] }] })
        assert.equal(accepted, true, 'the public answer entrance accepted the batch')
        await waitIdle(next)
        await settleAll()
        const entries = log.slice()
        const answerMessages = entries.filter(entry => entry.kind === 'user-message' && entry.session === next.session.id && entry.sourceKind === 'user-question-reply')
        assert.equal(answerMessages.length, 1, 'the answer arrived as the host question-reply message')
        const messages = scopeOf(entries, next).filter(entry => entry.kind === 'assistant-message')
        // the log carries this session's earlier question-asking reply too: the ANSWER's own
        // generation is the declaration, and the work follows it inside the same request
        assert.ok(messages.some(message => message.text === 'Intent: proceed with option A for the fixture; I will write it.'), 'the answer was answered with a declaration, not with a guess')
        assert.equal(messages.at(-1).text, 'Proceeding with option A.')
        assert.equal(repairsOf(entries, next).length, 1, 'the marker-less reply to the answer was repaired once')
        assert.equal(continuationsOf(entries, next).length, 1)
        return { callId: typeof callId, answerMessages: 1, repairs: 1 }
    })

    await test('IG04-04-a-bare-continue-is-not-an-answer-while-a-question-is-open', async () => {
        await registerTimedPreset()
        const next = await create('ig-timed')
        await runCase(next, [programAttempt(DECLARATION, ASK_PROGRAM('waiting-answer.txt'))], 'Ask me first.')
        // the question is pending; the user says "继续" instead of answering (A/B is on the table)
        const result = await runCase(next, [
            textAttempt('好的，我按推荐项继续。'),
            textAttempt('Intent: I still need your choice between A and B; I will wait for it.'),
            textAttempt('Waiting for your choice.'),
        ], '继续')
        assert.equal(repairsOf(result.entries, next).length, 1, 'the bare continuation owed a declaration instead of being exempt')
        assert.equal(continuationsOf(result.entries, next).length, 1)
        assert.ok(result.published.startsWith('Intent: I still need your choice between A and B'))
        assert.equal(fs.existsSync(path.join(workspace, 'acted-early.txt')), false)
        return { repairs: 1, published: result.published.slice(0, 40) }
    })

    await test('IG04-05-an-open-question-does-not-lock-other-sessions', async () => {
        await registerTimedPreset()
        const asking = await create('ig-timed')
        await runCase(asking, [programAttempt(DECLARATION, ASK_PROGRAM('session-a-answer.txt'))], 'Ask me.')
        const other = await create()
        const result = await runCase(other, [programAttempt('Intent: write the independent fixture; I will write it once.', "await tools.write({ file_path: 'independent.txt', content: 'ok\\n' }); return 'done'")], 'Do an unrelated thing.')
        assert.equal(result.errors.length, 0, 'the other session was not affected by the open question')
        assert.equal(disk('independent.txt'), 'ok\n')
        return { otherSessionOk: true }
    })


    // ── ticket 05: steering before pending dispatch ───────────────────────────────────
    const steerNow = (agent, text) => {
        agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }))
        const release = releaseHold
        releaseHold = null
        release?.()
    }

    await test('IG05-01-a-correction-mid-generation-does-not-block-the-answer', async () => {
        const next = await create()
        const caseMark = log.length
        const pending = runCase(next, [
            textAttempt('Intent: explain the fixture; I will answer in prose.', { hold: true }),
            textAttempt('Intent: explain the fixture and note the rename request; I will cover both.'),
            textAttempt('Covered both: the explanation, and the rename note.'),
        ], 'Explain the fixture.')
        await waitForLog(entry => entry.kind === 'attempt-held', 20_000, caseMark)
        steerNow(next, '顺便把它重命名')
        const result = await pending
        const messages = scopeOf(result.entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[0].text, 'Intent: explain the fixture; I will answer in prose.', 'a stale prose answer is harmless and is published')
        assert.equal(messages[1].text, 'Intent: explain the fixture and note the rename request; I will cover both.', 'the correction was answered with a fresh declaration')
        assert.equal(scopeOf(result.entries, next).filter(entry => entry.kind === 'dispatch-start').length, 0)
        assert.equal(result.effects.length, 0)
        const requests = requestsOf(result.entries, next)
        assert.ok(requests.at(-1).tail.text.includes('顺便把它重命名') || requests.at(-1).messageCount > requests[0].messageCount, 'the corrected turn carried the steering input')
        return { messages: messages.length, notices: noticesOf(result.entries, next).length }
    })

    await test('IG05-02-a-stale-program-never-starts-and-the-correction-is-re-declared', async () => {
        const next = await create()
        const caseMark = log.length
        const pending = runCase(next, [
            programAttempt('Intent: write the stale file; I will write it now.', "await tools.write({ file_path: 'stale-a.txt', content: 'x\\n' }); return 'ok'", { hold: true }),
            programAttempt('Intent: write the corrected file instead; I will write fresh.txt.', "await tools.write({ file_path: 'fresh.txt', content: 'ok\\n' }); return 'ok'"),
            textAttempt('Both steps are done.'),
        ], 'Write the file.')
        await waitForLog(entry => entry.kind === 'attempt-held', 20_000, caseMark)
        steerNow(next, '不要写 stale-a，改写成 fresh')
        const result = await pending
        assert.equal(fs.existsSync(path.join(workspace, 'stale-a.txt')), false, 'the stale program never started')
        assert.equal(disk('fresh.txt'), 'ok\n', 'the corrected turn acted under the new requirement')
        assert.equal(result.errors.length, 0, 'a stale action is withheld without erroring the turn')
        const runCodeResults = scopeOf(result.entries, next).filter(entry => entry.kind === 'tool-result' && entry.name === 'run_code')
        assert.equal(runCodeResults.length, 1, 'only the re-judged program ran')
        const messages = scopeOf(result.entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[0].text, 'Intent: write the stale file; I will write it now.', 'the stale words survive; only the calls are withheld')
        assert.equal(messages[1].text, 'Intent: write the corrected file instead; I will write fresh.txt.', 'the correction was re-declared before acting')
        assert.equal(noticesOf(result.entries, next).length, 0, 'a withheld action spends no declaration repair')
        // and the request budget is intact afterwards
        const after = await runCase(next, [
            textAttempt('undeclared after steering'),
            textAttempt('Intent: answer after the steer; I will reply.'),
            textAttempt('Answered after the steer.'),
        ], 'One more ask.')
        assert.equal(repairsOf(log.slice(), next).length, 1, 'the steering did not consume the one repair')
        assert.equal(after.errors.length, 1)
        return { stale: false, fresh: true, repairsAfter: 1 }
    })

    await test('IG05-03-executed-calls-stay-executed-and-the-later-call-is-blocked', async () => {
        const next = await create()
        const program = "await tools.write({ file_path: 'first-step.txt', content: 'ran\\n' }); await new Promise(resolve => setTimeout(resolve, 400)); await tools.write({ file_path: 'second-step.txt', content: 'ran\\n' }); return 'both'"
        const caseMark = log.length
        const pending = runCase(next, [
            programAttempt(DECLARATION, program),
            textAttempt('Intent: keep only the first step and stop; I will not write the second file.'),
        ], 'Write both steps.')
        await waitForLog(entry => entry.kind === 'write-effect' && entry.path.includes('first-step.txt'), 30_000, caseMark)
        next.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '停一下：只保留第一步，第二步不要写' }] }))
        const result = await pending
        assert.equal(disk('first-step.txt'), 'ran\n', 'the call that already executed stays executed')
        assert.equal(fs.existsSync(path.join(workspace, 'second-step.txt')), false, 'the call that had not run was blocked')
        const denied = result.entries.filter(entry => entry.kind === 'tool-result' && entry.isError === true)
        assert.ok(denied.length >= 1, 'the program died at the blocked call and said so')
        const messages = scopeOf(result.entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages.at(-1).text, 'Intent: keep only the first step and stop; I will not write the second file.', 'the correction was re-declared afterwards')
        assert.equal(noticesOf(result.entries, next).length, 0, 'no declaration repair was spent')
        return { firstRan: true, secondBlocked: true }
    })

    await test('IG05-04-a-progress-ping-pauses-and-is-re-judged-not-treated-as-a-cancel', async () => {
        const next = await create()
        const caseMark = log.length
        const pending = runCase(next, [
            programAttempt('Intent: write the file; I will write it now.', "await tools.write({ file_path: 'pinged.txt', content: 'ok\\n' }); return 'ok'", { hold: true }),
            programAttempt('Intent: still writing the same file after the progress question; I will write it now.', "await tools.write({ file_path: 'pinged.txt', content: 'ok\\n' }); return 'ok'"),
            textAttempt('The file is written.'),
        ], 'Write the file.')
        await waitForLog(entry => entry.kind === 'attempt-held', 20_000, caseMark)
        steerNow(next, '进度如何？')
        const result = await pending
        assert.equal(disk('pinged.txt'), 'ok\n', 'the same plan continued after the ping was read')
        const messages = scopeOf(result.entries, next).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[1].text, 'Intent: still writing the same file after the progress question; I will write it now.', 'the plan continued after the ping was read')
        assert.equal(noticesOf(result.entries, next).length, 0)
        return { paused: true, continued: true }
    })


    // ── ticket 06: the state lives in the session log, so a reload keeps it ─────────────
    /** Owned agents (handle + agent) so a case can flush, tear down and resume for real. */
    const createOwned = async (preset = 'ptc-hashline') => {
        const sessionId = 'ig-' + Date.now() + '-' + Math.random().toString(36).slice(2)
        const handle = await ctx.get('agents').create({ sessionId, agentOptions: { provider: 'ig-fixed', model: 'fixed' }, meta: { cwd: workspace } })
        await ctx.get('agentPresets').select(handle.agent, preset)
        created.push(handle.agent)
        return handle
    }
    /** A genuine reload: the agent is torn down and a new one is built from the persisted log. */
    const reload = async handle => {
        const sessionId = handle.agent.session.id
        // Persist every pending append before the agent goes away; the installed store flushes
        // per session, so the session is passed through and a service-wide flush is the fallback.
        try {
            await ctx.get('sessions').flush(handle.agent.session)
        } catch (error) {
            push({ kind: 'flush-fallback', detail: String(error) })
            await ctx.get('sessions').flush()
        }
        await handle.dispose()
        const presets = ctx.get('agentPresets')
        const resumed = await ctx.get('agents').resume({
            resumeSessionId: sessionId,
            agentOptions: { provider: 'ig-fixed', model: 'fixed' },
            // A resumed agent gets a fresh scoped world: the preset is composed into it here,
            // before the first turn. select() refuses a session that already started, so the
            // composition goes through the registry's own recompose entry.
            setup: async agentCtx => {
                try {
                    await presets.recompose(agentCtx, 'ptc-hashline')
                    push({ kind: 'preset-recomposed', session: sessionId })
                } catch (error) {
                    push({ kind: 'preset-recompose-failed', session: sessionId, detail: String(error) })
                }
            },
        })
        created.push(resumed.agent)
        return { sessionId, agent: resumed.agent, handle: resumed }
    }

    await test('IG06-01-an-open-question-survives-a-reload', async () => {
        await registerTimedPreset()
        const first = await createOwned('ig-timed')
        const asked = await runCase(first.agent, [programAttempt(DECLARATION, ASK_PROGRAM('resume-answer.txt'))], 'Ask me first.')
        const pendingResult = asked.own.filter(entry => entry.kind === 'tool-result' && entry.name === 'ask_user_question').at(-1)
        assert.equal(pendingResult?.value?.pending, true, 'the question was left answerable when the process went away')
        const before = log.filter(entry => entry.kind === 'write-effect' && entry.path.includes('resume-answer.txt')).length
        const resumed = await reload(first)
        const after = await runCase(resumed.agent, [
            textAttempt('好的，那就按 A 做。'),
            textAttempt('Intent: proceed with option A for the fixture; I will write it.'),
            textAttempt('Proceeding with option A after the reload.'),
        ], '继续')
        assert.equal(repairsOf(after.entries, resumed.agent).length, 1, 'the reloaded session still held the open question, so the bare continuation owed a declaration')
        assert.ok(after.published.startsWith('Intent: proceed with option A for the fixture'))
        assert.equal(after.errors.length, 1)
        const writes = log.filter(entry => entry.kind === 'write-effect' && entry.path.includes('resume-answer.txt')).length
        assert.equal(writes, before, 'the resumed session replayed nothing')
        const logEvents = resumed.agent.session.snapshotEvents().map(event => event.type)
        assert.ok(logEvents.includes('tool/ptc-dispatch-start'), 'the question call is a durable event, not private memory')
        return { notices: 1, replayed: false }
    })

    await test('IG06-02-a-spent-budget-survives-a-reload', async () => {
        const first = await createOwned()
        const exhausted = await runCase(first.agent, [
            textAttempt('undeclared one'),
            textAttempt('undeclared two'),
        ], 'Do the thing.')
        assert.equal(noticesOf(exhausted.entries, first.agent).length, 1, 'the repair was spent once before the reload')
        assert.ok(exhausted.errors.length >= 1)
        const resumed = await reload(first)
        // a continuation of a stopped request carries no authority, and the log still says so
        const after = await runCase(resumed.agent, [
            textAttempt('我接着做完。'),
            textAttempt('Intent: continue the stopped request; I will say what is left.'),
            textAttempt('What is left is the second half of the work.'),
        ], '继续')
        assert.equal(repairsOf(after.entries, resumed.agent).length, 1, 'the continuation owed a declaration after the reload too')
        assert.ok(after.published.startsWith('Intent: continue the stopped request'))
        assert.equal(after.errors.length, 1)
        return { repairsBefore: 1, repairsAfter: repairsOf(after.entries, resumed.agent).length }
    })

    await test('IG06-03-two-sessions-reload-independently', async () => {
        await registerTimedPreset()
        const asking = await createOwned('ig-timed')
        await runCase(asking.agent, [programAttempt(DECLARATION, ASK_PROGRAM('reload-a.txt'))], 'Ask me.')
        const plain = await createOwned()
        await runCase(plain.agent, [textAttempt('Intent: answer plainly; I will reply.')], 'Say something.')
        const resumedAsking = await reload(asking)
        const resumedPlain = await reload(plain)
        // the session that asked a question still holds the wait
        const blocked = await runCase(resumedAsking.agent, [
            textAttempt('我按推荐项继续。'),
            textAttempt('Intent: I still need your choice between A and B; I will wait.'),
            textAttempt('Still waiting for the choice.'),
        ], '继续')
        assert.equal(repairsOf(blocked.entries, resumedAsking.agent).length, 1, 'the waiting session kept its wait')
        // the unrelated session resumed with nothing pending and acted normally
        const free = await runCase(resumedPlain.agent, [
            programAttempt('Intent: write the independent file; I will write it once.', "await tools.write({ file_path: 'reload-free.txt', content: 'ok\\n' }); return 'ok'"),
        ], 'Write something.')
        assert.equal(free.errors.length, 0)
        assert.equal(disk('reload-free.txt'), 'ok\n')
        assert.equal(noticesOf(free.entries, resumedPlain.agent).length, 0)
        return { waiting: 1, free: 1 }
    })


    // ── ticket 07: the crossings of 04/05/06 on one session ────────────────────────────
    await test('IG07-01-a-steer-does-not-count-as-an-answer-to-an-open-question', async () => {
        await registerTimedPreset()
        const next = await createOwned('ig-timed')
        await runCase(next.agent, [programAttempt(DECLARATION, ASK_PROGRAM('cross-answer.txt'))], 'Ask me first.')
        const mark = log.length
        // The user steers a new requirement while the A/B question is still open. That is not
        // an answer: the wait must survive, and a reply that acts on a guess must not run.
        next.agent.steer(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '改目标：只要 B，不要 A' }] }))
        attemptQueue.set(next.agent.id, [
            textAttempt('好的，我按推荐项继续。'),
            textAttempt('Intent: I still need your choice between A and B; I will not act.'),
            textAttempt('Still waiting; nothing was acted on.'),
        ])
        await waitIdle(next.agent)
        await settleAll()
        const entries = caseLog(mark)
        assert.equal(repairsOf(entries, next.agent).length, 1, 'the steered turn owed a declaration: the wait was still open')
        const messages = scopeOf(entries, next.agent).filter(entry => entry.kind === 'assistant-message')
        assert.equal(messages[0].text, 'Intent: I still need your choice between A and B; I will not act.')
        assert.equal(scopeOf(entries, next.agent).filter(entry => entry.kind === 'dispatch-start').length, 0, 'nothing was dispatched while the question was open')
        // A steering note is not an answer, but the user's OWN next prompt is user input: it
        // ends the wait for gating purposes (ticket 04), and the request then acts under a
        // fresh declaration. The two inputs must not be conflated.
        const acting = await runCase(next.agent, [
            programAttempt('Intent: act on option B as the user just said; I will write it.', "await tools.write({ file_path: 'cross-acted.txt', content: 'x\\n' }); return 'ok'"),
        ], 'B 吧，按 B 做')
        assert.equal(disk('cross-acted.txt'), 'x\n', 'the user\'s own prompt ended the wait and the declared program ran')
        assert.equal(acting.errors.length, 0)
        return { repairs: 1, dispatchedWhileWaiting: 0, lastText: messages[0].text.slice(0, 40), actedAfterUserInput: true }
    })

    await test('IG07-02-a-wait-survives-a-spent-budget-and-a-reload', async () => {
        await registerTimedPreset()
        const first = await createOwned('ig-timed')
        const exhausted = await runCase(first.agent, [textAttempt('undeclared one'), textAttempt('undeclared two')], 'Do the thing.')
        assert.ok(exhausted.errors.some(error => error.code === 'INTENT_DECLARATION_REPAIR_EXHAUSTED'), 'the budget was spent in this session')
        await runCase(first.agent, [programAttempt(DECLARATION, ASK_PROGRAM('cross-wait.txt'))], 'Now ask me something.')
        const resumed = await reload(first)
        const after = await runCase(resumed.agent, [
            textAttempt('好的，按推荐项继续。'),
            textAttempt('Intent: I still need your choice; I will wait for it.'),
            textAttempt('Still waiting for your choice between A and B.'),
        ], '继续')
        assert.equal(repairsOf(after.entries, resumed.agent).length, 1, 'after reload the continuation owed a declaration (wait + stopped history both survived)')
        assert.ok(after.published.startsWith('Intent: I still need your choice'))
        assert.equal(after.errors.length, 1)
        return { exhaustedBefore: true, repairsAfter: repairsOf(after.entries, resumed.agent).length }
    })

}
catch (error) {
    findings.status = 'failed'
    findings.error = { name: error.name, message: error.message, stack: error.stack }
    findings.inventory = await ctx?.get('agentPresets')?.compositionInventory?.()
    console.error('IG_FAILED ' + error.stack)
    process.exitCode = 1
}
finally {
    if (ctx) await Promise.race([ctx.fiber.dispose(), new Promise(resolve => setTimeout(resolve, 30_000))])
    findings.finishedAt = new Date().toISOString()
    findings.logLineCount = log.length
    findings.boundaries = [
        'Actual installed full target preset mounted through the official registry/loader, with real AgentLoop, Session persistence, subagent tools and Node process PTC.',
        'Deterministic adapter and synthetic user-source fixtures; realModelRequests=0. No model-behaviour, semantic-quality or value evidence: the mechanical check is proven, understanding is not.',
        'Base+headless host plus official web host tool-disable overlays; no target preset row removed or replaced to make a case pass.',
        'Four observation points are asserted separately: published text (agent/assistant-stream), recorded calls (tool/call), started programs (tool/ptc-dispatch-start), disk effects (tools/result + instrumented fs.writeText).',
        'Bounded repair IS in this slice (ticket 02, revised 2026-10-28): at most ONE automatic repair per user-opened request, and that repair is DECLARATION-ONLY — agent/request-error spends the budget and leaves the withheld attempt terminal, the declaration step is opened by a public agent.followup from the idle driver, its request is built with an EMPTY tool catalog (system-prompt/assemble, logged as requests[].tools === []), and its only accepted output is the Intent line within maxDeclarationChars. The withheld reply is never published or dispatched.',
        'The business continuation IS in this slice (2026-10-28 plan requirement 5): once the declaration is committed and published, the gate injects a continuation notice for the next step of the SAME turn, so the request declares once and then works with the full tool catalog. IG08-01 asserts the declaration is published before any dispatch, and that all three generations belong to one agent and one session.',
        'A failed or cancelled declaration step is a PROTOCOL PAUSE: the budget stays spent, nothing is published, nothing is dispatched, and no third generation is attempted (IG01-05/06/07, IG02-03, IG08-02, IG08-03). A generic retry policy that claims the failure before the gate cannot buy a second repair (IG02-09).',
        'GAP — a crash between the declaration commit and the injected continuation is not exercised here: the repair would have to be resumed by a host restart inside the same turn. The delivered behaviour is conservative (the declaration is durable, nothing is replayed, no second publish and no second generation), but "the work continues after such a crash" is NOT claimed.',
        'GAP — the crash/restart points of R09 (during the declaration generation, before the commit, after the commit, during the business generation) are covered only where the deterministic host can reach them: IG08-03 covers cancellation, IG06-01..03 cover reloads of a reloaded session. An in-process kill between commit and continuation is not reachable without a host restart, which this run does not perform.',
        'GAP — R12 stays a partial claim: the publication ORDER is proven on the assistant-stream/api-proxy-adjacent surface used here (agent/assistant-stream frames plus the durable assistant/message), and the CLI/browser render of that order is still not exercised (see scripts/test-intent-gate-surface.mjs for the client-wire tier).',
        'Input exceptions are IN this slice (ticket 03): a bare acknowledgement always, and a bare continuation only when this session already holds an accepted understanding AND the previous request ended accepted. The comparison is exact-form against two short closed lists, never a substring, and an exemption never covers a reply that calls a tool.',
        'The gate holds NO private state across requests: everything it knows (accepted understanding, the spent repair, the open question, the last outcome) is derived from the session event log on every read, so resume, reload and compaction preserve it by construction (ticket 06, IG-B-14). Recovery of the real CLI/browser surface remains ticket 07.',
        'A resumed agent is a fresh scoped world: the preset must be composed during resume setup (the host calls it; select() refuses a session that already started). A resume path that skips that composition leaves the resumed agent ungated, and a surviving gate instance of another agent can still judge a stream whose session id matches — so the guarantee is only as good as the host resume path, which is what IG06-01..03 assert.',
        'A corrupt or unreadable log is reported once per session and the request stops (INTENT_STATE_UNTRUSTED) instead of being passed through; the state then continues from conservative defaults. Producing such a record through the public append path is impossible (the session rejects malformed events), so that path is covered at the waterfall tier with a hand-built log, not in the installed host.',
        'Steering before dispatch IS in this slice (ticket 05): a reply composed before a human input that is still waiting in the inbox steering queue has its calls withheld (the words survive, the reply ends as a plain stop), and an ALREADY RUNNING program is stopped at its next inner dispatch through tools/pre-execute. Calls that already ran stay run; the gate never claims or performs a rollback.',
        'The steering decision is structural (the host steering queue), not a judgement about what the input means: a harmless progress ping pauses the stale action exactly like a real correction, and the persona is told to continue the same plan after saying where it is. That uniform treatment is a deliberate safety choice and is registered as a limitation, not as a semantic claim.',
        'Clarification waiting IS in this slice (ticket 04): the wait is opened by the host durable ask_user_question call and closed by its settle or by human input. While it is open, ticket 03 conversational exemptions are off and a reply that would call a tool is stopped. The preset pins the BLOCKING (legacy) ask — that is what pauses the request; no waiting flag of our own decides it.',
        'The timed ask variant is used here only to reach the host pending state deterministically (a headless host has no answerer to keep a blocking ask open); production keeps the blocking shape and check:preset fails if the row switches mode.',
        'A program that acts BEFORE its own ask, inside the same program, is outside this gate: the gate judges the assembled reply, not the program body. The persona forbids it and the host blocks at the ask, but no mechanical check here can order statements inside a program.',
        'Ticket 07 crossings are in this slice: a steering note is not an answer to an open question (IG07-01), and a wait survives both a spent budget and a reload (IG07-02). Together with 04/05/06 they are the only mechanical crossings claimed; anything about what the model UNDERSTANDS stays persona-owned.',
        'Ticket 07 presentation-surface evidence lives in scripts/test-intent-gate-surface.mjs and is captured at the client wire boundary: the session controller folds the same agent/assistant-stream frames and re-emits each as the browser frame, so "no visible text before validation" is asserted on the browser payload, not on a log. No browser screenshot was taken: the controller row needs the browser connection/credentials stack, and starting the daily Web host is not authorized here.',
        'IGB-AC-12 (real-model effect: misreadings, missed/needless questions, task outcome, waiting cost) is NOT executed and stays GAP. The fixed adapter proves routing and refusal, never model understanding or benefit.',
        'Cost accounting is observed at the seam (usage on the durable assistant/attempt stream and on assistant/message); pricing and summation are the host/consumer business and are not produced here. An attempt with no reported usage stays unknown, never zero.',
        'A retry policy that claims failures BEFORE the gate cannot be prevented from retrying; the guarantee this gate makes is that it never grants a second declaration repair (IG02-09 uses a delegating policy, the shape the loop documents).',
        'CLI/browser rendering of the formal reply is not exercised here; the pre-publication guarantee is proven up to the publication frame (ticket 07).',
        'PTC reports workspace-write with partial enforcement; this is not a stronger isolation guarantee.',
    ]
    if (findings.cases?.some(entry => entry.status === 'FAIL')) process.exitCode = 1
    findings.status = findings.cases?.some(entry => entry.status === 'FAIL') ? 'FAIL' : 'PASS'
    fs.writeFileSync(path.join(root, 'host-result.json'), JSON.stringify(findings, null, 2) + '\n')
}
