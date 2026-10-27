/**
 * A dependency-free reader for the YAML SUBSET these preset patch files use.
 *
 * The shipped bundle carries no YAML parser and must not gain one, so this
 * module reads exactly the dialect found in preset.patch.yml and ptc.patch.yml:
 * indentation blocks, block sequences, mappings, plain and quoted scalars,
 * literal (|) and folded (>) block scalars, comments, and CUSTOM TAGS.
 *
 * A custom tag such as !!js is captured AS DATA and never evaluated: the check
 * compares an upstream expression character by character and never executes it.
 * That is a requirement of the ticket, not an optimisation — reading an upstream
 * preset must not run any code the preset names.
 *
 * Anything outside this subset raises YamlSubsetError with the line number, so a
 * file this reader cannot follow becomes a NAMED gap instead of reading as
 * unchanged. Folding (>) is approximated for same-indent prose, which is the
 * only folded value these two files carry.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/sync-yaml
 */

/** A structural problem in the subset reader, with the source line that caused it. */
export class YamlSubsetError extends Error {
  /**
   * @param {string} message what is not supported or not well formed
   * @param {number} [line] the 1-based source line
   */
  constructor(message, line) {
    super(message + (line === undefined ? '' : ' (line ' + String(line) + ')'))
    this.name = 'YamlSubsetError'
    this.line = line
  }
}

const TRUE_WORDS = new Set(['true', 'True', 'TRUE'])
const FALSE_WORDS = new Set(['false', 'False', 'FALSE'])
const NULL_WORDS = new Set(['null', 'Null', 'NULL', '~'])

/**
 * Read one document.
 * @param {string} text the file contents
 * @returns {unknown} the parsed value (arrays, plain objects and scalars)
 * @throws {YamlSubsetError} when the text is outside the supported subset
 */
export function parseYamlSubset(text) {
  const lines = String(text).replaceAll('\r\n', '\n').split('\n')
  const state = { lines, index: 0 }
  const first = peek(state)
  if (first === undefined) return null
  const value = parseNode(state, first.indent)
  const leftover = peek(state)
  if (leftover !== undefined) throw new YamlSubsetError('unexpected content after the document', leftover.number)
  return value
}

/**
 * The next significant line, leaving the cursor ON it.
 * @param {{lines: string[], index: number}} state the reader cursor
 * @returns {{indent: number, content: string, number: number} | undefined} the line
 */
function peek(state) {
  while (state.index < state.lines.length) {
    const raw = state.lines[state.index]
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      state.index += 1
      continue
    }
    const indent = raw.length - raw.trimStart().length
    if (raw.slice(0, indent).includes('\t')) throw new YamlSubsetError('tab indentation is not supported', state.index + 1)
    return { indent, content: raw.slice(indent).trimEnd(), number: state.index + 1 }
  }
  return undefined
}

/** Advance past the line the cursor sits on. */
function consume(state) {
  state.index += 1
}

/**
 * Parse the block that starts at the cursor.
 * @param {{lines: string[], index: number}} state the reader cursor
 * @param {number} indent the block's indentation
 * @returns {unknown} the block's value
 */
function parseNode(state, indent) {
  const line = peek(state)
  if (line === undefined || line.indent < indent) return null
  if (line.indent > indent) throw new YamlSubsetError('unexpected indentation', line.number)
  return isSequenceEntry(line.content) ? parseSequence(state, indent) : parseMapping(state, indent)
}

/** Whether a line's content is a block-sequence entry. */
function isSequenceEntry(content) {
  return content === '-' || content.startsWith('- ')
}

/** Whether a scalar indicator introduces a block scalar. */
function isBlockScalarIndicator(text) {
  return /^[|>][+-]?$/u.test(text)
}

/**
 * Parse one block sequence.
 * @param {{lines: string[], index: number}} state the reader cursor
 * @param {number} indent the sequence's indentation
 * @returns {unknown[]} the items
 */
