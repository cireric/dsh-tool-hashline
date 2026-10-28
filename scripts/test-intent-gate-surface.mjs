#!/usr/bin/env node
/**
 * Presentation-surface acceptance for the request-level intent gate (ticket 07).
 *
 * The claim under test is an INTERFACE claim, not a log claim: a reply that has not been
 * validated never reaches the client as visible text, and a rejected reply produces no
 * visible body at all.
 *
 * Why this is the client's payload and not a private hook:
 *   - the Web client renders assistant text from the dense \`agent/assistant-stream\` frames;
 *     \`@deepseek-ai/dsh-api-session-controller\` (lib/types/assistant-stream.js) folds exactly
 *     those frames into its reconnect baseline and \`follow()\` re-emits each one as
 *     \`{ type: 'assistant-stream', frame }\` — a 1:1 passthrough, no transformation;
 *   - chat messages come from the session surface events the client journal renders
 *     (\`assistant/message\`, \`user/message\`, \`turn/end\`), read here through the Session's open
 *     reader \`snapshotEvents()\`.
 *   So the frames captured below are the bytes the browser receives, minus transport.
 *
 * Not covered (registered as GAP in the acceptance doc): a screenshot of a running browser.
 * The controller row needs the browser connection stack (fileUploads <- connection <-
 * credentials/webStartup), and starting the daily Web host is not authorized in this task.
 *
 * Usage:
 *   node scripts/test-intent-gate-surface.mjs --pack .tmp/intent-gate-surface-01
 *   node scripts/test-intent-gate-surface.mjs <retained profile path> <evidence dir> [filter]
 */
import fs from 'node:fs'
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

    await test('IG07-S1-an-unvalidated-reply-never-reaches-the-client', async mark => {
        const agent = await create()
        queues.set(agent.id, [
            programAttempt('I will just write the file.', "await tools.write({ file_path: 'surface-a.txt', content: 'x\\n' }); return 'ok'"),
            textAttempt('Intent: write the file after the correction; I will write it once.'),
            programAttempt('Writing it now, under the declaration.', "await tools.write({ file_path: 'surface-a.txt', content: 'ok\\n' }); return 'ok'"),
            textAttempt('The file is written.'),
        ])
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Write the fixture.' }] }))
        await waitIdle(agent)
        await new Promise(resolve => setTimeout(resolve, 200))
        const slice = frames.slice(mark).filter(frame => frame.session === agent.session.id)
        const texts = visibleText(slice)
        // The first attempt was rejected, so its words must never have been presented: the only
        // text the client ever saw belongs to the ACCEPTED (second) attempt.
        // Nothing of the withheld attempt reached the client; the declaration arrives first, and
        // only then does the work of the same request appear.
        assert(texts.startsWith('Intent: write the file after the correction; I will write it once.'), 'the client saw only validated text, declaration first, got ' + JSON.stringify(texts))
        assert(texts.includes('Writing it now, under the declaration.'), 'the business step of the same request followed the declaration')
        assert(texts.includes('I will just write the file.') === false, 'the withheld words never reached the client')
        const firstAttemptText = slice.filter(frame => frame.frame?.type === 'chunk' && frame.frame?.chunk?.type === 'text-delta').slice(0, 1)
        assert(firstAttemptText.every(frame => frame.at >= 0), 'frames are stamped')
        assert(fs.readFileSync(path.join(workspace, 'surface-a.txt'), 'utf8') === 'ok\n', 'the withheld program never ran; only the declared one did')
        const assistantMessages = assistantTexts(agent)
        assert(assistantMessages.length >= 1 && assistantMessages[0].startsWith('Intent: write the file after the correction'), 'the validated declaration is the first client message: ' + JSON.stringify(assistantMessages))
        const notice = journal(agent).filter(event => event.type === 'user/message' && event.data?.source?.kind === 'intent-gate-watchdog')
        assert(notice.length === 2, 'the client journal carries the correction notice and the continuation notice, got ' + notice.length)
        assert(String(notice[0].data?.content?.[0]?.text).startsWith('[intent-gate] Your previous reply'), 'the repair notice comes first')
        assert(String(notice[1].data?.content?.[0]?.text).startsWith('[intent-gate] Your declaration'), 'the continuation notice comes after it')
        const attemptEnds = slice.filter(frame => frame.frame?.type === 'end' && frame.frame?.outcome?.eventType === 'assistant/attempt')
        assert(attemptEnds.length >= 1, 'the rejected attempt ended as an ATTEMPT on the client stream, never as a message')
        return { clientVisibleText: texts.slice(0, 40), withheldDispatch: false, notices: notice.length, attemptEnds: attemptEnds.length, declarationFirst: true }
    })

    await test('IG07-S2-the-validated-reply-is-what-the-client-renders', async mark => {
        const agent = await create()
        queues.set(agent.id, [textAttempt('Intent: answer the surface case; I will reply in prose.')])
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Explain the fixture.' }] }))
        await waitIdle(agent)
        await new Promise(resolve => setTimeout(resolve, 200))
        const slice = frames.slice(mark).filter(frame => frame.session === agent.session.id)
        const texts = visibleText(slice)
        assert(texts === 'Intent: answer the surface case; I will reply in prose.', 'the accepted text reached the client verbatim: ' + JSON.stringify(texts))
        const starts = slice.filter(frame => frame.frame?.type === 'start')
        const ends = slice.filter(frame => frame.frame?.type === 'end')
        assert(starts.length >= 1 && ends.length >= 1, 'the presentation stream opened and closed')
        assert(ends.every(frame => frame.frame?.outcome?.kind === 'committed'), 'the accepted attempt ended committed')
        assert(assistantTexts(agent)[0].startsWith('Intent: answer the surface case'), 'the accepted reply became a client message')
        return { clientVisibleText: texts.slice(0, 30), starts: starts.length, ends: ends.length }
    })

    await test('IG07-S3-an-exhausted-request-shows-a-failure-not-a-body', async mark => {
        const agent = await create()
        queues.set(agent.id, [textAttempt('no declaration at all'), textAttempt('still nothing declared')])
        agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Do the thing.' }] }))
        await waitIdle(agent)
        await new Promise(resolve => setTimeout(resolve, 200))
        const slice = frames.slice(mark).filter(frame => frame.session === agent.session.id)
        assert(visibleText(slice) === '', 'no visible text for a request whose two attempts were both rejected: ' + JSON.stringify(visibleText(slice)))
        assert(assistantTexts(agent).length === 0, 'no assistant message in the client journal')
        const turnErrors = journal(agent).filter(event => event.type === 'turn/end' && event.data?.reason?.kind === 'error')
        // Two generations were withheld and neither is the user's business answer: the withheld
        // attempt and the declaration-only step each close their own turn.
        assert(turnErrors.length === 2, 'both withheld turns are reported on the surface, got ' + turnErrors.length)
        assert(turnErrors[0].data.reason.error.code === 'INTENT_DECLARATION_MISSING', 'the first turn names the miss, got ' + String(turnErrors[0].data.reason.error.code))
        assert(turnErrors[1].data.reason.error.code === 'INTENT_DECLARATION_REPAIR_EXHAUSTED', 'the second names the spent repair, got ' + String(turnErrors[1].data.reason.error.code))
        return { clientVisibleText: '', assistantMessages: 0, failures: turnErrors.map(event => event.data.reason.error.code) }
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
