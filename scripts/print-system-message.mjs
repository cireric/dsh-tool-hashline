#!/usr/bin/env node
/**
 * Print the first recorded system prompt of one DSH session.
 *
 * The session log is multi-frame zstd; a single zstdDecompressSync call returns
 * only the first frame, so this walks the frame magic and concatenates them.
 *
 * Usage:
 *   node scripts/print-system-message.mjs <session-id | session-dir | .zstd path>
 *   node scripts/print-system-message.mjs --list
 *
 * Reads $DSH_HOME (default ~/.dsh) and searches sessions/<workspace>/<id>.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const args = process.argv.slice(2)
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const sessionsRoot = join(dshHome, 'sessions')

if (args[0] === '--list') {
  for (const workspace of readdirSync(sessionsRoot)) {
    const dir = join(sessionsRoot, workspace)
    for (const entry of readdirSync(dir)) {
      const log = join(dir, entry, 'session.v4.jsonl.zstd')
      try {
        if (statSync(log).isFile()) console.log(entry, '\t', workspace)
      } catch {}
    }
  }
  process.exit(0)
}

const input = args[0]
if (!input) {
  console.error('usage: node scripts/print-system-message.mjs <session-id | session-dir | .zstd path> [--list]')
  process.exit(2)
}

function findLog(value) {
  if (value.endsWith('.zstd')) return resolve(value)
  if (statSync(value, { throwIfNoEntry: false })?.isDirectory()) return join(value, 'session.v4.jsonl.zstd')
  for (const workspace of readdirSync(sessionsRoot)) {
    const candidate = join(sessionsRoot, workspace, value, 'session.v4.jsonl.zstd')
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate
  }
  throw new Error('session log not found for ' + value)
}

const file = findLog(input)
const buf = readFileSync(file)
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf.compare(magic, 0, 4, i, i + 4) === 0) offsets.push(i)
}
let text = ''
for (let k = 0; k < offsets.length; k++) {
  const end = k + 1 < offsets.length ? offsets[k + 1] : buf.length
  try { text += zstdDecompressSync(buf.subarray(offsets[k], end)).toString('utf8') } catch {}
}

for (const line of text.split('\n')) {
  if (!line.trim()) continue
  const event = JSON.parse(line)
  if (event.type === 'session') {
    console.log('# session:', event.id)
    console.log('# cwd:', event.cwd)
  }
  if (event.type === 'system/message') {
    console.log('# first system/message:')
    console.log(event.data.message.content.map(block => block.text ?? '').join('\n'))
    process.exit(0)
  }
}
console.error('no system/message event found in', file)
process.exit(1)
