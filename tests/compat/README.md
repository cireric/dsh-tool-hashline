# Compatibility matrix

`pnpm test:compat` pins the upstream engine's guard and lifecycle behavior for
the currently installed versions. Run it before every upgrade of
`@hy-sde-org/dsh-hashline` / `@hy-sde-org/dsh-tool-edit` and before switching a
daily profile.

| DSH | engine (`dsh-hashline` / `dsh-tool-edit`) | status | notes |
|---|---|---|---|
| 0.2.1-rc.2 | 0.2.1-alpha.4 | target | initial development; 15 compat cases green |
| next rc/minor | same pinned alpha | todo | run this gate first, then update the table |

The authoritative contract is [requirements v3 §8.1](../../docs/spec/2026-10-22-ptc-hashline-需求规格.md).

## What the suite pins (`guard.spec.ts`, real `ToolRuntime` + upstream `edit`)

| Case | Assertion |
|---|---|
| Seen union | read 1–50 then 400–450 → editing line 3 and line 420 both succeed; store holds 101 seen lines |
| Continuous editing | the edit response's `[path#TAG]` header is the new tag, and a second edit with it lands |
| Store keys | relative input key and absolute show-path key both hold the snapshot; one `readText`; edit through show path works |
| Symlink alias | when the platform permits symlinks, alias and target keys both hold the tag and the edit lands |
| Recovery (own snapshots) | a stale tag from this session's prior edit applies with `Recovered from a stale file hash` |
| Recovery bypasses seen | a never-displayed anchor applies through recovery to the post-edit snapshot |
| Mismatch | external change rejects with the independently computed current tag and English re-read guidance |
| Mismatch retry | the rejected edit's current tag applies on retry (mismatch snapshot has no seen provenance) |
| Head/tail drift | `PUT >$:` with a stale tag applies with the drift warning instead of rejecting |
| Bounded reveal | ≤40 unseen anchor lines are echoed and the identical retry succeeds; a wider reveal is truncated and the retry is still rejected |
| Cross-session | another session edits with a tag minted here (silent guard skip — known permissive) |
| Eviction | a path evicted from the bounded store loses its guard; the edit applies |
| REM | deletes the file without a line anchor and without consuming the seen guard |
| Engine identity | `tests/unit/engine-identity.spec.ts` — one physical hashline module for read and edit |

Not exercised here: `PUT N*` block edits (the app chain wires no tree-sitter
`blockResolver`, so block spans are unavailable); `FR-7`'s block boundary is
therefore reported as an unexecuted gap rather than a pass. Error-reveal column
truncation (>512 chars per revealed line) is engine-internal and not driven by
the read tool; the 40-line reveal cap above is the app-level proxy.

Known permissive paths are asserted as such; they are not "strict guard" passes.