function parseSequence(state, indent) {
  const items = []
  for (;;) {
    const line = peek(state)
    if (line === undefined || line.indent !== indent || !isSequenceEntry(line.content)) {
      if (line !== undefined && line.indent > indent) throw new YamlSubsetError('unexpected indentation in a sequence', line.number)
      break
    }
    const afterDash = line.content.slice(1)
    const spaces = afterDash.length - afterDash.trimStart().length
    const rest = afterDash.trimStart()
    const childIndent = indent + 1 + spaces
    consume(state)
    if (rest === '') {
      const next = peek(state)
      items.push(next !== undefined && next.indent > indent ? parseNode(state, next.indent) : null)
    } else if (isBlockScalarIndicator(rest)) {
      items.push(readBlockScalar(state, indent, rest))
    } else if (isSequenceEntry(rest)) {
      items.push(parseSequence(state, childIndent, { indent: childIndent, content: rest, number: line.number }))
    } else if (!rest.startsWith('!!') && splitKey(rest) !== null) {
      // A compact mapping whose first key sits on the dash line.
      items.push(parseMapping(state, childIndent, { indent: childIndent, content: rest, number: line.number }))
    } else {
      items.push(parseScalar(rest, line.number))
    }
  }
  return items
}

/**
 * Parse one block mapping.
 * @param {{lines: string[], index: number}} state the reader cursor
 * @param {number} indent the mapping's indentation
 * @param {{indent: number, content: string, number: number}} [first] a virtual first line (already consumed from a dash)
 * @returns {Record<string, unknown>} the mapping
 */
function parseMapping(state, indent, first) {
  // A null prototype: an upstream key named __proto__ (or constructor) is DATA
  // of this mapping, never a setter on Object.prototype. Untrusted upstream
  // content must not be able to swallow its own key or reshape the prototype.
  const map = Object.create(null)
  const seen = new Set()
  let line = first ?? peek(state)
  while (line !== undefined && line.indent === indent && !isSequenceEntry(line.content)) {
    const split = splitKey(line.content)
    if (split === null) throw new YamlSubsetError('expected a key and a value', line.number)
    const key = unquote(split.key)
    if (seen.has(key)) throw new YamlSubsetError('duplicate key ' + JSON.stringify(key), line.number)
    seen.add(key)
    if (first === undefined) consume(state)
    else first = undefined
    if (split.rest === '') {
      const next = peek(state)
      map[key] = next !== undefined && next.indent > indent ? parseNode(state, next.indent) : null
    } else if (isBlockScalarIndicator(split.rest)) {
      map[key] = readBlockScalar(state, indent, split.rest)
    } else {
      map[key] = parseScalar(split.rest, line.number)
    }
    line = peek(state)
  }
  if (line !== undefined && line.indent > indent) throw new YamlSubsetError('unexpected indentation in a mapping', line.number)
  return map
}

/**
 * Split one mapping line into its key and its value text.
 *
 * The colon that separates them is the first one outside quotes followed by a
 * space (or end of line), so a quoted key and a value that itself contains
 * colons both survive.
 * @param {string} content the line content
 * @returns {{key: string, rest: string} | null} the split, or null when there is no separator
 */
function splitKey(content) {
  let quote = null
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ':' && (index + 1 === content.length || content[index + 1] === ' ')) {
      return { key: content.slice(0, index).trim(), rest: content.slice(index + 1).trim() }
    }
  }
  return null
}

/**
 * Strip the quotes from a key or a single-line scalar.
 * @param {string} text the quoted or plain text
 * @returns {string} the unquoted text
 */
function unquote(text) {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\')
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'")
  return text
}

/**
 * Parse one scalar, including a custom tag.
 * @param {string} text the value text
 * @param {number} lineNumber the source line (for diagnostics)
 * @returns {unknown} the value; a custom tag becomes { __tag, value }
 */
