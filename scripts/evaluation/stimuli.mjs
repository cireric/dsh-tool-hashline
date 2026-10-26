/** Explicit evaluator-owned external writes; never model-authored execution. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const deviceName = name => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)
export const safeTaskPath = name => typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.startsWith('/') && !/[<>:"|?*\u0000-\u001F]/u.test(name) && name.split('/').every(p => p && p !== '.' && p !== '..' && !/[. ]$/u.test(p) && !deviceName(p))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function taskEvaluationGaps(task) {
  const gaps = []
  for (const field of ['targets', 'stimuli']) if (task[field] !== undefined && !Array.isArray(task[field])) gaps.push(field + ' must be an array')
  if (Array.isArray(task.targets)) {
    const ids = new Set(), files = new Set()
    for (const target of task.targets) {
      if (!target || typeof target.id !== 'string' || !target.id.trim() || ids.has(target.id)) gaps.push('targets require distinct non-empty ids')
      ids.add(target?.id)
      if (!safeTaskPath(target?.path) || files.has(target.path.toLowerCase())) gaps.push('targets require distinct safe files; one goal per file')
      else files.add(target.path.toLowerCase())
      if (typeof target?.goal !== 'string' || !target.goal.trim()) gaps.push('target.goal is required')
      if (!['known-applicable', 'declared-exception', 'no-change-needed', 'applicability-unknown'].includes(target?.class)) gaps.push('target.class is required')
      if (target && !(Object.hasOwn(task.initial ?? {}, target.path) || Object.hasOwn(task.expected ?? {}, target.path))) gaps.push('target.path must name a frozen file')
    }
    for (const [file, expected] of Object.entries(task.expected ?? {})) {
      if (expected !== task.initial?.[file] && !task.targets.some(t => t?.path === file)) gaps.push('targets must cover every expected file change')
    }
  }
  if (Array.isArray(task.stimuli)) {
    const ids = new Set()
    for (const stimulus of task.stimuli) {
      if (!stimulus || typeof stimulus.id !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(stimulus.id) || deviceName(stimulus.id) || ids.has(stimulus.id)) gaps.push('stimuli require distinct safe ids')
      ids.add(stimulus?.id)
      if (!safeTaskPath(stimulus?.path) || !Object.hasOwn(task.initial ?? {}, stimulus.path)) gaps.push('stimulus.path must name an initial file')
      if (!Number.isSafeInteger(stimulus?.afterRead) || stimulus.afterRead < 1) gaps.push('stimulus.afterRead must be positive')
      if (typeof stimulus?.before !== 'string' || typeof stimulus?.after !== 'string') gaps.push('stimulus.before/after must be UTF-8 strings')
    }
  }
  return gaps
}

export function createStimulusController(task, cwd, evidenceDirectory) {
  const records = [], counts = new Map()
  return {
    records,
    read(file, trigger) {
      const nth = (counts.get(file) ?? 0) + 1
      counts.set(file, nth)
      for (const stimulus of task.stimuli ?? []) {
        if (stimulus.path !== file || stimulus.afterRead !== nth) continue
        const record = { id: stimulus.id, path: file, trigger: { ...trigger, readNumber: nth }, status: 'unknown' }
        records.push(record)
        try {
          // Reject links at every component, including the fixture root.
          let current = cwd
          if (fs.lstatSync(current).isSymbolicLink()) throw new Error('linked root')
          for (const part of file.split('/')) { current = path.join(current, part); if (fs.lstatSync(current).isSymbolicLink()) throw new Error('linked file') }
          const before = fs.readFileSync(current)
          record.beforeHash = sha256(before)
          if (!before.equals(Buffer.from(stimulus.before))) { record.status = 'condition-mismatch'; continue }
          fs.mkdirSync(evidenceDirectory, { recursive: true })
          fs.writeFileSync(path.join(evidenceDirectory, stimulus.id + '.before'), before, { flag: 'wx' })
          fs.writeFileSync(current, stimulus.after)
          const after = fs.readFileSync(current)
          record.afterHash = sha256(after)
          fs.writeFileSync(path.join(evidenceDirectory, stimulus.id + '.after'), after, { flag: 'wx' })
          record.status = after.equals(Buffer.from(stimulus.after)) ? 'applied' : 'write-mismatch'
        } catch { record.status = 'failed-or-partial' }
      }
    },
  }
}

export function stimulusSummary(task, records) {
  const expected = task.stimuli ?? []
  const complete = expected.length === records.length && expected.every(s => records.filter(r => r.id === s.id && r.path === s.path && r.status === 'applied' && r.trigger?.readNumber === s.afterRead && r.beforeHash === sha256(Buffer.from(s.before)) && r.afterHash === sha256(Buffer.from(s.after))).length === 1)
  return { status: complete ? 'PASS' : 'GAP', planned: expected.length, records }
}
