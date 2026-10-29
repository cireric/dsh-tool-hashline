#!/usr/bin/env node
/** Client-wire acceptance: Intent formatting and clarification never synthesize Failed or automatic turns. Browser pixels remain GAP. */
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = process.cwd()
const [profileArgument, evidenceArgument, filterArgument] = process.argv.slice(2)
const ONLY = filterArgument === undefined ? undefined : filterArgument
const rootEvidence = path.resolve(evidenceArgument ?? path.join(root, '.tmp', 'intent-gate-surface-' + Date.now()))
const notes = []
let profile
if (profileArgument === '--pack') {
    const { installBundle, composeProfile } = await import('./delivery-acceptance.mjs')
    const install = await installBundle([], notes)
    await composeProfile(install, notes)
    profile = install.profile
} else {
    profile = path.resolve(profileArgument)
}
const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'))
if (manifest.name !== 'dsh-profile-acceptance') throw new Error('This driver only accepts the disposable dsh-profile-acceptance installation.')

// Everything this run writes stays under the evidence directory (never the checkout root).
const runRoot = path.join(root, '.tmp', 'surface-run-' + Date.now())
fs.mkdirSync(runRoot, { recursive: true })
const workspace = fs.mkdtempSync(path.join(runRoot, 'workspace-'))
process.env.DSH_HOME = path.join(runRoot, 'dsh-home')
process.env.DSH_TELEMETRY_DISABLED = '1'
process.chdir(workspace)

const req = createRequire(path.join(profile, 'package.json'))
/**
 * The evidence names the candidate it tested. A surface claim from an older bundle cannot be
 * pasted onto the current diff, so the two asset digests are recorded here exactly as the host
 * tier does (LF-normalised sha256), and `scripts/host-gate-evidence.mjs --kind surface` refuses
 * an artifact whose digests are not the ones in the tree under review.
 */
const sha256 = file => createHash('sha256').update(fs.readFileSync(file).toString('utf8').replace(/\r\n/gu, '\n'), 'utf8').digest('hex')
const recordInstalled = () => {
    const bundleRoot = path.dirname(req.resolve('dsh-tool-hashline/package.json'))
    const versions = {}
    for (const name of ['@deepseek-ai/dsh', '@hy-sde-org/dsh-tool-edit', '@hy-sde-org/dsh-hashline']) {
        try { versions[name] = JSON.parse(fs.readFileSync(req.resolve(name + '/package.json'), 'utf8')).version } catch { versions[name] = 'unresolved' }
    }
    return {
        bundleRoot,
        gateModuleSha256: sha256(path.join(bundleRoot, 'presets/ptc-hashline/intent-gate-watchdog.mjs')),
        personaSha256: sha256(path.join(bundleRoot, 'presets/ptc-hashline/personas/orchestrator.md')),
        versions,
    }
}
const load = async name => import(pathToFileURL(req.resolve(name)).href)
const boot = await load('@deepseek-ai/dsh-app-boot')
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm')
const loaded = boot.loadProfileDirectory('e2', profile, req.resolve('@deepseek-ai/dsh/package.json'))
const webPatches = boot.loadOverlayPatches('e2-web-host-topology', req.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'))
const webHostDisables = webPatches.filter(patch => typeof patch.id === 'string' && patch.disabled === true)
/** Host-scope rows the preset needs and the web topology used to disable (as in the host tier). */
const webHostRows = webPatches.flatMap(patch => patch.insert ?? []).filter(row => row.id === 'subagent-model-selection-settings')
const config = path.join(profile, 'e2-root.yml')
fs.writeFileSync(config, '[]\n')

const overlays = [
    ...webHostDisables,
    { insert: webHostRows },
    { insert: [{ id: 'e2-agent-presets', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'ptc-hashline' } }] },
    { id: 'headless-startup', disabled: true },
    { id: 'headless-runner', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
]

/** Frames the Web client renders as visible assistant text, captured at the wire boundary. */
const frames = []
const findings = {
    profile,
    startedAt: new Date().toISOString(),
    surface: 'agent/assistant-stream (the 1:1 source of the client assistant-stream frames) + session surface events (the client message journal)',
    clientMappingEvidence: 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/assistant-stream.js folds these frames and follow() re-emits each as {type:"assistant-stream", frame}',
    browserScreenshot: false,
    /** Which candidate produced this evidence (filled in once the profile resolves). */
    installed: null,
    controllerCompositionAttempt: {
        result: 'not composed',
        reason: 'session-controller waits for fileUploads; file-upload waits for connection (browser connection + credentials/webStartup); starting the daily Web host is not authorized',
    },
    overlays: overlays.map(row => row.id ?? 'insert'),
    scriptedLlmRequests: 0,
    realModelRequests: 0,
    cases: [],
    logs: [],
}

const queues = new Map()
const usage = { inputTokens: 11, outputTokens: 7, totalTokens: 18 }
const textAttempt = text => [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage },
    { type: 'finish', reason: { kind: 'stop' } },
]
const programAttempt = (text, code) => {
    const args = JSON.stringify({ code, description: 'surface acceptance program' })
    return [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text },
        { type: 'block-end', index: 0, block: { type: 'text', text } },
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 1, id: 'call-1', name: 'run_code', argumentsDelta: args },
        { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'call-1', name: 'run_code', arguments: args } },
        { type: 'usage', usage },
        { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: 'surface', blocks: [{}, {}] } },
    ]
}
const FALLBACK = textAttempt('child or non-target reply without a declaration line')