function parseScalar(text, lineNumber) {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('!!')) {
    const space = trimmed.indexOf(' ')
    const tag = space === -1 ? trimmed.slice(2) : trimmed.slice(2, space)
    const payload = space === -1 ? '' : trimmed.slice(space + 1).trim()
    // Captured, never evaluated: this is where an upstream preset would
    // otherwise be able to run code inside the check.
    return { __tag: tag, value: payload === '' ? null : scalarValue(payload, lineNumber) }
  }
  return scalarValue(trimmed, lineNumber)
}

/**
 * The value of one untagged scalar.
 * @param {string} text the text
 * @param {number} lineNumber the source line
 * @returns {unknown} the value
 */
function scalarValue(text, lineNumber) {
  const body = stripCommentOutsideQuotes(text)
  if (body === '') return null
  if (body.startsWith('"')) {
    if (!body.endsWith('"') || body.length < 2) throw new YamlSubsetError('unterminated double-quoted scalar', lineNumber)
    return unquote(body)
  }
  if (body.startsWith("'")) {
    if (!body.endsWith("'") || body.length < 2) throw new YamlSubsetError('unterminated single-quoted scalar', lineNumber)
    return unquote(body)
  }
  const plain = stripComment(body)
  if (TRUE_WORDS.has(plain)) return true
  if (FALSE_WORDS.has(plain)) return false
  if (NULL_WORDS.has(plain)) return null
  if (/^-?\d+$/u.test(plain)) return Number(plain)
  if (/^-?\d+\.\d+$/u.test(plain)) return Number(plain)
  return plain
}

/**
 * Drop a trailing comment that sits OUTSIDE quotes.
 *
 * A quoted scalar may carry a comment after it (`a: "v" # note`), and a value
 * that is only a comment is null (`a: # note`) — both are inside the supported
 * dialect, so both must parse instead of erroring or keeping the '#' text.
 * A '#' inside quotes stays content.
 * @param {string} text the value text
 * @returns {string} the text without its comment
 */
function stripCommentOutsideQuotes(text) {
  if (text.startsWith('#')) return ''
  let quote = null
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '#' && index > 0 && text[index - 1] === ' ') return text.slice(0, index).trimEnd()
  }
  return text
}

/**
 * Drop a trailing comment from a plain scalar.
 * @param {string} text the plain text
 * @returns {string} the text without its comment
 */
function stripComment(text) {
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === '#' && text[index - 1] === ' ') return text.slice(0, index).trim()
  }
  return text
}

/**
 * Read one block scalar (| literal, > folded) at the cursor.
 * @param {{lines: string[], index: number}} state the reader cursor
 * @param {number} parentIndent the indentation of the key that introduced it
 * @param {string} indicator the indicator, with its chomping sign
 * @returns {string} the scalar text
 */
function readBlockScalar(state, parentIndent, indicator) {
  const style = indicator[0]
  const chomp = indicator.slice(1)
  const collected = []
  let bodyIndent
  while (state.index < state.lines.length) {
    const raw = state.lines[state.index]
    if (raw.trim() === '') {
      collected.push('')
      state.index += 1
      continue
    }
    const lineIndent = raw.length - raw.trimStart().length
    if (lineIndent <= parentIndent) break
    if (bodyIndent === undefined) bodyIndent = lineIndent
    collected.push(lineIndent >= bodyIndent ? raw.slice(bodyIndent) : raw.trim())
    state.index += 1
  }
  let trailing = 0
  while (collected.length > 0 && collected[collected.length - 1] === '') {
    collected.pop()
    trailing += 1
  }
  let text
  if (style === '|') {
    text = collected.join('\n')
  } else {
    const paragraphs = []
    let run = []
    for (const entry of collected) {
      if (entry === '') {
        if (run.length > 0) paragraphs.push(run.join(' '))
        run = []
        paragraphs.push('')
        continue
      }
      run.push(entry)
    }
    if (run.length > 0) paragraphs.push(run.join(' '))
    text = paragraphs.join('\n')
  }
  if (chomp === '-') return text
  if (chomp === '+') return text + '\n'.repeat(trailing + 1)
  return text === '' ? '' : text + '\n'
}
