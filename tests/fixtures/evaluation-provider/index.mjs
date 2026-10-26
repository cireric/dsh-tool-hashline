/** Deterministic host wiring fixture. Zero network or real-model requests. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export const inject = ['llm', 'agents']
export function apply(ctx) {
  const seen = new Set()
  class Fixture extends LlmAdapter {
    providerInfo() { return { id: 'eval-fixture', name: 'offline fixture' } }
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream() {
      const actor = ctx.get('agents').requireInitiator(), id = actor.id
      const first = !seen.has(id)
      seen.add(id)
      const text = first ? 'Intent: fix — execute offline evaluation fixture.' : 'done'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      if (first) {
        const prompt = actor.session.snapshotEvents().filter(e => e.type === 'user/message').flatMap(e => e.data.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n')
        let code = `const r=await tools.read({file_path:'a.txt'});if(r.tag){await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 1:\\n+y'});}else{await tools.edit({file_path:'a.txt',old_string:'x',new_string:'y'});}return 'done';`
        if (prompt.includes('fixture:delegate')) code = `return await tools.subagent({description:'offline lineage fixture',prompt:'fixture:child'});`
        if (prompt.includes('fixture:multi')) code = `for(const [file,value] of [['a.txt','y'],['b.txt','z']]){const r=await tools.read({file_path:file});if(r.tag){await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 1:\\n+'+value});}else{await tools.edit({file_path:file,old_string:'x',new_string:value});}}return 'done';`
        if (prompt.includes('fixture:drift')) code = `const r=await tools.read({file_path:'a.txt'});let refused=false;try{if(r.tag){await tools.edit({input:'['+r.path+'#'+r.tag+']\\nPUT 1:\\n+y'});}else{await tools.edit({file_path:'a.txt',old_string:'x',new_string:'y'});}}catch(e){refused=true;}const fresh=await tools.read({file_path:'a.txt'});if(fresh.tag){await tools.edit({input:'['+fresh.path+'#'+fresh.tag+']\\nPUT 1:\\n+y'});}else{await tools.edit({file_path:'a.txt',old_string:'competitor',new_string:'y'});}return {refused};`
        const block = { type: 'tool-call', id: 'fixture-' + id, name: 'run_code', arguments: JSON.stringify({ code, description: 'offline fixture' }) }
        yield { type: 'block-start', index: 1, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 1, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index: 1, block }
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: first ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.get('llm').registerAdapter(['eval-fixture'], new Fixture())
}
