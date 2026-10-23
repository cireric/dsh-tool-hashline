# Provenance of the ptc-hashline preset

The preset is derived from the `cireric/dsh-ptc-roles` preset `ptc-gate`. The two
gate assets are byte-identical to that baseline; the patch keeps only the deltas
listed below.

| Item | Value |
|---|---|
| Source project | `cireric/dsh-ptc-roles` |
| Source path | `preset/ptc-gate/` |
| Base commit | `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341` (2026-10-02) |
| Migration date | 2026-10-23 |
| Baseline copies | removed 2026-10-23 (see “Evolution” below) |

## Resource digests (sha256 over LF-normalized text)

| Resource | sha256 |
|---|---|
| `personas/orchestrator.md` | `8fafe875d0de79276272c289d54a171aa864f8292682a0f2e9fd632186e7ab86` |
| `intent-gate-watchdog.mjs` | `865d4fd5e1a9e663a9c8b3f669349f6f22c283157eb7ef240daa079f979389da` |

`pnpm check:preset` recomputes both digests (normalizing CRLF) and fails on any
content change. The source files use CRLF; line endings are a checkout artifact,
not part of the gate asset.

## Deltas from the baseline (the only allowed differences)

1. Preset id and display metadata: `ptc-hashline` / "PTC Hashline Mode".
2. Functional rows: `tool-fs` gains `read: false`, `edit: false` and the three
   read caps; `@dsh-tool-hashline/tool-read` and `@dsh-tool-hashline/tool-edit`
   are inserted immediately after it.
3. Resource addresses: the persona prefix resolves this bundle's `package.json`;
   the watchdog row points at this bundle's `preset/ptc-hashline/` subpath.

Everything else — persona body, watchdog body, `tool-presentation: mode: ptc`,
`gate: enforce`, `tool-subagent.maxDepth: 1`, and the rest of the plugin list —
came from the baseline unchanged.

## Evolution

The frozen ptc-gate copies and the structural diff were removed on 2026-10-23:
from here on, `preset/ptc-hashline/` itself is the source of truth. Intentional
changes to the persona/watchdog must update the digest constants in
`scripts/check-preset.mjs` and this file in the same commit; the check then
guards against accidental edits rather than against the retired upstream copy.
