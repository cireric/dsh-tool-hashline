/** Read user provenance through host observations; never carry read/seen facts. */
export class UserSourceError extends Error {
  constructor(message) {
    super('[EDIT_POLICY_USER_SOURCE] ' + message)
    this.name = 'UserSourceError'
    this.code = 'EDIT_POLICY_USER_SOURCE'
  }
}

/** Text credited to a human by the host, not an assistant/tool/agent relay. */
export const userTextOf = event => event?.type === 'user/message' && event.data?.source?.kind === 'user'
  ? (event.data.content ?? []).filter(part => part?.type === 'text').map(part => part.text).join('')
  : undefined

/**
 * Fork-inherited events are not this session's source. The host delivers an
 * initial delegation as a user-shaped message: it is a task, not a new human
 * authorization. Later human messages remain eligible; agent relays do not.
 */
function ownSourceEvents(view) {
  const prefix = view.inheritedEventCount ?? 0
  const own = prefix === 0 ? view.events : view.events.filter(event => event.seq >= prefix)
  if (view.header?.origin !== 'subagent') return own
  const initialTask = own.find(event => event.type === 'user/message')
  return own.filter(event => event !== initialTask)
}

const containsQuote = (events, quote) => events.some(event => (userTextOf(event) ?? '').includes(quote))
const reject = message => { throw new UserSourceError(message) }

/**
 * Resolve a named source, or the nearest verified ancestor containing a quote.
 * A remote edge needs BOTH the child's own host-validated subagent projection
 * and its exact entry in the parent's own catalog. Parent events after this
 * delegation are excluded: an unassociated later request is not authorization
 * for this task. Cold parents use the same live-preferred observation API.
 * Every lease is released, no corpus scan or persistent allow/cache is added.
 */
export async function resolveUserSourceEvents({ ctx, session, events, source, signal }) {
  const own = ownSourceEvents({ header: session.header, inheritedEventCount: session.inheritedEventCount, events })
  const ownId = session.id ?? session.header?.id
  if (source.sessionId === ownId || (source.sessionId === undefined && (containsQuote(own, source.quote) || source.eventSeq !== undefined))) return own
  if (source.sessionId === undefined && session.header?.origin !== 'subagent') return own
  const unrelated = () => reject('sessionId "' + String(source.sessionId ?? 'unknown') + '" is neither this session nor its delegating parent with a verified task association. Quote the original user request from the current session or a verified delegation.')
  if (session.header?.origin !== 'subagent') return unrelated()
  const query = ctx.get?.('sessionQuery')
  if (typeof query?.observeSession !== 'function') reject('the host sessionQuery observation service is unavailable; a parent user citation cannot be verified. Use Hashline or ask the user to restate the request in this session.')
  const observe = async id => {
    signal?.throwIfAborted()
    let lease
    try {
      lease = await query.observeSession(id, { signal })
      if (lease?.header?.id !== id || !Number.isInteger(lease.header.createdAt) || lease.header.createdAt < 0 || !Array.isArray(lease.events) || !Number.isInteger(lease.inheritedEventCount) || lease.inheritedEventCount < 0 || typeof lease[Symbol.dispose] !== 'function') reject('the host returned an incomplete observation for the cited delegation.')
      return { header: lease.header, events: lease.events, inheritedEventCount: lease.inheritedEventCount, projections: lease.projections }
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof UserSourceError) throw error
      reject('the host could not observe the cited delegation: ' + String(error?.message ?? error))
    } finally {
      lease?.[Symbol.dispose]?.()
    }
  }
  let child = await observe(ownId)
  if (child.header.createdAt !== session.header.createdAt) reject('the observed child identity does not match this editing session.')
  const visited = new Set([ownId])
  for (;;) {
    const parentId = child.header.parentSession
    if (child.header.origin !== 'subagent' || typeof parentId !== 'string') return unrelated()
    if (visited.has(parentId)) reject('the delegation ancestry contains a cycle; no parent source can be verified.')
    visited.add(parentId)
    const identity = child.projections?.values?.subagent
    if (identity === null || identity === undefined || !Number.isInteger(identity.seq) || identity.seq < child.inheritedEventCount || !['one-shot', 'continuable'].includes(identity.mode)) reject('this child has no own host-validated subagent identity; fork ancestry alone does not authorize a parent source.')
    const parent = await observe(parentId)
    const catalog = parent.projections?.values?.subagentCatalog
    if (!Array.isArray(catalog)) reject('the host subagent catalog projection is unavailable; this task association cannot be verified.')
    const entries = catalog.filter(entry => entry.id === child.header.id && entry.createdAt === child.header.createdAt && entry.mode === identity.mode && entry.label === identity.label)
    if (entries.length !== 1) reject('the parent catalog does not uniquely establish this child and task; lineage alone does not authorize the citation.')
    const records = parent.events.filter(event => event.seq >= parent.inheritedEventCount && event.type === 'subagent/catalog' && event.data?.childId === child.header.id && event.data.childCreatedAt === child.header.createdAt && event.data.mode === identity.mode && event.data.label === identity.label)
    if (records.length !== 1) reject('the parent has no unique own delegation record for this task; inherited catalog events cannot authorize it.')
    const beforeDelegation = parent.events.filter(event => event.seq < records[0].seq)
    const candidates = ownSourceEvents({ ...parent, events: beforeDelegation })
    if (source.sessionId === parentId || (source.sessionId === undefined && containsQuote(candidates, source.quote))) return candidates
    child = { ...parent, events: beforeDelegation }
  }
}
