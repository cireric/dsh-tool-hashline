/** Cross-check stream admission against captured session-owned request records. */
export function requestAccounting(report) {
  const expected = new Map(), observed = new Map(), gaps = []
  for (const run of report.runs) {
    if (!run.sessionId) continue
    const sessions = run.trace?.sessions ?? [{ id: run.sessionId, costs: run.trace?.costs }]
    for (const session of sessions) {
      if (expected.has(session.id)) gaps.push('session counted in multiple runs: ' + session.id)
      if (!Number.isSafeInteger(session.costs?.modelRequests)) gaps.push('unknown captured request count: ' + session.id)
      expected.set(session.id, session.costs?.modelRequests)
    }
  }
  for (const request of report.requests ?? []) {
    if (typeof request.sessionId !== 'string' || !expected.has(request.sessionId)) gaps.push('stream without captured owner')
    observed.set(request.sessionId, (observed.get(request.sessionId) ?? 0) + 1)
  }
  for (const [id, count] of expected) if (count !== (observed.get(id) ?? 0)) gaps.push('stream/session request count mismatch: ' + id)
  if (report.requestRefusals?.length) gaps.push('request attempted outside active capture')
  return { status: gaps.length ? 'GAP' : 'PASS', streamRequests: report.requests?.length ?? 0, capturedRequests: [...expected.values()].every(Number.isSafeInteger) ? [...expected.values()].reduce((n, value) => n + value, 0) : 'unknown', gaps }
}
