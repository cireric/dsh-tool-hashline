# Compatibility matrix

`pnpm test:compat` pins the upstream engine's guard and lifecycle behavior for
the currently installed versions. Run it before every upgrade of
`@hy-sde-org/dsh-hashline` / `@hy-sde-org/dsh-tool-edit` and before switching a
daily profile.

| DSH | engine (`dsh-hashline` / `dsh-tool-edit`) | status | notes |
|---|---|---|---|
| 0.2.1-rc.2 | 0.2.1-alpha.4 **+ two local patches** | target | 17 compat cases green; both packages are patched (ADR-0003 effective directory, ADR-0004 MV create intent + snapshot order) |
| next rc/minor | same pinned alpha + patches (or upstream fix) | todo | run this gate first, then update the table |

## Baseline: original version + two local patches

Both engine packages are installed through `pnpm patchedDependencies`:

- `patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch` — `toolCwdFromExec` reads the
  host `workingDirectory` service instead of the non-existent `session.cwd`; both endpoints
  of `MV` are confined to the session directory; the `MV` target is created through
  `fs/write-intent` + `createIfAbsent` (never `fs/edit-intent`), and a target that landed
  without its source being removed is reported as a partial move (ADR-0004).
- `patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch` — `Patcher.commit` moves the file
  first and only then relocates/records the snapshot, so a rejected or failing move cannot
  migrate state that never moved (ADR-0004).

On every upgrade:

1. Check whether the new upstream already fixes all of these points. If yes, delete the
   patch and its `patchedDependencies` entry; if no, redo the patch for the new
   version (never edit `node_modules` by hand).
2. `pnpm install` — the lockfile's `patch_hash` must change/refresh.
3. Run `pnpm test:compat` **and** the real-Session directory matrix
   (`packages/tool-read/tests/integration/working-directory.spec.ts`, part of
   `pnpm test:integration`). The compat suite alone uses a fabricated Agent and
   cannot see the cwd regression.

The authoritative contract is [requirements v3 §8.1](../../docs/spec/2026-10-22-ptc-hashline-requirements-spec.md).

## What the suite pins (`guard.spec.ts` + `mv-snapshot-order.spec.ts`)

`guard.spec.ts` runs a real `ToolRuntime` over the upstream `edit` and the upstream store.

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

`mv-snapshot-order.spec.ts` drives the upstream `Patcher` over the upstream in-memory
filesystem and store, so it pins the engine commit contract without a host:

| Case | Assertion |
|---|---|
| Failed move | a throwing `fs.move` leaves the source snapshot's text/hash/seen exactly as before the commit and creates no destination snapshot; the in-memory disk is unchanged |
| Snapshot order | a successful move logs `move` → `relocate` → `record(destination)`; the source snapshot is gone and the destination snapshot has the source's text and seen lines |
| Snapshot commit fault | a failing `relocate` after a successful move reports `SnapshotCommitError` ("moved on disk … was not committed … must not be used in its place"), leaves the file at the destination, does not move it back, and leaves the source snapshot un-migrated |

Not exercised: `PUT N*` block edits. The app chain wires no tree-sitter
`blockResolver`; an attempt to pin the no-resolver failure hung the suite, so this
stays an unexecuted gap (reported as such in the acceptance trace), not a pass. Error-reveal column
truncation (>512 chars per revealed line) is engine-internal and not driven by
the read tool; the 40-line reveal cap above is the app-level proxy.

Known permissive paths are asserted as such; they are not "strict guard" passes.
