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

/** Concatenate the text blocks of one message body. */
export function textOfBlocks(blocks) {
  return Array.isArray(blocks) ? blocks.filter((block) => block?.type === 'text').map((block) => block.text ?? '').join('\n') : ''
}
