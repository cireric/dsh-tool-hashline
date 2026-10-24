/**
 * Session-artifact decoding for the operations skills.
 *
 * This module is the ONE place that knows the on-disk session format: it walks
 * structurally complete Zstandard frames, decodes them into JSONL, and parses
 * one record per line without ever dropping a bad one. The repository's
 * `scripts/extract-runtime-evidence.mjs` re-exports these functions, so the
 * offline extractor and the shipped operations skills cannot drift apart.
 *
 * It ships inside the bundle (`presets/ptc-hashline/operations/`) and imports
 * only Node builtins: a packed install must be able to decode a log with no
 * checkout, no `.scratch` and no root `scripts/` beside it.
 *
 * WHY THIS IS NOT A FORK (AGENTS.md forbids copying upstream/DSH source): the
 * host's scanner lives in `@deepseek-ai/dsh-session-persistence-jsonl`, which
 * this bundle must not depend on at runtime — a packed install carries only
 * Node builtins, and the host package is a peer of the DSH process, not of a
 * skill asset. The algorithms below (`scanZstdFrames`, `encodeSegment`,
 * `projectKey`) therefore restate the documented FORMAT CONTRACT (RFC 8878
 * frame layout; the host's `~XXXX` path-segment escape) rather than importing
 * implementation. They are pinned against the host's own encoding by
 * `operations-context.spec.ts`, so a host change surfaces as a failing test
 * instead of a silent divergence. If the host ever publishes these helpers as
 * a runtime contract, this module must import them and delete the restatement.
 * @module dsh-tool-hashline/presets/ptc-hashline/operations/session-log
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Zstandard frame magic, little-endian `0xFD2FB528`. */
const ZSTD_MAGIC = 0xFD2FB528

/** A generation file name: `session.v<N>.jsonl` optionally `.zstd`. */
const GENERATION_FILE = /^session\.v(\d+)\.jsonl(\.zstd)?$/u

/**
 * Locate structurally complete Zstandard frames without decompressing them.
 * EOF inside the final frame returns its start so the caller can report it as
 * torn instead of half-decoding it.
 * @param {Buffer} buffer bytes present in the artifact
 * @returns {{frames: {start: number, end: number}[], tornStart?: number}}
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error('invalid Zstandard frame magic at byte ' + offset)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) throw new Error('reserved frame-header bit at byte ' + (offset - 1))
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerRest = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerRest) return { frames, tornStart: start }
    offset += headerRest
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) throw new Error('reserved block type at byte ' + (offset - 3))
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * Decode an artifact into JSONL text. Complete frames only; a torn frame is
 * reported instead of being half-decoded (a half frame is not evidence).
 * @param {Buffer} buffer artifact bytes
 * @returns {{format: string, text: string, frames: number, tornStart?: number}}
 */
export function decodeArtifact(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).readUInt32LE(0) === ZSTD_MAGIC) {
    const scan = scanZstdFrames(buffer)
    const parts = scan.frames.map(frame => zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
    return {
      format: 'jsonl.v4.zstd',
      text: Buffer.concat(parts).toString('utf8'),
      frames: scan.frames.length,
      ...scan.tornStart === undefined ? {} : { tornStart: scan.tornStart },
    }
  }
  return { format: 'jsonl.v4', text: buffer.toString('utf8'), frames: 0 }
}

/**
 * Parse one record per line; a bad line is a reported failure, not a skip.
 * @param {string} text decoded JSONL
 * @returns {{records: Record<string, unknown>[], failures: {line: number, message: string}[]}}
 */
export function parseRecords(text) {
  const records = []
  const failures = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    try {
      records.push(JSON.parse(line))
    } catch (error) {
      failures.push({ line: index + 1, message: error instanceof Error ? error.message : String(error) })
    }
  })
  return { records, failures }
}

/**
 * Encode one string as a single safe path segment, mirroring the host's
 * `encodeSegment`: safe code units stay literal and everything else becomes
 * `~XXXX`. Operating on code units preserves lone surrogates.
 * @param {string} raw the segment to encode
 * @returns {string} a filesystem-safe segment
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character !== '~' && /^[A-Za-z0-9._-]$/u.test(character)) out += character
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * Build the human-readable project directory key for one workspace path,
 * mirroring the host's `projectKey`: separators collapse to `-` and unsafe
 * code units use the same `~XXXX` escape.
 * @param {string} cwd the session's project directory
 * @returns {string} the project directory name under the sessions root
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index)
    const character = String.fromCharCode(code)
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (character !== '~' && /^[A-Za-z0-9._-]$/u.test(character)) {
      readable += character
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/u, '') || 'root'
  return '--' + slug.slice(0, 251) + '--'
}

/**
 * The exact session directory for one session id and workspace.
 *
 * This is a pure path computation on purpose: locating a session must not
 * enumerate the sessions root, so a wrong workspace fails closed instead of
 * silently finding somebody else's log.
 * @param {string} sessionsRoot the host's sessions root
 * @param {string} cwd the session's workspace directory
 * @param {string} sessionId the session identity
 * @returns {string} the session's own directory
 */
export function sessionDirectory(sessionsRoot, cwd, sessionId) {
  return join(sessionsRoot, projectKey(cwd), encodeSegment(sessionId))
}

/**
 * Read one session artifact and decode it.
 *
 * The session's OWN directory is listed (never the sessions root) to pick the
 * highest physical generation, so a format change surfaces as
 * `unsupported-generation` instead of a silent miss.
 * @param {object} options
 * @param {string} options.sessionsRoot host sessions root
 * @param {string} options.cwd the session's workspace directory
 * @param {string} options.sessionId session identity
 * @returns {Promise<object>} the decoded artifact plus its location facts
 */
export async function readSessionArtifact(options) {
  const directory = sessionDirectory(options.sessionsRoot, options.cwd, options.sessionId)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    return {
      status: 'missing',
      directory,
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  const candidates = entries
    .filter(entry => entry.isFile())
    .map(entry => ({ name: entry.name, match: GENERATION_FILE.exec(entry.name) }))
    .filter(entry => entry.match !== null)
    .map(entry => ({ name: entry.name, version: Number(entry.match[1]), compressed: entry.match[2] !== undefined }))
    .sort((left, right) => right.version - left.version)
  if (candidates.length === 0) {
    return {
      status: 'unsupported-generation',
      directory,
      detail: 'no session.v<N>.jsonl[.zstd] artifact in the session directory',
      entries: entries.map(entry => entry.name),
    }
  }
  const chosen = candidates[0]
  const path = join(directory, chosen.name)
  const buffer = await readFile(path)
  const decoded = decodeArtifact(buffer)
  const parsed = parseRecords(decoded.text)
  return {
    status: 'read',
    directory,
    path,
    generation: chosen.version,
    compressed: chosen.compressed,
    bytes: buffer.length,
    format: decoded.format,
    frames: decoded.frames,
    ...decoded.tornStart === undefined ? {} : { tornStart: decoded.tornStart },
    text: decoded.text,
    records: parsed.records,
    failures: parsed.failures,
    buffer,
  }
}
