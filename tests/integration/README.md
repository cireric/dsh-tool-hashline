# Host-contract integration tests

These tests sit at the repository root because they exercise **host** contracts
shared with a deployment, not one package's internals. They run with
`pnpm test:integration` (the same tier as `packages/*/tests/integration`).

## `persona-scope-contract.spec.ts`

Pins the `SystemPrompt` scope/waterfall semantics that made the old de-brand
plugin erase the preset persona:

- an `assemble` listener that rewrites text keeps the persona;
- a nearer scope registering the same `deployment:persona-prefix` name shadows
  the preset persona for that scope only.

No deployment plugin is loaded here, so this stays true regardless of which
de-brand implementation is installed.

## `persona-preservation.spec.ts`

Runs the **real** de-brand plugin against a real prompt registry, scope chain,
prompt-variable interpolation and assembly waterfall, with the shipped persona
from `presets/ptc-hashline/personas/orchestrator.md`.

The plugin directory is resolved from `HIDE_HARNESS_IDENTITY_PATH`, defaulting
to the sibling deployment path `../../default/plugins/hide-harness-identity`.
When neither exists the suite is **skipped** (reported, not silently green).

To run it against the in-repo candidate copy while the deployment is not yet
updated:

```powershell
$env:HIDE_HARNESS_IDENTITY_PATH='tests/fixtures/hide-harness-identity'
pnpm test:integration
```

The matrix covers: existing agent, `agent/created`, full expected-text
comparison, a no-brand multi-section persona, child scope, repeated assembly +
`refreshContext`, unmount/remount, the `text`/`complete` migration diagnostic,
and the `complete: true` branch (preserved verbatim but NOT de-branded — a
documented limit, see `docs/acceptance/2026-10-23-runtime-fix-acceptance.md`).

## `edit-policy-topology.spec.ts` / `edit-policy-harness.ts`

The policy question ("does the editor's `fs/edit-intent` decision actually reach
the provider?") cannot be answered on a flattened context: the shipped preset
mounts its tool rows in an agent scope while `fs` and `fs-observation-policy`
stay on the host plane. `edit-policy-harness.ts` reproduces that relationship
with a real `createScope` scope for the agent, the real registry on the root, the
real policy plugin and the real upstream editor, and exposes the intent edge
(`fs.writeText` arguments), the `fs/observed` order and a deterministic
competing write. It never occupies the single-slot `fs/*-intent` decision.

The topology spec asserts the relationship itself: the preset scope is a real
scope key, the preset's `fs` realm label equals the host's, the intent listeners
are host-plane, and — parsed from `presets/ptc-hashline/preset.patch.yml` — the
preset isolates `planMode`, `compaction`, `toolResultPruner` and
`workflowEngine` only, never `fs` or `tools`.

## `edit-policy-composition.spec.ts`

POL-01..06: the same assertions run in **both** edit modes (hashline `input` and
replace `file_path`/`old_string`/`new_string`), because the two prepare the write
on different paths. Covers the versioned intent for a self-authorised rewrite,
the no-policy control, a write that lands between the read and the guarded
commit, the same race with no policy mounted (the competitor really is written —
the injection is driven by the test option, never by the condition under test),
`createIfAbsent` for an MV to a new nested target, and the stock `write`
read-first control.

Upstream replace retries once after a stale-version rejection, so its
model-facing error is the retry's match failure while hashline reports
`FS_STALE_VERSION`; the tests assert the real contract per mode instead of
pretending they behave alike.

## `extract-runtime-evidence.spec.ts`

Exercises `scripts/extract-runtime-evidence.mjs` as a child process and as a
direct import. Every way the input can fall short of evidence is pinned: missing
same-turn carrier, cross-turn carrier (an earlier turn's `Intent` must never
support a later one), start without settle, a refusal that settles without a
start, a seq gap with no bounds given, inverted/negative/non-integer bounds
(both CLI and the exported function), a torn zstd frame, an unparsable record,
and a source whose header names another session. Each of those must produce
INCOMPLETE or a refusal — never a pass.
