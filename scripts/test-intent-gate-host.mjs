/** Installed-host acceptance: advisory Intent, normal clarification, real user-controlled waiting. Fixed adapter; no real model requests. */
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
        usesSixBuckets: /Buckets, exactly six/iu.test(persona?.text ?? ''),
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
    const scopeOf = (entries, agent) => entries.filter(entry => entry.agent === agent.id || entry.session === agent.session.id)
    const noticesOf = (entries, agent) => scopeOf(entries, agent).filter(entry => entry.kind === 'user-message' && entry.sourceKind === 'intent-gate-watchdog')
    const requestsOf = (entries, agent) => scopeOf(entries, agent).filter(entry => entry.kind === 'request' && entry.purpose === null)
    for (const [id, text] of [
        ['clear', 'Here is the answer.'],
        ['clarification', 'Intent: investigation — clarify authorization; I will ask first. Does the conditional instruction mean approval has already been granted, or should we wait for confirmation?'],
        ['missing-marker', 'Which interpretation do you mean: A or B?'],
        ['empty-marker', 'Intent:'],
    ]) await test('INTENT-normal-' + id, async () => {
        const next = await create()
        const result = await runCase(next, [textAttempt(text)], 'Analyse the request.')
        assert.equal(result.published, text)
        assert.equal(result.errors.length, 0)
        assert.equal(requestsOf(result.entries, next).length, 1)
        assert.equal(noticesOf(result.entries, next).length, 0)
        assert.equal(result.effects.length, 0)
        return { requests: 1, errors: 0, automaticNotices: 0, published: text }
    })
    await test('INTENT-user-answer-opens-work-not-an-automatic-turn', async () => {
        const next = await create()
        const question = await runCase(next, [textAttempt('Do you mean A or B?')], 'Resolve the ambiguity.')
        assert.equal(requestsOf(question.entries, next).length, 1)
        assert.equal(question.errors.length, 0)
        assert.equal(fs.existsSync(path.join(workspace, 'answered.txt')), false)
        const answered = await runCase(next, [programAttempt('Intent: implementation — implement A; I will create the requested fixture.', "await tools.write({file_path:'answered.txt',content:'A'}); return 'done'")], 'Choose A and create the fixture.')
        assert.equal(disk('answered.txt'), 'A')
        assert.equal(answered.errors.length, 0)
        assert.equal(noticesOf(answered.entries, next).length, 0)
        assert.ok(answered.own.some(entry => entry.kind === 'dispatch-start' && entry.name === 'write'))
        return { questionRequests: 1, workAfterUserAnswer: true, automaticNotices: 0 }
    })
    let releaseAnswer
    let answerPromise
    await ctx.plugin({ name: 'test-question-answerer', apply(c) {
        c.on('user-questions/request', async (request, next) => {
            if (answerPromise === undefined) return await next()
            push({ kind: 'question-waiting' })
            const answer = await answerPromise
            push({ kind: 'question-answered' })
            return { answers: request.questions.map(question => ({ id: question.id, selected: [answer] })) }
        })
    } })
    await test('INTENT-structured-question-waits-for-an-actual-answer', async () => {
        const next = await create()
        answerPromise = new Promise(resolve => { releaseAnswer = resolve })
        const mark = log.length
        const pending = runCase(next, [programAttempt('Intent: investigation — clarify the scope; I will ask first.', "return await tools.ask_user_question({questions:[{id:'pick',header:'Pick',question:'A or B?',options:[{label:'A'},{label:'B'}]}]})")], 'Clarify the choice.')
        try {
            await waitForLog(entry => entry.kind === 'question-waiting', 30000, mark)
            assert.ok(log.slice(mark).some(entry => entry.kind === 'question-waiting'))
            assert.equal(requestsOf(log.slice(mark), next).length, 1, 'no generation while waiting')
            assert.equal(log.slice(mark).filter(entry => entry.kind === 'write-effect').length, 0)
        } finally { releaseAnswer('A') }
        const result = await pending
        answerPromise = undefined
        assert.equal(result.errors.length, 0)
        assert.equal(noticesOf(result.entries, next).length, 0)
        return { waitedForUser: true, writesWhileWaiting: 0, automaticNotices: 0 }
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
        'Installed full preset, real AgentLoop/Session/process PTC and publication frames; deterministic adapter, realModelRequests=0.',
        'Intent formatting does not withhold replies, synthesize errors, remove tools or open repair/continuation turns.',
        'Prose clarification ends normally; a real user answer precedes work. Structured questions use the actual blocking host question seam.',
        'GAP: semantic ambiguity detection by a real model and actual browser rendering are not tested.',
    ]
    if (findings.cases?.some(entry => entry.status === 'FAIL')) process.exitCode = 1
    findings.status = findings.cases?.some(entry => entry.status === 'FAIL') ? 'FAIL' : 'PASS'
    fs.writeFileSync(path.join(root, 'host-result.json'), JSON.stringify(findings, null, 2) + '\n')
}
