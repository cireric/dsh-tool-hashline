/**
 * Full installed preset acceptance over production AgentLoop and process PTC.
 * This is a deterministic host-contract test, not a real-model evaluation.
 * Build in an isolated tree first. Pass --pack to install fresh tarballs, or
 * pass a disposable profile from test:delivery --keep, and a fresh evidence dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const [profileArgument, evidenceArgument] = process.argv.slice(2);
if (!profileArgument || !evidenceArgument)
    throw new Error('usage: node scripts/test-default-edit-host.mjs <--pack|isolated-profile-directory> <fresh-evidence-directory>');
const root = path.resolve(evidenceArgument);
if (fs.existsSync(path.join(root, 'host-result.json')))
    throw new Error('Use a fresh evidence directory; existing host-result.json is preserved.');
fs.mkdirSync(root, { recursive: true });
let profile;
if (profileArgument === '--pack') {
    const { installBundle, composeProfile } = await import('./delivery-acceptance.mjs');
    const notes = [];
    const install = await installBundle([], notes);
    await composeProfile(install, notes);
    profile = install.profile;
    fs.writeFileSync(path.join(root, 'installation.json'), JSON.stringify({ profile, bundleRoot: install.bundleRoot, notes }, null, 2) + '\n');
    console.log('Retained isolated profile: ' + profile);
} else {
    profile = path.resolve(profileArgument);
}
const manifest = JSON.parse(fs.readFileSync(path.join(profile, 'package.json'), 'utf8'));
if (manifest.name !== 'dsh-profile-acceptance')
    throw new Error('This driver only accepts the disposable dsh-profile-acceptance installation produced by test:delivery --keep or --pack.');
const workspace = fs.mkdtempSync(path.join(root, 'workspace-'));
process.env.DSH_HOME = path.join(root, 'dsh-home');
process.env.DSH_TELEMETRY_DISABLED = '1';
process.chdir(workspace);
const req = createRequire(path.join(profile, 'package.json'));
const load = async (n) => import(pathToFileURL(req.resolve(n)).href);
const boot = await load('@deepseek-ai/dsh-app-boot');
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm');
const loaded = boot.loadProfileDirectory('e2', profile, req.resolve('@deepseek-ai/dsh/package.json'));
const webPatches = boot.loadOverlayPatches('e2-web-host-topology', req.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml'));
const webHostDisables = webPatches.filter(p => typeof p.id === 'string' && p.disabled === true);
const webHostRows = webPatches.flatMap(p => p.insert ?? []).filter(p => p.id === 'subagent-model-selection-settings');
const config = path.join(profile, 'e2-root.yml');
fs.writeFileSync(config, '[]\n');
const overlays = [
    { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
    { id: 'session-title-llm', disabled: true }, { id: 'session-telemetry-otel', disabled: true },
    { insert: webHostRows },
    { insert: [{ id: 'e2-agent-presets', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'ptc-hashline' } }] },
];
let ctx;
const findings = { profile, startedAt: new Date().toISOString(), overlays, bundleLayers: loaded.layers.map(l => l.packageName), scriptedLlmRequests: 0, realModelRequests: 0 };
const readEntry = req.resolve('@dsh-tool-hashline/tool-read');
const editEntry = req.resolve('@dsh-tool-hashline/tool-edit');
const upstreamEdit = createRequire(editEntry).resolve('@hy-sde-org/dsh-tool-edit');
const engineFromRead = fs.realpathSync(createRequire(readEntry).resolve('@hy-sde-org/dsh-hashline'));
const engineFromEdit = fs.realpathSync(createRequire(upstreamEdit).resolve('@hy-sde-org/dsh-hashline'));
const policyFile = path.join(path.dirname(req.resolve('dsh-tool-hashline/package.json')), 'presets/ptc-hashline/policy/default-edit-policy.mjs');
findings.installed = {
    readEntry, editEntry, upstreamEdit, engineFromRead, engineFromEdit,
    samePhysicalEngine: engineFromRead === engineFromEdit,
    policySha256: createHash('sha256').update(fs.readFileSync(policyFile)).digest('hex'),
    editorSha256: createHash('sha256').update(fs.readFileSync(upstreamEdit)).digest('hex'),
    versions: Object.fromEntries(['@deepseek-ai/dsh', '@hy-sde-org/dsh-tool-edit', '@hy-sde-org/dsh-hashline'].map(name => [name, JSON.parse(fs.readFileSync(req.resolve(name + '/package.json'), 'utf8')).version])),
};
assert.equal(findings.installed.samePhysicalEngine, true, 'read/edit must share one physical hashline');
try {
    findings.webHostDisables = webHostDisables;
    findings.logs = [];
    ctx = await boot.boot('e2', config, [...loaded.layers.flatMap(l => l.patches), ...loaded.patches, ...webHostDisables, ...overlays], c => {
        c.logger.exporter({ levels: { default: 2 }, export: ({ name, type, args }) => { if (type === 'warn' || type === 'error')
                findings.logs.push({ name, type, args: args.map(a => a instanceof Error ? (a.stack ?? a.message) : String(a)) }); } });
    }, pathToFileURL(profile + path.sep).href);
    class Fixed extends LlmAdapter {
        async resolveModel(provider, model) { return { provider, id: model, name: model }; }
        async *stream() {
            findings.scriptedLlmRequests++;
            const actor = ctx.get('agents').requireInitiator();
            const code = programs.get(actor.id)?.shift();
            const text = code === undefined ? 'deterministic test complete' : 'Intent: fix — execute the isolated acceptance fixture.';
            yield { type: 'block-start', index: 0, blockType: 'text' };
            yield { type: 'text-delta', index: 0, text };
            yield { type: 'block-end', index: 0, block: { type: 'text', text } };
            if (code !== undefined) {
                const id = 'e2-script-' + findings.scriptedLlmRequests, name = typeof code === 'string' ? 'run_code' : code.name, args = JSON.stringify(typeof code === 'string' ? { code, description: 'isolated acceptance program' } : code.args);
                yield { type: 'block-start', index: 1, blockType: 'tool-call' };
                yield { type: 'tool-call-delta', index: 1, id, name, argumentsDelta: args };
                yield { type: 'block-end', index: 1, block: { type: 'tool-call', id, name, arguments: args } };
            }
            yield { type: 'finish', reason: { kind: code === undefined ? 'stop' : 'tool-calls' } };
        }
    }
    const programs = new Map();
    ctx.get('llm').registerAdapter(['e2-fixed'], new Fixed());
    findings.services = ['tools', 'agents', 'agentLoop', 'agentPresets', 'ptcRuntime', 'subagents', 'fs', 'sessionPersistence'].map(n => ({ name: n, present: ctx.get(n) !== undefined }));
    findings.presets = await ctx.get('agentPresets').list();
    findings.preSelectInspection = ctx.get('agentPresets').inspectCompositions();
    findings.loaderEntries = Array.from(ctx.get('loader').entries()).map(e => ({ id: e.options.id, name: e.options.name, disabled: e.disabled, fiberState: e.fiber?.state, error: e.error === undefined ? undefined : String(e.error) }));
    const agent = await ctx.get('agentLoop').create('e2-parent-' + Date.now(), { provider: 'e2-fixed', model: 'fixed' }, { cwd: workspace });
    findings.agentId = agent.id;
    await ctx.get('agentPresets').select(agent, 'ptc-hashline');
    findings.composedPreset = ctx.get('agentPresets').composedPreset(agent.ctx);
    if (findings.composedPreset !== 'ptc-hashline')
        throw new Error('full target preset was not selected');
    findings.compositions = ctx.get('agentPresets').inspectCompositions(agent.ctx);
    const assembly = await ctx.get('systemPrompt').assemble({ scope: agent, agent });
    findings.sections = assembly.sections.map(s => ({ name: s.name, length: s.text.length }));
    findings.ptc = { isolation: ctx.get('ptcRuntime')?.isolation, language: ctx.get('ptcRuntime')?.language };
    findings.toolResults = [];
    findings.receipts = [];
    ctx.on('tools/result', (exec, result) => { findings.toolResults.push({ sessionId: exec.agent?.id, callId: exec.callId, rootCallId: exec.rootCallId, subCallId: exec.subCallId, name: exec.name, result }); }, { global: true });
    ctx.on('tool-edit/policy-receipt', r => { findings.receipts.push({ callId: r.exec?.callId, rootCallId: r.exec?.rootCallId, version: r.version, mode: r.mode, result: r.result, code: r.code, retry: r.retry }); }, { global: true });
    findings.cases = [];
    const effects = [];
    const hostFs = ctx.get('fs');
    const originalWrite = hostFs.writeText.bind(hostFs);
    hostFs.writeText = async (...args) => { const effect = { path: args[0]?.displayPath, intent: args[2]?.kind }; effects.push(effect); try {
        const out = await originalWrite(...args);
        effect.outcome = 'returned';
        return out;
    }
    catch (e) {
        effect.outcome = 'threw';
        throw e;
    } };
    const q = JSON.stringify;
    const create = async (preset = 'ptc-hashline') => { const a = await ctx.get('agentLoop').create('e2-' + Date.now() + '-' + Math.random().toString(36).slice(2), { provider: 'e2-fixed', model: 'fixed' }, { cwd: workspace }); await ctx.get('agentPresets').select(a, preset); return a; };
    const run = async (a, code, user = 'Execute the deterministic isolated acceptance case.') => {
        const start = findings.toolResults.length, beforeEffects = effects.length;
        programs.set(a.id, [code]);
        a.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] }));
        await Promise.race([a.whenIdle(), new Promise((_, reject) => setTimeout(() => reject(new Error('case timed out')), 45000).unref())]);
        const calls = findings.toolResults.slice(start).filter(r => r.sessionId === a.id);
        const outer = calls.filter(r => r.name === 'run_code').at(-1);
        assert.ok(outer, 'actual run_code result missing');
        return { outer: outer.result, calls, effects: effects.slice(beforeEffects) };
    };
    const test = async (id, fn) => { try {
        const evidence = await fn();
        findings.cases.push({ ...evidence, id, status: 'PASS' });
        console.log('CASE ' + id + ' PASS');
    }
    catch (e) {
        findings.cases.push({ id, status: 'FAIL', error: e.message });
        console.error('CASE ' + id + ' FAIL ' + e.message);
    } };
    const write = (name, text) => fs.writeFileSync(path.join(workspace, name), text);
    const disk = name => fs.readFileSync(path.join(workspace, name), 'utf8');
    const ok = r => { assert.equal(r.outer.isError, false, r.outer.error?.message); return r.outer.value.result; };
    await test('E2-02-managed-refusal-no-write', async () => {
        write('refuse.txt', 'one\ntwo\n');
        const r = await run(agent, `await tools.read({file_path:'refuse.txt'}); await tools.edit({path:'refuse.txt',old_string:'two',new_string:'TWO'});`);
        assert.equal(r.outer.isError, true);
        assert.match(r.outer.error.message, /EDIT_POLICY_FALLBACK_REQUIRED/u);
        assert.equal(disk('refuse.txt'), 'one\ntwo\n');
        assert.equal(r.effects.length, 0);
        return { effects: 0 };
    });
    await test('E2-04-continuous-hashline', async () => {
        write('chain.txt', 'one\ntwo\nthree\n');
        const r = await run(agent, `const r=await tools.read({file_path:'chain.txt'});const a=await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 2.=2:\\n+TWO'});const h=a.match(/^\\[(.+)#[0-9A-F]{4}\\]/m)[0];const b=await tools.edit({input:h+'\\nPUT 3.=3:\\n+THREE'});return {a,b};`);
        const v = ok(r);
        assert.equal(typeof v.a, 'string');
        assert.equal(typeof v.b, 'string');
        assert.equal(disk('chain.txt'), 'one\nTWO\nTHREE\n');
        return { effects: r.effects.length };
    });
    await test('E2-block-capability-guidance-and-diagnostics', async () => {
        const description = ctx.get('tools').schemas(agent).find(s => s.name === 'edit')?.description ?? '';
        assert.match(description, /PUT N\*:[\s\S]*CUT N\*[\s\S]*unavailable/iu);
        assert.doesNotMatch(description, /closing line resolved/u);
        write('block-capability.js', 'function sample() {\n  return 1;\n}\n');
        const r = await run(agent, `const x=await tools.read({file_path:'block-capability.js'});const h='['+x.path+'#'+x.tag+']';const errors=[];for(const op of ['PUT 1*:\\n+replacement','CUT 1*']){try{await tools.edit({input:h+'\\n'+op});errors.push('NOT_REFUSED');}catch(e){errors.push(String(e.message));}}await tools.edit({input:h+'\\nPUT 2.=2:\\n+  return 2;'});const y=await tools.read({file_path:'block-capability.js'});const after=await tools.edit({input:'['+y.path+'#'+y.tag+']\\nPUT >1*:\\n+// inserted'});return {errors,after};`);
        const value = ok(r);
        for (const error of value.errors) {
            assert.match(error, /not available.*no block resolver/iu);
            assert.doesNotMatch(error, /unsupported language|parse error/iu);
        }
        assert.equal(value.errors.length, 2);
        assert.match(value.after, /plain|after line/iu);
        assert.equal(disk('block-capability.js'), 'function sample() {\n// inserted\n  return 2;\n}\n');
        assert.equal(r.effects.length, 2);
        return { effects: 2, refusedBlockCalls: 2 };
    });
    const declarations = loaded.layers.find(l => l.packageName === 'dsh-tool-hashline').patches.flatMap(p => p.insert ?? []);
    const target = declarations.find(p => p.config?.id === 'ptc-hashline');
    await test('E2-02-policy-off-full-preset-control', async () => {
        const rows = structuredClone(target.config.plugins);
        delete rows.find(r => r.id === 'tool-edit').config.contentPolicyModule;
        await ctx.get('agentPresets').register({ id: 'e2-policy-off', plugins: rows });
        const b = await create('e2-policy-off');
        write('off.txt', 'one\ntwo\n');
        const r = await run(b, `await tools.read({file_path:'off.txt'});return await tools.edit({path:'off.txt',old_string:'two',new_string:'TWO'});`);
        ok(r);
        assert.equal(disk('off.txt'), 'one\nTWO\n');
        return { effects: r.effects.length };
    });
    await test('E2-03-full-prompt-sdk-guidance', async () => {
        assert.ok(assembly.sections.find(s => s.name === 'tool:edit-policy')?.text.includes('Default edit policy'));
        const sdk = assembly.sections.find(s => s.name === 'tools:sdk')?.text ?? '';
        for (const reason of ['snapshot-limit', 'window-limit', 'user-override'])
            assert.ok(sdk.includes(reason));
        write('long.txt', 'x'.repeat(3000) + '\n');
        const r = await run(agent, `const r=await tools.read({file_path:'long.txt'});return {tag:r.tag,nextAction:r.nextAction};`);
        const v = ok(r);
        assert.match(v.nextAction, /window-limit/u);
        assert.doesNotMatch(v.nextAction, /remount|larger max|Raise /u);
        return { nextAction: v.nextAction };
    });
    for (const mode of ['replace', 'patch', 'apply_patch'])
        await test('E2-05-' + mode + '-user-override', async () => {
            const name = mode + '.txt';
            write(name, 'alpha\nbeta\n');
            const payload = mode === 'replace' ? { path: name, old_string: 'beta', new_string: 'BETA' } : mode === 'patch' ? { path: name, edits: [{ op: 'update', diff: '@@ -1,2 +1,2 @@\n alpha\n-beta\n+BETA' }] } : { input: '*** Begin Patch\n*** Update File: ' + name + '\n@@\n alpha\n-beta\n+BETA\n*** End Patch' };
            const quote = 'Use ' + mode + ' mode on ' + name + ' to change beta to BETA.';
            const r = await run(agent, `await tools.read({file_path:${q(name)}});let refused;try{await tools.edit(${q(payload)});refused='NOT_REFUSED';}catch(e){refused=String(e.message);}const out=await tools.edit(${q({ ...payload, fallbacks: [{ path: name, reason: 'user-override', userSource: { quote }, modes: [mode] }] })});return {refused,out};`, quote);
            const v = ok(r);
            assert.match(v.refused, /EDIT_POLICY_FALLBACK_REQUIRED/u);
            assert.equal(disk(name), 'alpha\nBETA\n');
            return { mode, effects: r.effects.length };
        });
    const textOfBytes = n => { const rest = n - 7, chunk = 'x'.repeat(99) + '\n'; return 'TARGET\n' + chunk.repeat(Math.floor(rest / 100)) + 'x'.repeat(rest % 100); };
    for (const difference of [-1, 0, 1])
        await test('E2-06-snapshot-boundary-' + difference, async () => {
            const name = 'boundary-' + difference + '.txt', n = 4194304 + difference;
            write(name, textOfBytes(n));
            const r = await run(agent, `const r=await tools.read({file_path:${q(name)}});const citation=r.nextAction?.match(/readCallId: (\\S+?)\\)/)?.[1]??'unavailable';let out;try{await tools.edit({path:${q(name)},old_string:'TARGET',new_string:'CHANGED',fallbacks:[{path:${q(name)},reason:'snapshot-limit',readCallId:citation}]});out='changed';}catch(e){out=String(e.message);}return {tagged:r.tagged,out};`);
            const v = ok(r);
            assert.equal(v.tagged, difference < 0);
            if (difference < 0) {
                assert.match(v.out, /EDIT_POLICY_/u);
                assert.equal(r.effects.length, 0);
                assert.equal(disk(name).slice(0, 7), 'TARGET\n');
            }
            else {
                assert.equal(v.out, 'changed');
                assert.equal(disk(name).slice(0, 8), 'CHANGED\n');
            }
            return { bytes: n, tagged: v.tagged, effects: r.effects.length };
        });
    await test('E2-06-target-window-degradation', async () => {
        write('window.txt', 'short\n' + 'x'.repeat(3000) + '\ntail\n');
        const r = await run(agent, `const r=await tools.read({file_path:'window.txt'});const id=r.nextAction.match(/readCallId: (\\S+?)\\)/)[1];return await tools.edit({path:'window.txt',old_string:'x'.repeat(3000),new_string:'y'.repeat(3000),fallbacks:[{path:'window.txt',reason:'window-limit',readCallId:id,ranges:[{startLine:2,endLine:2}]}]});`);
        ok(r);
        assert.equal(disk('window.txt'), 'short\n' + 'y'.repeat(3000) + '\ntail\n');
        return { effects: r.effects.length };
    });
    await test('E2-06-unrelated-window-refusal', async () => {
        write('unrelated.txt', 'short\n' + 'x'.repeat(3000) + '\ntail\n');
        const r = await run(agent, `const r=await tools.read({file_path:'unrelated.txt'});const id=r.nextAction.match(/readCallId: (\\S+?)\\)/)[1];await tools.edit({path:'unrelated.txt',old_string:'short',new_string:'SHORT',fallbacks:[{path:'unrelated.txt',reason:'window-limit',readCallId:id,ranges:[{startLine:1,endLine:1}]}]});`);
        assert.equal(r.outer.isError, true);
        assert.match(r.outer.error.message, /EDIT_POLICY_REASON_FALSE/u);
        assert.equal(r.effects.length, 0);
        assert.equal(disk('unrelated.txt').slice(0, 6), 'short\n');
        return { effects: 0 };
    });
    await test('E2-07-mixed-create-update-refused-before-write', async () => {
        write('mixed.txt', 'old\n');
        const input = '*** Begin Patch\n*** Add File: must-not-exist.txt\n+created\n*** Update File: mixed.txt\n@@\n-old\n+NEW\n*** End Patch';
        const r = await run(agent, `await tools.read({file_path:'mixed.txt'});await tools.edit({input:${q(input)}});`);
        assert.equal(r.outer.isError, true);
        assert.match(r.outer.error.message, /EDIT_POLICY_FALLBACK_REQUIRED/u);
        assert.equal(r.effects.length, 0);
        assert.equal(fs.existsSync(path.join(workspace, 'must-not-exist.txt')), false);
        assert.equal(disk('mixed.txt'), 'old\n');
        return { effects: 0 };
    });
    await test('E2-07-limited-and-ordinary-update-refused-as-one-request', async () => {
        const big = textOfBytes(4194304);
        write('big-mixed.txt', big);
        write('ordinary-mixed.txt', 'ordinary\n');
        const patch = '*** Begin Patch\n*** Update File: big-mixed.txt\n@@\n-' + 'x'.repeat(8) + '\n+' + 'Y'.repeat(8) + '\n*** Update File: ordinary-mixed.txt\n@@\n-ordinary\n+ORDINARY\n*** End Patch';
        const r = await run(agent, `const b=await tools.read({file_path:'big-mixed.txt'});const id=b.nextAction.match(/readCallId: (\\S+?)\\)/)[1];await tools.read({file_path:'ordinary-mixed.txt'});await tools.edit({input:${q(patch)},fallbacks:[{path:'big-mixed.txt',reason:'snapshot-limit',readCallId:id}]});`);
        assert.equal(r.outer.isError, true);
        assert.match(r.outer.error.message, /EDIT_POLICY_FALLBACK_REQUIRED/u);
        assert.equal(r.effects.length, 0);
        assert.equal(disk('big-mixed.txt'), big);
        assert.equal(disk('ordinary-mixed.txt'), 'ordinary\n');
        return { effects: 0 };
    });
    await test('E2-07-payload-mutual-exclusion', async () => {
        write('payload.txt', 'old\n');
        const r = await run(agent, `await tools.edit({path:'payload.txt',old_string:'old',new_string:'NEW',edits:[{op:'delete'}]});`);
        assert.equal(r.outer.isError, true);
        assert.equal(r.effects.length, 0);
        assert.equal(disk('payload.txt'), 'old\n');
        return { effects: 0 };
    });
    await test('E2-08-read-evidence-external-drift', async () => {
        write('drift.txt', textOfBytes(4194304));
        const first = await run(agent, `const r=await tools.read({file_path:'drift.txt'});return r.nextAction.match(/readCallId: (\\S+?)\\)/)[1];`);
        const id = ok(first);
        write('drift.txt', 'competitor\n');
        const r = await run(agent, `await tools.edit({path:'drift.txt',old_string:'competitor',new_string:'WRONG',fallbacks:[{path:'drift.txt',reason:'snapshot-limit',readCallId:${q(id)}}]});`);
        assert.equal(r.outer.isError, true);
        assert.match(r.outer.error.message, /EDIT_POLICY_EVIDENCE_STALE/u);
        assert.equal(r.effects.length, 0);
        assert.equal(disk('drift.txt'), 'competitor\n');
        return { effects: 0 };
    });
    await test('E2-08-effective-cwd-change-invalidates-read-evidence', async () => {
        const first = path.join(workspace, 'cwd-first'), second = path.join(workspace, 'cwd-second');
        fs.mkdirSync(first, { recursive: true });
        fs.mkdirSync(second, { recursive: true });
        write('cwd-first/target.txt', textOfBytes(4194304));
        write('cwd-second/target.txt', textOfBytes(4194304));
        await ctx.get('workingDirectory').set(agent, first);
        const read = await run(agent, `const r=await tools.read({file_path:'target.txt'});return r.nextAction.match(/readCallId: (\\S+?)\\)/)[1];`);
        const readId = ok(read);
        await ctx.get('workingDirectory').set(agent, second);
        let edit;
        try {
            edit = await run(agent, `await tools.edit({path:'target.txt',old_string:'TARGET',new_string:'WRONG',fallbacks:[{path:'target.txt',reason:'snapshot-limit',readCallId:${q(readId)}}]});`);
        } finally {
            await ctx.get('workingDirectory').set(agent, workspace);
        }
        assert.equal(edit.outer.isError, true);
        assert.match(edit.outer.error.message, /EDIT_POLICY_READ_CWD/u);
        assert.equal(edit.effects.length, 0);
        assert.equal(fs.readFileSync(path.join(second, 'target.txt'), 'utf8').slice(0, 7), 'TARGET\n');
        return { oldCwd: first, currentCwd: second, effects: 0 };
    });
    await test('E2-12-partial-program-effects-retained', async () => {
        write('landed.txt', 'old\n');
        write('later.txt', 'later\n');
        const r = await run(agent, `const a=await tools.read({file_path:'landed.txt'});await tools.edit({input:'['+a.path+'#'+a.tag+']\\nPUT 1.=1:\\n+NEW'});await tools.read({file_path:'later.txt'});await tools.edit({path:'later.txt',old_string:'later',new_string:'WRONG'});`);
        assert.equal(r.outer.isError, true);
        assert.equal(disk('landed.txt'), 'NEW\n');
        assert.equal(disk('later.txt'), 'later\n');
        return { effects: r.effects.length };
    });
    await test('E2-12-caught-refusal-remains-visible-with-successful-outer-call', async () => {
        write('caught.txt', 'old\n');
        const r = await run(agent, `await tools.read({file_path:'caught.txt'});let refusal;try{await tools.edit({path:'caught.txt',old_string:'old',new_string:'WRONG'});refusal='NOT_REFUSED';}catch(e){refusal=String(e.message);}return {refusal};`);
        const value = ok(r);
        assert.match(value.refusal, /EDIT_POLICY_FALLBACK_REQUIRED/u);
        assert.equal(disk('caught.txt'), 'old\n');
        assert.equal(r.effects.length, 0);
        return { effects: 0, innerRefusal: value.refusal };
    });
    let nextChildProgram;
    findings.children = [];
    ctx.on('agent/created', async ({ agent: child }) => {
        if (child.session.header.origin !== 'subagent' || nextChildProgram === undefined)
            return;
        programs.set(child.id, [nextChildProgram]);
        nextChildProgram = undefined;
        await child.ctx.plugin({ name: 'e2-persona-override', inject: ['systemPrompt'], apply(c) { c.systemPrompt.section({ name: 'deployment:persona-prefix', order: c.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: 'E2 child persona override: execute only the deterministic fixture.' }); } });
        const prompt = await ctx.get('systemPrompt').assemble({ scope: child, agent: child });
        findings.children.push({ id: child.id, preset: ctx.get('agentPresets').composedPreset(child.ctx), headerParent: child.session.header.parentSession, parentSessionProperty: typeof child.session.parentSession, personaOverridden: prompt.sections.some(s => s.name === 'deployment:persona-prefix' && s.text.includes('E2 child persona override')), policyVisible: prompt.sections.some(s => s.name === 'tool:edit-policy' && s.text.includes('Default edit policy')) });
    }, { global: true });
    await test('E2-09-real-delegation-own-read-and-persona-override', async () => {
        write('parent-window.txt', 'x'.repeat(3000) + '\n');
        write('child-own.txt', 'one\ntwo\n');
        const before = await run(agent, `const r=await tools.read({file_path:'parent-window.txt'});return r.nextAction.match(/readCallId: (\\S+?)\\)/)[1];`);
        const parentReadId = ok(before);
        nextChildProgram = `let borrowed;try{await tools.edit({path:'parent-window.txt',old_string:'x'.repeat(3000),new_string:'WRONG',fallbacks:[{path:'parent-window.txt',reason:'window-limit',readCallId:${q(parentReadId)},ranges:[{startLine:1,endLine:1}]}]});borrowed='NOT_REFUSED';}catch(e){borrowed=String(e.message);}const own=await tools.read({file_path:'child-own.txt'});await tools.edit({input:'['+own.path+'#'+own.tag+']\\nPUT 2.=2:\\n+TWO'});return {borrowed};`;
        const spawned = await run(agent, `return await tools.subagent({description:'E2 child own evidence',prompt:'Execute the configured deterministic fixture and report completion.'});`);
        const id = ok(spawned).subagentId;
        const child = ctx.get('agents').get(id);
        assert.ok(child, 'spawned child is not live');
        await child.whenIdle();
        const outer = findings.toolResults.filter(r => r.sessionId === id && r.name === 'run_code').at(-1);
        assert.ok(outer);
        assert.equal(outer.result.isError, false, outer.result.error?.message);
        assert.match(outer.result.value.result.borrowed, /EDIT_POLICY_READ_CROSS_SESSION/u);
        assert.equal(disk('child-own.txt'), 'one\nTWO\n');
        assert.equal(disk('parent-window.txt'), 'x'.repeat(3000) + '\n');
        const meta = findings.children.find(c => c.id === id);
        assert.equal(meta.preset, 'ptc-hashline');
        assert.equal(meta.personaOverridden, true);
        assert.equal(meta.policyVisible, true);
        return { childId: id, ...meta };
    });
    await test('E2-09-real-parent-user-override-lineage', async () => {
        write('delegated.txt', 'old\n');
        const quote = 'Use replace mode on delegated.txt to change old to NEW in the delegated task.';
        nextChildProgram = `await tools.read({file_path:'delegated.txt'});return await tools.edit({path:'delegated.txt',old_string:'old',new_string:'NEW',fallbacks:[{path:'delegated.txt',reason:'user-override',modes:['replace'],userSource:{quote:${q(quote)},sessionId:${q(agent.id)}}}]});`;
        const spawned = await run(agent, `return await tools.subagent({description:'E2 delegated user override',prompt:'Apply the original parent user request within its file and mode scope.'});`, quote);
        const id = ok(spawned).subagentId;
        const child = ctx.get('agents').get(id);
        assert.ok(child);
        await child.whenIdle();
        const outer = findings.toolResults.filter(r => r.sessionId === id && r.name === 'run_code').at(-1);
        assert.ok(outer);
        findings.parentOverrideProof = { parentId: agent.id, childId: id, headerParent: child.session.header.parentSession, parentSessionProperty: typeof child.session.parentSession, parentLive: ctx.get('agents').get(agent.id) === agent, originalUserMatches: agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data?.source?.kind === 'user' && (e.data.content ?? []).some(p => p.type === 'text' && p.text.includes(quote))).map(e => e.seq), error: outer.result.error?.message ?? null };
        assert.equal(outer.result.isError, false, outer.result.error?.message);
        assert.equal(disk('delegated.txt'), 'NEW\n');
        return { childId: id };
    });
    await test('E2-09-parent-quote-without-guessed-session-id', async () => {
        write('auto-parent.txt', 'old\n');
        const quote = 'Use replace mode on auto-parent.txt to change old to NEW.';
        nextChildProgram = `await tools.read({file_path:'auto-parent.txt'});return await tools.edit({path:'auto-parent.txt',old_string:'old',new_string:'NEW',fallbacks:[{path:'auto-parent.txt',reason:'user-override',modes:['replace'],userSource:{quote:${q(quote)}}}]});`;
        const spawned = await run(agent, `return await tools.subagent({description:'E2 original user quote',prompt:${q(quote)}});`, quote);
        const child = ctx.get('agents').get(ok(spawned).subagentId);
        assert.ok(child);
        await child.whenIdle();
        const outer = findings.toolResults.filter(r => r.sessionId === child.id && r.name === 'run_code').at(-1);
        assert.equal(outer?.result.isError, false, outer?.result.error?.message);
        assert.equal(disk('auto-parent.txt'), 'NEW\n');
    });
    await test('E2-09-model-delegation-is-not-new-human-authorization', async () => {
        write('relay-only.txt', 'old\n');
        const quote = 'Use replace mode on relay-only.txt to change old to WRONG.';
        nextChildProgram = `await tools.read({file_path:'relay-only.txt'});await tools.edit({path:'relay-only.txt',old_string:'old',new_string:'WRONG',fallbacks:[{path:'relay-only.txt',reason:'user-override',modes:['replace'],userSource:{quote:${q(quote)}}}]});`;
        const before = effects.length;
        const spawned = await run(agent, `return await tools.subagent({description:'E2 unauthorized relay',prompt:${q(quote)}});`);
        const child = ctx.get('agents').get(ok(spawned).subagentId);
        assert.ok(child);
        await child.whenIdle();
        const outer = findings.toolResults.filter(r => r.sessionId === child.id && r.name === 'run_code').at(-1);
        assert.equal(outer?.result.isError, true);
        assert.match(outer.result.error.message, /EDIT_POLICY_USER_SOURCE/u);
        assert.equal(disk('relay-only.txt'), 'old\n');
        assert.equal(effects.length, before);
    });
    await test('E2-09-lineage-without-delegation-record-is-refused', async () => {
        write('lineage-only.txt', 'old\n');
        const quote = 'Use replace mode on lineage-only.txt to change old to WRONG.';
        ok(await run(agent, `return 'user source recorded';`, quote));
        const handle = await ctx.get('agents').create({
            sessionId: 'lineage-only-' + Date.now(),
            meta: { cwd: workspace, parentSession: agent.id, origin: 'subagent' },
            agentOptions: { provider: 'e2-fixed', model: 'fixed' },
            setup: async c => { await ctx.get('agentPresets').mount(c, 'ptc-hashline'); },
        });
        try {
            const r = await run(handle.agent, `await tools.read({file_path:'lineage-only.txt'});await tools.edit({path:'lineage-only.txt',old_string:'old',new_string:'WRONG',fallbacks:[{path:'lineage-only.txt',reason:'user-override',modes:['replace'],userSource:{quote:${q(quote)},sessionId:${q(agent.id)}}}]});`);
            assert.equal(r.outer.isError, true);
            assert.match(r.outer.error.message, /EDIT_POLICY_USER_SOURCE/u);
            assert.equal(r.effects.length, 0);
            assert.equal(disk('lineage-only.txt'), 'old\n');
        } finally { await handle.dispose(); }
    });
    await test('E2-09-persisted-parent-without-live-agent', async () => {
        write('cold-parent.txt', 'old\n');
        const quote = 'Use replace mode on cold-parent.txt to change old to NEW.';
        const owner = await ctx.get('agents').create({
            sessionId: 'cold-parent-' + Date.now(), meta: { cwd: workspace },
            agentOptions: { provider: 'e2-fixed', model: 'fixed' },
            setup: async c => { await ctx.get('agentPresets').mount(c, 'ptc-hashline'); },
        });
        nextChildProgram = `return 'child checkpointed';`;
        const spawned = await run(owner.agent, `return await tools.subagent({description:'E2 persisted parent',prompt:'Wait for the deterministic continuation.'});`, quote);
        const childId = ok(spawned).subagentId;
        const child = ctx.get('agents').get(childId);
        assert.ok(child);
        await child.whenIdle();
        await owner.agent.whenIdle();
        await ctx.get('sessions').flush(child.session);
        await ctx.get('sessions').flush(owner.agent.session);
        const parentId = owner.agent.id;
        await owner.dispose();
        assert.equal(ctx.get('agents').get(parentId), undefined);
        assert.equal(ctx.get('sessions').get(parentId), undefined);
        const resumed = await ctx.get('agents').resume({
            resumeSessionId: childId, agentOptions: { provider: 'e2-fixed', model: 'fixed' },
            setup: async c => { await ctx.get('agentPresets').mount(c, 'ptc-hashline'); },
        });
        try {
            const r = await run(resumed.agent, `await tools.read({file_path:'cold-parent.txt'});return await tools.edit({path:'cold-parent.txt',old_string:'old',new_string:'NEW',fallbacks:[{path:'cold-parent.txt',reason:'user-override',modes:['replace'],userSource:{quote:${q(quote)},sessionId:${q(parentId)}}}]});`);
            ok(r);
            assert.equal(disk('cold-parent.txt'), 'NEW\n');
            return { parentAbsentFromMemory: true };
        } finally { await resumed.dispose(); }
    });
    await test('E2-10-official-standard-preset-isolation', async () => {
        const webPackage = req.resolve('@deepseek-ai/dsh-web-app/package.json'), manifest = JSON.parse(fs.readFileSync(webPackage, 'utf8'));
        let standard;
        for (const item of [manifest.dsh.bundle.patch].flat())
            for (const entry of boot.loadOverlayPatches('standard-preset', path.resolve(path.dirname(webPackage), item)).flatMap(p => p.insert ?? []))
                if (entry.config?.id === 'standard')
                    standard = entry.config;
        assert.ok(standard, 'installed official standard definition missing');
        await ctx.get('agentPresets').register(standard);
        const native = await create('standard');
        const prompt = await ctx.get('systemPrompt').assemble({ scope: native, agent: native });
        assert.equal(prompt.sections.some(s => s.name === 'tool:edit-policy'), false);
        const schemas = ctx.get('tools').schemas(native);
        const edit = schemas.find(s => s.name === 'edit');
        assert.ok(edit);
        assert.equal(JSON.stringify(edit).includes('fallbacks'), false);
        write('native.txt', 'old\n');
        programs.set(native.id, [{ name: 'read', args: { file_path: 'native.txt' } }, { name: 'edit', args: { file_path: 'native.txt', old_string: 'old', new_string: 'NEW' } }]);
        native.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Run the native control fixture.' }] }));
        await native.whenIdle();
        assert.equal(disk('native.txt'), 'NEW\n');
        write('target-after-native.txt', 'old\n');
        const r = await run(agent, `await tools.read({file_path:'target-after-native.txt'});await tools.edit({path:'target-after-native.txt',old_string:'old',new_string:'WRONG'});`);
        assert.equal(r.outer.isError, true);
        assert.match(r.outer.error.message, /EDIT_POLICY_FALLBACK_REQUIRED/u);
        assert.equal(disk('target-after-native.txt'), 'old\n');
        return { nativePreset: 'standard', targetPreset: 'ptc-hashline' };
    });
    await test('E2-10-interleaved-target-sessions-do-not-share-read-facts', async () => {
        write('session-isolation.txt', textOfBytes(4194304));
        const first = await create('ptc-hashline');
        const second = await create('ptc-hashline');
        const read = await run(first, `const r=await tools.read({file_path:'session-isolation.txt'});return r.nextAction.match(/readCallId: (\\S+?)\\)/)[1];`);
        const readId = ok(read);
        const attempt = await run(second, `await tools.edit({path:'session-isolation.txt',old_string:'TARGET',new_string:'WRONG',fallbacks:[{path:'session-isolation.txt',reason:'snapshot-limit',readCallId:${q(readId)}}]});`);
        assert.equal(attempt.outer.isError, true);
        assert.match(attempt.outer.error.message, /EDIT_POLICY_READ_UNKNOWN|EDIT_POLICY_READ_CROSS_SESSION/u);
        assert.equal(attempt.effects.length, 0);
        assert.equal(disk('session-isolation.txt').slice(0, 7), 'TARGET\n');
        return { firstSession: first.id, secondSession: second.id, effects: 0 };
    });
    await test('E2-11-create-empty-fill-delete', async () => {
        write('zero.txt', '');
        write('delete.txt', 'remove me\n');
        const patch = '*** Begin Patch\n*** Add File: truly-new.txt\n+created\n*** End Patch';
        const r = await run(agent, `let createError;try{await tools.edit({input:${q(patch)}});createError='UNEXPECTED_EDIT_CREATION';}catch(e){createError=String(e.message);}await tools.write({file_path:'truly-new.txt',content:'created\\n'});await tools.read({file_path:'zero.txt'});await tools.edit({path:'zero.txt',edits:[{op:'update',diff:'@@ -1,0 +1,1 @@\\n+filled'}]});await tools.read({file_path:'delete.txt'});await tools.edit({path:'delete.txt',edits:[{op:'delete'}]});return {createError};`);
        const v = ok(r);
        assert.notEqual(v.createError, 'UNEXPECTED_EDIT_CREATION');
        assert.doesNotMatch(v.createError, /EDIT_POLICY_/u);
        assert.equal(disk('truly-new.txt'), 'created\n');
        assert.ok(disk('zero.txt').includes('filled'));
        assert.equal(fs.existsSync(path.join(workspace, 'delete.txt')), false);
        return { effects: r.effects.length, creationBoundary: 'create-shaped edit retains the existing host observation refusal; truly new content created by stock write' };
    });
    await test('E2-11-single-bom-empty-fill', async () => {
        fs.writeFileSync(path.join(workspace, 'bom-empty.txt'), Buffer.from('\uFEFF', 'utf8'));
        const r = await run(agent, `return await tools.edit({path:'bom-empty.txt',edits:[{op:'update',diff:'@@ -1,0 +1,1 @@\\n+with bom'}]});`);
        ok(r);
        assert.match(disk('bom-empty.txt'), /with bom/u);
        return { effects: r.effects.length, byteFidelityClaim: 'content only for replace mode; BOM-preserving guarantee is limited to hashline path' };
    });
    await test('E2-11-bom-crlf-hashline-move', async () => {
        fs.writeFileSync(path.join(workspace, 'bom.txt'), Buffer.from('\uFEFFalpha\r\nbeta\r\n', 'utf8'));
        const r = await run(agent, `const r=await tools.read({file_path:'bom.txt'});return await tools.edit({input:'['+r.path+'#'+r.tag+']\\nMV bom-moved.txt\\nPUT 2.=2:\\n+BETA'});`);
        ok(r);
        assert.equal(fs.existsSync(path.join(workspace, 'bom.txt')), false);
        assert.deepEqual(fs.readFileSync(path.join(workspace, 'bom-moved.txt')), Buffer.from('\uFEFFalpha\r\nBETA\r\n', 'utf8'));
        return { effects: r.effects.length };
    });
    await test('E2-11-move-destination-conflict-does-not-overwrite', async () => {
        write('move-source.txt', 'source\n');
        write('move-destination.txt', 'keep destination\n');
        const r = await run(agent, `const x=await tools.read({file_path:'move-source.txt'});return await tools.edit({input:'['+x.path+'#'+x.tag+']\\nMV move-destination.txt'});`);
        assert.equal(r.outer.isError, true);
        assert.equal(disk('move-source.txt'), 'source\n');
        assert.equal(disk('move-destination.txt'), 'keep destination\n');
        return { effects: r.effects.length };
    });
    await test('E2-11-whitespace-and-consecutive-bom-refused', async () => {
        write('spaces.txt', '   \n');
        write('double-bom.txt', '\uFEFF\uFEFF');
        const before = fs.readFileSync(path.join(workspace, 'double-bom.txt'));
        const r = await run(agent, `let spaces,bom;try{await tools.edit({path:'spaces.txt',old_string:'   ',new_string:'WRONG'});spaces='NOT_REFUSED';}catch(e){spaces=String(e.message);}try{await tools.edit({path:'double-bom.txt',edits:[{op:'update',diff:'@@ -1,0 +1,1 @@\\n+WRONG'}]});bom='NOT_REFUSED';}catch(e){bom=String(e.message);}return {spaces,bom};`);
        const v = ok(r);
        assert.match(v.spaces, /EDIT_POLICY_FALLBACK_REQUIRED/u);
        assert.notEqual(v.bom, 'NOT_REFUSED');
        assert.equal(r.effects.length, 0);
        assert.equal(disk('spaces.txt'), '   \n');
        assert.deepEqual(fs.readFileSync(path.join(workspace, 'double-bom.txt')), before);
        return { effects: 0 };
    });
    findings.effects = effects;
    if (findings.cases.some(c => c.status === 'FAIL'))
        process.exitCode = 1;
    findings.status = findings.cases.some(c => c.status === 'FAIL') ? 'FAIL' : 'PASS';
    findings.mounted = true;
    console.log('E2_MOUNTED ' + JSON.stringify({ preset: findings.composedPreset, services: findings.services, sections: findings.sections, ptc: findings.ptc }));
}
catch (e) {
    findings.status = 'failed';
    findings.error = { name: e.name, message: e.message, stack: e.stack };
    findings.inventory = await ctx?.get('agentPresets')?.compositionInventory();
    console.error('E2_FAILED ' + e.stack);
    process.exitCode = 1;
}
finally {
    if (ctx)
        await ctx.fiber.dispose();
    findings.finishedAt = new Date().toISOString();
    findings.boundaries = ['Actual installed full target preset mounted through official registry/loader, with real AgentLoop, Session persistence, subagent tools and Node process PTC.', 'Deterministic adapter and synthetic user-source fixtures; realModelRequests=0. No model-behavior/value evidence.', 'Base+headless host plus official Web host tool-disable overlays, preset registry and subagent-model-selection-settings. No target preset row removed or replaced.', 'Application entrypoints, automatic LLM titles and telemetry disabled in the test host. No daily profile switch/restart.', 'PTC returns workspace-write with enforcement=partial; not a stronger isolation guarantee.', 'Creation-shaped edit retains upstream observation refusal; truly new content is created with stock write.', 'Only writeText attempts are instrumented. Do not infer all possible side-effect absence from final bytes alone.'];
    fs.writeFileSync(path.join(root, 'host-result.json'), JSON.stringify(findings, null, 2) + '\n');
}
