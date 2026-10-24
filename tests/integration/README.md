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

## The operations skills (invocation, baseline, incidents, upgrade assessment)

The suites below cover the two user-invoked operations skills. Their claim boundary is
stated once here: they mount the shipped SKILL ROWS through the real
`@deepseek-ai/dsh-agent-preset-registry`, which composes an EntryTree through
the real `@deepseek-ai/cordis-plugin-loader` under a real `createScope`
revision scope, against the real `@deepseek-ai/dsh-skill` registry and
`@deepseek-ai/dsh-skill-filesystem` provider. The FULL preset tree (persona,
watchdog, tools, presentation) is not mounted here; that assembly is the
delivery-acceptance ticket. Nothing in these suites is a flattened fixture
standing in for the registry.

- `operations-skills.spec.ts` — SCOPE-01/02/03/07. Discovery, user-only
  invocation, the model-facing `skill` tool's exact refusal, host-plane
  invisibility, two interleaved revisions, disposal and re-mount, and duplicate
  provider-name rejection. The provider's skill root is EVALUATED with the
  loader's own `baseUrl` binding, not substring-matched.
- `operations-context.spec.ts` — SCOPE-04/05. The preset projection replayed
  from the header initial value plus later selection events; the `ptc` family
  marker, a hand-typed `--preset` and a sibling session's projection all fail
  to authorize; no filesystem or network side effect on a refusal.
- `operations-config.spec.ts` — CONFIG-01. One maintenance repository and one
  evidence directory saved once, reused across business cwds, absolute-path
  refusal, malformed configuration surfaced, and per-role usability so an
  unusable evidence directory does not stop read-only analysis.
- `operations-baseline.spec.ts` — the running combination as actually
  resolved: versions, resolved paths, physical engine realpaths, patch evidence
  read from the RESOLVED build (never from a version number), and the
  maintenance worktree's commit/dirty/input digests.
- `operations-cli.spec.ts` — the CLI contract the skill bodies call: exit
  codes, host-managed environment facts, and baseline output that names every
  gap instead of guessing.
- `operations-incidents.spec.ts` — INC-01..06: incident evidence from one
  explicit session and seq range. An inner edit failure is preserved even
  when the program caught it and the outer `run_code` succeeded; kind and
  severity stay separate axes; a user-reported mismatch never fabricates
  `isError`; torn frames, seq gaps, duplicate seqs and a start without a
  settle all report `incomplete`; secrets in arguments, first lines and
  paths never reach an exported file; and only suspected anomalies are
  auto-registered as `needs-triage` issues (expected refusals and
  cancellations stay in the summary).
- `operations-recurrence.spec.ts` — INC-07 and SCOPE-06's analysis branch. A second
  occurrence of the SAME class — same kind, same tool, same normalised first
  line — appends exactly ONE record to the existing ticket and never rewrites
  its `Status` or its older evidence (the older bytes remain a verbatim
  prefix); a different class, or the same text from a different tool, still
  opens its own ticket; re-analysing the same session and range is the same
  occurrence — even after the log grew — and appends nothing, while a wider
  range that now holds the retry success appends only that recovery record;
  the cited seq is the retry's SETTLE seq. A ticket checked out with CRLF still
  links (the metadata pattern tolerates it). A later successful retry of that
  tool records 「本次已恢复」 and closes nothing. A subagent session may run the
  analysis and the bundle records `invocation.delegation` with
  `mayApproveUpgrade: false`; a `--user-report` it supplies is marked
  `userReport.source: subagent` with `standsForUser: false` — an agent message is
  never the user's consent.
- `operations-upgrade-assessment.spec.ts` — UPG-01/02/08/11. The read-only
  update assessment: every query lands in `sources.json` with its query time,
  channel (release / prerelease / commit) and status, and a failed query is
  `unverified` — never "the latest" — capping the conclusion at `defer`. The
  four conclusions override in one direction (`insufficient-evidence` >
  `defer` > `recommend-candidate` > `no-upgrade`), and only three verified
  stable channels with no newer version reach `no-upgrade`. Each local patch
  marker is decided keep / redo / delete from the CANDIDATE package's own bytes,
  with a reason per item; an undecidable item defers instead of guessing. The
  official DSH gets impact areas and manual steps only, and a real official
  install stays byte-identical. A key baseline that is unknown (this checkout
  cannot resolve the official host) still yields a report, marked
  `pendingVerification` and never "verified". The whole run writes exactly
  three files under `<evidence>/upgrades/<stamp>/`, leaves the maintenance
  worktree identical, and neither an incident run nor a wrong-preset run starts
  it or queries anything. Exit 0 is exercised through a bundle fixture that
  really carries all three components, in a child process. A component is capped
  at `defer` while ANY of its three channels is unverified (an unchecked
  pre-release or branch head could still hide something newer), an unready bound
  dependency defers even when the baseline cannot be compared, and a write
  failure reports `incomplete` (exit 2) rather than a usage error.
- `operations-pack.spec.ts` — PACK-01's entry slice. `pnpm pack`, a real
  install into an unrelated project, and resolution + execution from a foreign
  working directory. An engine the install does not carry reports `unknown`,
  which is the difference the ticket asks for.

`operations-preset-harness.ts` is the shared fixture: it reads the shipped rows
from `presets/ptc-hashline/preset.patch.yml` with the loader's own YAML
dialect, so a row that disappears or a frontmatter policy that flips fails a
test rather than passing on a copy.
## Shebangs in imported `.mjs` modules

A `.mjs` module that is *imported by a test* must not carry a `#!` line: Vite 7's
SSR transform keeps the shebang in its output, and Node 24 then fails to parse
the module (`Invalid or unexpected token`), which shows up as a load failure of
the importing spec. The three modules this tier imports
(`presets/ptc-hashline/operations/cli.mjs`, `.../session-log.mjs` and
`scripts/extract-runtime-evidence.mjs`) are always invoked as `node <path>`, so
they carry no shebang; the other scripts keep theirs because only the shell
runs them.

