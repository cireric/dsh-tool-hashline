/** Deterministic host wiring fixture. Zero network or real-model requests. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export const inject = ['llm', 'agents']
export function apply(ctx) {
  const seen = new Set()
  class Fixture extends LlmAdapter {
    providerInfo() { return { id: 'eval-fixture', name: 'offline fixture' } }
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      const actor = ctx.get('agents').requireInitiator(), id = actor.id
      ctx.emit('evaluation-fixture/request', id)
      const first = !seen.has(id)
      seen.add(id)
      const prompt = actor.session.snapshotEvents().slice(actor.session.inheritedEventCount ?? 0).filter(e => e.type === 'user/message').flatMap(e => e.data.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n')
      if (!first && prompt.includes('fixture:cancel-child')) {
        // Real stream cancellation with deliberately unavailable usage.
        await new Promise((_, reject) => {
          const abort = () => { ctx.emit('evaluation-fixture/aborted', id); reject(options.signal.reason ?? new Error('fixture aborted')) }
          if (options.signal.aborted) return abort()
          options.signal.addEventListener('abort', abort, { once: true })
          ctx.emit('evaluation-fixture/waiting', id)
        })
      }
      const fork = prompt.includes('fixture:fork-now') && !actor.session.snapshotEvents().slice(actor.session.inheritedEventCount ?? 0).some(e => e.type === 'subagent/catalog')
      const call = ((first && !prompt.includes('fixture:fork-seed')) || fork) && !prompt.includes('fixture:noop')
      const text = call ? 'Intent: fix — execute offline evaluation fixture.' : 'done'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      if (call) {
        const fallbackArm = actor.session.snapshotEvents().some(e => e.type === 'agent-preset/selected' && e.data.agentPreset === 'eval-hashline-fallback')
        let code = `const r=await tools.read({file_path:'a.txt'});if(r.tag){await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 1:\\n+y'});}else{await tools.edit({file_path:'a.txt',old_string:'x',new_string:'y'});}return 'done';`
        if (prompt.includes('fixture:delegate')) code = `return await tools.subagent({description:'offline lineage fixture',prompt:'fixture:child'});`
        if (fork) code = `return await tools.subagent_fork({description:'offline inherited prefix',prompt:'fixture:child'});`
        if (prompt.includes('fixture:cancel-delegate')) code = `return await tools.subagent({description:'offline cancellation fixture',prompt:'fixture:cancel-child'});`
        if (prompt.includes('fixture:multi') || prompt.includes('fixture:apply-authorized')) code = `for(const [file,value] of [['a.txt','y'],['b.txt','z']]){const r=await tools.read({file_path:file});if(r.tag){await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 1:\\n+'+value});}else{await tools.edit({file_path:file,old_string:'x',new_string:value});}}return 'done';`
        if (prompt.includes('fixture:drift')) code = `const r=await tools.read({file_path:'a.txt'});let refused=false;try{if(r.tag){await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 1:\\n+y'});}else{await tools.edit({file_path:'a.txt',old_string:'x',new_string:'y'});}}catch(e){refused=true;}const fresh=await tools.read({file_path:'a.txt'});if(fresh.tag){await tools.edit({input:'['+fresh.path+'#'+fresh.tag+']\\nPUT 1:\\n+y'});}else{await tools.edit({file_path:'a.txt',old_string:'competitor',new_string:'y'});}return {refused};`
        if (prompt.includes('fixture:apply-authorized') && fallbackArm) code = `await tools.read({file_path:'a.txt'});await tools.read({file_path:'b.txt'});await tools.edit({input:'*** Begin Patch\\n*** Update File: a.txt\\n@@\\n-x\\n+y\\n*** Update File: b.txt\\n@@\\n-x\\n+z\\n*** End Patch',fallbacks:['a.txt','b.txt'].map(path=>({path,reason:'user-override',modes:['apply_patch'],userSource:{quote:'For the fallback arm, use apply_patch to change a.txt x to y and b.txt x to z, keeping final newlines.'}}))});return 'done';`
        if (prompt.includes('fixture:apply-recover') && fallbackArm) code = `await tools.read({file_path:'a.txt'});try{await tools.edit({input:'*** Begin Patch\\n*** Update File: a.txt\\n@@\\n-x\\n+y\\n*** End Patch'});}catch(e){}const fresh=await tools.read({file_path:'a.txt'});await tools.edit({input:'['+fresh.path+'#'+fresh.tag+']\\nPUT 1:\\n+y'});return 'done';`
        if (prompt.includes('fixture:write-only')) code = 'await tools.write(' + JSON.stringify({ file_path: 'a.txt', content: prompt.includes('fixture:write-only-wrong') ? 'wrong\n' : 'y\n' }) + ');return "done";'
        const block = { type: 'tool-call', id: 'fixture-' + id, name: 'run_code', arguments: JSON.stringify({ code, description: 'offline fixture' }) }
        yield { type: 'block-start', index: 1, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 1, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index: 1, block }
      }
      const tokens = prompt.includes('fixture:write-only-expensive') ? 5 : 1
      yield { type: 'usage', usage: { inputTokens: tokens, outputTokens: tokens, totalTokens: tokens * 2 } }
      yield { type: 'finish', reason: { kind: call ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.get('llm').registerAdapter(['eval-fixture'], new Fixture())
}
