# Baseline provenance

The `ptc-hashline` preset reuses the `ptc-gate` gate assets unchanged.

| Item | Value |
|---|---|
| Source project | `cireric/dsh-ptc-roles` |
| Source path | `preset/ptc-gate/` |
| Base commit | `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341` (2026-10-02) |
| Local clone used | `.scratch/dsh-ptc-roles` (development only; not required to build, install or verify) |
| Baseline patch copy | `preset/baseline/ptc-gate.preset.patch.yml` |

## Resource digests (sha256 over LF-normalized text, bytes as copied)

| Resource | sha256 | bytes |
|---|---|---|
| `personas/orchestrator.md` | `8fafe875d0de79276272c289d54a171aa864f8292682a0f2e9fd632186e7ab86` | 11818 |
| `intent-gate-watchdog.mjs` | `865d4fd5e1a9e663a9c8b3f669349f6f22c283157eb7ef240daa079f979389da` | 31480 |

`pnpm check:preset` recomputes both digests and fails on any content change. The source
files use CRLF; line endings are normalized before hashing so a git checkout's
autocrlf setting cannot fail the gate.
Copies under `preset/baseline/` are the comparison source; they are not loaded by
the host.

## Allowed differences from the baseline

1. Preset id and display metadata: `ptc-hashline` / "PTC Hashline Mode".
2. Functional rows: `tool-fs` gains `read: false`, `edit: false` and the three
   read caps; `tool-read` (`@dsh-tool-hashline/tool-read`) and `tool-edit`
   (`@dsh-tool-hashline/tool-edit`) are inserted after it.
3. Resource addresses: the persona prefix resolves this bundle's `package.json`;
   the watchdog row points at this bundle's `preset/ptc-hashline/` subpath.

Everything else — persona body, watchdog body, `tool-presentation: mode: ptc`,
`gate: enforce`, `tool-subagent.maxDepth: 1`, and the rest of the plugin list —
is byte-identical to the baseline, which is why the copied persona/watchdog are
digest-checked and the patch is diffed structurally.

The check is offline: it never contacts the source project or the network.
