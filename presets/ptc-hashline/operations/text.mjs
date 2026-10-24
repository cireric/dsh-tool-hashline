/**
 * Text helpers shared by the incident assembler and the offline extractor.
 *
 * Both read the same session-log shapes and must present their first lines the
 * same way, so the three trivial helpers live here instead of being copied into
 * two modules (plan §3: reuse the existing decoding/evidence components).
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/text
 */

/** The first line of a text block, or ''. */
export function firstLineOf(text) {
  return text.split('\n')[0] ?? ''
}

/** Clip a string to `limit` characters with an ellipsis; non-strings pass through. */
export function clip(value, limit) {
  return typeof value !== 'string' ? value : value.length <= limit ? value : value.slice(0, limit) + '…'
}

/**
 * Whether one decoded record is the USER'S OWN message.
 *
 * One predicate in one place: the incident bundle reports the session's last
 * user message and the upgrade consent quotes the user's reply, and both must
 * agree on what counts. An agent message, a tool result and another session's
 * text are all something else.
 * @param {object} record a decoded session record
 * @returns {boolean} true when the record is a user-authored message
 */
export function isUserMessage(record) {
  return record?.type === 'user/message' && record?.data?.source?.kind === 'user'
}

/** Concatenate the text blocks of one message body. */
export function textOfBlocks(blocks) {
  return Array.isArray(blocks) ? blocks.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n') : ''
}
