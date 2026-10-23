# dsh-tool-hashline

Make oh-my-pi style hashline editing work on **stock** DeepSeek Harness
(DSH `0.2.1-rc.2`). The bundle ships one agent preset, `ptc-hashline`:
PTC (the model only calls `run_code`, tools are SDK functions inside the
program), the migrated `ptc-gate` intent gate, and a self-built `read` whose
canonical `value` carries a content tag the upstream `edit` accepts.

## What is in the box

| Package | Role |
|---|---|
| `@dsh-tool-hashline/hashline` | version anchor for `@hy-sde-org/dsh-hashline@0.2.1-alpha.4` (no vendoring) |
| `@dsh-tool-hashline/tool-edit` | version anchor for `@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4` |
| `@dsh-tool-hashline/tool-read` | the complete `read`: mint / window / seen / card / prompt |
| `preset/ptc-hashline/` | the preset patch plus the verbatim `ptc-gate` persona and watchdog |

## Build, check, test

```powershell
pnpm install
pnpm build            # tsc -> packages/*/dist (host-loadable JS + .d.ts)
pnpm check            # build + tsc --noEmit for every package
pnpm test             # build + package tests
pnpm test:unit        # tag/window/config/lang pure functions
pnpm test:integration # real ToolRuntime + local fs + upstream edit
pnpm test:ptc         # real run_code dispatch, nullable SDK, intent gate
pnpm test:compat      # upstream guard/recovery/lifecycle matrix
pnpm check:preset     # baseline drift, caps equality, resource digests
pnpm test:profile     # clean profile install + dsh composition + read->edit
```

Every gate fails non-zero with a printed reason. `tests/compat/README.md`
records the pinned upstream behaviors; `docs/acceptance/` maps each requirement
to the case that proves it. See [acceptance traceability](./docs/acceptance/2026-10-23-验收追溯.md).

## Install into a profile (not the daily profile yet)

The repository root is the bundle: `package.json` declares
`dsh.bundle.patch -> ./preset/ptc-hashline/preset.patch.yml`.

1. Build: `pnpm build`.
2. In a profile manifest (`$DSH_HOME/profiles/<name>/package.json`) depend on
   this checkout and the two plugin packages, and register the bundle:
   ```json
   {
     "dependencies": {
       "dsh-tool-hashline": "link:<repo>",
       "@dsh-tool-hashline/hashline": "link:<repo>/packages/hashline",
       "@dsh-tool-hashline/tool-read": "link:<repo>/packages/tool-read",
       "@dsh-tool-hashline/tool-edit": "link:<repo>/packages/tool-edit"
     },
     "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-tool-hashline"] } }
   }
   ```
3. `pnpm install` in the profile, then **remount** the host (`dsh --profile <name>`)
   — a preset is static, so a new session in the same process is not enough.
4. `dsh --profile <name> --dump-config` should show one `ptc-hashline` preset,
   `@dsh-tool-hashline/tool-read`, `@dsh-tool-hashline/tool-edit` and the
   watchdog subpath. `pnpm test:profile` performs exactly this in a throwaway
   profile.

The preset turns stock `read`/`edit` **off** and mounts this `read` plus the
upstream `edit`; both tools keep their names (`read`, `edit`) because the gate
matches behavior tools by name.

## Reading cost and degradation (read this before using it on big files)

- A valid text read performs **one `stat` and one whole-file `readText`**. There is
  no streaming; memory grows with the file. The 4 MiB snapshot ceiling only
  decides whether a tag is minted — it is **not** a read memory bound.
- Default window: 2000 lines / 2000 chars per line / 50 KiB of output. A single
  long line is column-truncated; many lines can hit the byte cap and stop the
  window. Both cases return an actionable `nextAction`.
- Truncated or zero-line windows do not claim a tag is usable: re-reading with
  the same config will not reveal the rest of a long line. Raise
  `maxLineLength`/`maxBytes` in `tool-read` (and the mirrored `tool-fs` caps),
  remount, then read again — or use `edit`'s `replace`/`patch` mode.
- Files at/above `snapshotMaxBytes` (4 MiB), empty files, and reads without an
  agent session do not mint a tag (`tagged:false`, `tag:null`, non-empty
  `nextAction`). Replace/patch still work; they do not consume a tag.

## seen vs observed (two different mechanisms)

- **observed** is the filesystem policy's read-before-write state, keyed by the
  target's realpath; `read` emits `fs/observed` so a later stock `write` is
  allowed.
- **seen** is the hashline engine's per-session provenance of the lines a
  window fully returned. It is a *bounded* guard, not a permission boundary:
  cross-session reads, evicted snapshots, recovery, `REM` (no line anchor),
  block edits and mismatch snapshots can all let an edit through. 
  `pnpm test:compat` pins these behaviors so upgrades cannot change them
  silently.

## Upgrading the engine

The two upstream packages are pinned exactly. Change the version in
`packages/hashline/package.json` and `packages/tool-edit/package.json`,
`pnpm install`, then run `pnpm test:compat` (and `pnpm check:preset` if the
preset is touched) **before** switching any daily profile. This release stays
`private`; nothing is published and the daily profile is untouched.
