# Baseline provenance

The `ptc-hashline` preset reuses the `ptc-gate` gate assets unchanged.

| Item | Value |
|---|---|
| Source project | `cireric/dsh-ptc-roles` |
| Source path | `preset/ptc-gate/` |
| Base commit | `3d8f36eb8def861c3f2aa7d5f7b4983d96c92341` (2026-10-02) |
| Local clone used | `.scratch/dsh-ptc-roles` (development only; not required to build, install or verify) |
| Baseline patch copy | `preset/baseline/ptc-gate.preset.patch.yml` |

## Resource digests (sha256, bytes)

| Resource | sha256 | bytes |
|---|---|---|
| `personas/orchestrator.md` | `ebd083fb4fdfbe1fed2bf9c4996ef7b93729ec816a527866e0d6f5ef3a950125` | 11818 |
| `intent-gate-watchdog.mjs` | `566c462730d9b2569494dc67afe8f3f34ef8e4ea696dee0cb03f014687e69236` | 31480 |

`pnpm check:preset` recomputes both digests and fails on any byte change.
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
