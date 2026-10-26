/** Fixed programs through the real loop and PTC, with synthetic usage only. */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { promptPrefixes, suiteProgram } from './programs.mjs'
export const inject = ['llm', 'agents']
export function apply(ctx) {
  const requests = new Map()
  class Fixture extends LlmAdapter {
    providerInfo() { return { id: 'eval-suite', name: 'offline task suite' } }
    async resolveModel(provider, model) {
      if (model !== 'fixture-suite') throw new Error('only fixture-suite is supported')
      return { provider, id: model, name: model }
    }
    async *stream() {
      const actor = ctx.get('agents').requireInitiator(), events = actor.session.snapshotEvents()
      const prompt = events.filter(e => e.type === 'user/message').flatMap(e => e.data.content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n')
      const id = promptPrefixes.find(([, prefix]) => prompt.startsWith(prefix))?.[0]
      const selected = events.findLast(e => e.type === 'agent-preset/selected')?.data.agentPreset
      const step = requests.get(actor.id) ?? 0
      const code = suiteProgram(id, selected?.slice('eval-'.length), step, process.platform === 'win32' ? 'pwsh' : 'bash')
      requests.set(actor.id, step + 1)
      const text = code ? 'Intent: fix — execute offline suite program.' : 'offline suite done'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      if (code) {
        const block = { type: 'tool-call', id: 'suite-' + actor.id + '-' + step, name: 'run_code', arguments: JSON.stringify({ code, description: 'offline suite program' }) }
        yield { type: 'block-start', index: 1, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 1, id: block.id, name: block.name, argumentsDelta: block.arguments }
        yield { type: 'block-end', index: 1, block }
      }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: code ? 'tool-calls' : 'stop' } }
    }
  }
  ctx.get('llm').registerAdapter(['eval-suite'], new Fixture())
}
