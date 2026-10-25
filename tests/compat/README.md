# Compatibility matrix

`pnpm test:compat` pins the upstream engine's guard and lifecycle behavior for
the currently installed versions. Run it before every upgrade of
`@hy-sde-org/dsh-hashline` / `@hy-sde-org/dsh-tool-edit` and before switching a
daily profile.

| DSH | engine (`dsh-hashline` / `dsh-tool-edit`) | status | notes |
|---|---|---|---|
| 0.2.1-rc.2 | 0.2.1-alpha.4 **+ two local patches** | target | 21 compat cases green; both packages are patched (ADR-0003 effective directory, ADR-0004 MV create intent + snapshot order, plus the BOM-preserving hashline read, the MV DEST/commit wording and the truthful snapshot-commit error) |
| next rc/minor | same pinned alpha + patches (or upstream fix) | todo | run this gate first, then update the table |

## Baseline: original version + two local patches

Both engine packages are installed through `pnpm patchedDependencies`:

- `patches/@hy-sde-org__dsh-tool-edit@0.2.1-alpha.4.patch` — `toolCwdFromExec` reads the
  host `workingDirectory` service instead of the non-existent `session.cwd`; both endpoints
  of `MV` are confined to the session directory; the `MV` target is created through
  `fs/write-intent` + `createIfAbsent` (never `fs/edit-intent`), and a target that landed
  without its source being removed is reported as a partial move (ADR-0004). It also adds
  the hashline adapter's BOM-preserving read (`FileReader.readTextPreservingBom`: one extra
  three-byte prefix read plus a closing `stat`/version check; consecutive leading BOMs are
  refused before any write), and rewrites the model-facing text so the `MV` DEST basis and
  the non-atomic commit are stated instead of an unconditional "applies atomically".
- `patches/@hy-sde-org__dsh-hashline@0.2.1-alpha.4.patch` — `Patcher.commit` moves the file
  first and only then relocates/records the snapshot, so a rejected or failing move cannot
  migrate state that never moved (ADR-0004). Its `SnapshotCommitError` text states only facts
  that hold at both failure points (disk moved, bookkeeping incomplete, state may be
  partial, re-read the destination) and never claims which side of the store survived.

On every upgrade:

1. Check whether the new upstream already fixes all of these points. If yes, delete the
   patch and its `patchedDependencies` entry; if no, redo the patch for the new
   version (never edit `node_modules` by hand).
2. `pnpm install` — the lockfile's `patch_hash` must change/refresh.
3. Run `pnpm test:compat` **and** the real-Session matrix
   (`packages/tool-read/tests/integration/working-directory.spec.ts` and
   `.../mv-observation.spec.ts`, part of `pnpm test:integration`). The compat suite
   alone uses a fabricated Agent and cannot see the cwd, MV or BOM regressions.

The authoritative contract is [requirements v3 §8.1](../../docs/spec/2026-10-22-ptc-hashline-requirements-spec.md).

### Default-edit policy module paths and guidance

The tool-edit patch also loads the optional default-edit policy. It recognizes
native absolute paths with Node's `isAbsolute` **before** testing URL schemes,
then converts filesystem paths with `pathToFileURL`. Windows drive/UNC paths,
POSIX paths on macOS/Linux and existing `file:` URLs must retain their native
semantics; do not replace this with manual slash/URL escaping.

`tests/integration/default-edit-policy-module-address.spec.ts` exercises actual
native absolute/relative paths and file URLs, including spaces, Unicode, `#` and
`%`, through the real editor on each running OS. Missing modules stay fail closed.
The Windows/macOS/Linux CI matrix in `.github/workflows/policy-contract.yml`
runs these cases and the managed read/PTC contracts. Matrix configuration alone
is not evidence that a particular OS run passed.

The read option `defaultEditPolicyGuidance` defaults to false; only the managed
preset enables it. Preserve the unconfigured read's original guidance when
updating dependencies or policy integration. The real read contract is covered
by `packages/tool-read/tests/integration/policy-guidance.spec.ts`.

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
| Snapshot commit fault | a failing `relocate` after a successful move reports `SnapshotCommitError` naming both paths, the incomplete bookkeeping, the possibly-partial state and a re-read of the destination; the file stays at the destination, is not moved back, and this failure point leaves the source snapshot un-migrated |
| Commit waits for the move (SNAP-R1) | while the move is parked on a barrier nothing is relocated or recorded and the commit has not settled; releasing it logs `move:start` → `move:finish` → `relocate` → `record(destination)` and the same promise then RESOLVES (the observer no longer swallows the outcome) |
| Record fails after a real relocate (SNAP-R2) | the disk move and the relocation land, the destination keeps the pre-edit version, the error is a named `SnapshotCommitError` with its `cause`, and the message neither denies the move nor claims the source snapshot never migrated |

The wording assertions are semantic (disk moved / bookkeeping incomplete / may be
partial / re-read the destination / cause preserved), not a fixed sentence, so a
future rewrite cannot pass by changing its mind about the state.

The adapter ships no syntactic block resolver. The tool-edit patch represents
that absence explicitly, so `PUT N*:` / `CUT N*` report unavailable rather than
blaming the language or input. `tests/integration/hashline-block-capability.spec.ts`
checks the actual tool description, JS/TS/Python/Markdown refusal with no writes,
explicit replacement/cut, after-block insertion/register-paste lowering, and
multi-section refusal before any section writes. These cases do not claim to
implement or validate AST block resolution. Earlier acceptance reports' unrun
block cases remain historical gaps. The three-OS policy workflow includes this
suite; configuration alone does not establish an OS pass.

Error-reveal column truncation (>512 chars per revealed line) is engine-internal
and not driven by the read tool; the 40-line reveal cap above is the app-level proxy.

Known permissive paths are asserted as such; they are not "strict guard" passes.

The tool- and PTC-level proofs of the same snapshot fault live outside this suite
(`SNAP-R3` in `packages/tool-read/tests/integration/mv-observation.spec.ts` and
`tests/ptc/mv-policy.spec.ts`): they inject one `record` failure on the real
per-session store's destination key and check the facts both inside the tool result
and outside the program.