class Fixed extends LlmAdapter {
    async *stream(request, signal) {
        findings.scriptedLlmRequests += 1
        const actor = request?.sessionId
        const queue = queues.get(actor) ?? []
        const attempt = queue.shift() ?? FALLBACK
        for (const chunk of attempt) {
            if (signal?.aborted === true) return
            yield chunk
            await new Promise(resolve => setTimeout(resolve, 5))
        }
    }
}

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const test = async (id, fn) => {
    if (ONLY !== undefined && !id.includes(ONLY)) return
    const mark = frames.length
    try {
        const evidence = await fn(mark)
        findings.cases.push({ id, status: 'PASS', ...evidence })
        console.log('CASE ' + id + ' PASS')
    } catch (error) {
        findings.cases.push({
            id,
            status: 'FAIL',
            error: error.message,
            stack: String(error?.stack ?? '').split('\n').slice(0, 6).join(' | '),
            frames: frames.slice(mark),
        })
        console.error('CASE ' + id + ' FAIL ' + error.message)
    }
}

let ctx
let created = []
const create = async () => {
    const agent = await ctx.get('agentLoop').create('surface-' + Date.now() + '-' + Math.random().toString(36).slice(2), { provider: 'ig-fixed', model: 'fixed' }, { cwd: workspace })
    await ctx.get('agentPresets').select(agent, 'ptc-hashline')
    created.push(agent)
    return agent
}
const waitIdle = async (agent, ms = 60_000) => {
    await Promise.race([agent.whenIdle(), new Promise((_, reject) => setTimeout(() => reject(new Error('session did not settle')), ms))])
}
/** Visible-text frames: exactly what the client appends to the assistant bubble. */
const visibleText = slice => slice
    .filter(frame => frame.kind === 'assistant-stream' && frame.frame?.type === 'chunk' && frame.frame?.chunk?.type === 'text-delta')
    .map(frame => String(frame.frame.chunk.text))
    .join('')
/** The client's message journal, read from the session surface the journal renders. */
const journal = agent => agent.session.snapshotEvents().filter(event => event.type === 'assistant/message' || event.type === 'user/message' || event.type === 'turn/end')
const assistantTexts = agent => journal(agent)
    .filter(event => event.type === 'assistant/message')
    .map(event => (event.data?.message?.content ?? []).filter(block => block?.type === 'text').map(block => block.text).join(''))

try {
    ctx = await boot.boot('e2', config, [...loaded.layers.flatMap(layer => layer.patches), ...loaded.patches, ...overlays], c => {
        c.logger.exporter({ levels: { default: 2 }, export: ({ name, type, args }) => { if (type === 'warn' || type === 'error') findings.logs.push({ name, type, args: args.map(a => (a instanceof Error ? (a.stack ?? a.message) : String(a))) }) } })
    }, pathToFileURL(profile + path.sep).href)
    ctx.get('llm').registerAdapter(['ig-fixed'], new Fixed())
    ctx.on('agent/assistant-stream', payload => {
        frames.push({ kind: 'assistant-stream', at: Date.now(), session: payload?.agent?.session?.id, frame: payload?.frame })
    }, { global: true })
    findings.presets = (await ctx.get('agentPresets').list()).map(row => row.id)
    findings.installed = recordInstalled()

    for (const [id, text] of [
        ['plain-clarification', 'Which interpretation do you mean: A or B?'],
        ['declared-clarification', 'Intent: investigation — clarify scope; I will ask first. Which scope do you mean?'],
        ['empty-marker', 'Intent:'],
    ]) await test('INTENT-surface-' + id, async mark => {
        const agent = await create()
        const requestsBefore = findings.scriptedLlmRequests
        queues.set(agent.id, [textAttempt(text)])
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Analyse the request.' }] }))
        await waitIdle(agent)
        const slice = frames.slice(mark).filter(frame => frame.session === agent.session.id)
        assert(visibleText(slice) === text, 'normal reply reached the client unchanged')
        assert(assistantTexts(agent).length === 1, 'exactly one assistant message')
        const events = journal(agent)
        assert(!events.some(event => event.type === 'turn/end' && event.data?.reason?.kind === 'error'), 'no Failed turn')
        assert(!events.some(event => event.type === 'user/message' && event.data?.source?.kind === 'intent-gate-watchdog'), 'no automatic repair or continuation')
        assert(findings.scriptedLlmRequests === requestsBefore + 1, 'one generation, then waiting for the user')
        return { clientVisibleText: text, failures: [], requests: 1, automaticNotices: 0 }
    })

} catch (error) {
    findings.fatal = String(error?.stack ?? error)
    console.error('FATAL ' + findings.fatal)
} finally {
    findings.status = findings.fatal !== undefined ? 'FAIL'
        : findings.cases.some(row => row.status === 'FAIL') ? 'FAIL'
            : findings.cases.length === 0 ? 'EMPTY' : 'PASS'
    findings.finishedAt = new Date().toISOString()
    findings.realModelRequests = 0
    fs.mkdirSync(rootEvidence, { recursive: true })
    fs.writeFileSync(path.join(rootEvidence, 'surface-result.json'), JSON.stringify(findings, null, 2) + '\n')
    console.log('Surface evidence: ' + path.join(rootEvidence, 'surface-result.json'))
    console.log('STATUS ' + findings.status + ' cases=' + findings.cases.length + ' scripted=' + findings.scriptedLlmRequests + ' realModelRequests=0')
    if (ctx) await Promise.race([ctx.fiber.dispose(), new Promise(resolve => setTimeout(resolve, 30_000))])
    process.exit(findings.status === 'PASS' ? 0 : 1)
}
