# dsh-tool-hashline

Make oh-my-pi style hashline editing work on **stock** DeepSeek Harness
(DSH `0.2.1-rc.2`). The bundle ships one agent preset, `ptc-hashline`:
PTC (the model only calls `run_code`, tools are SDK functions inside the
program), a per-turn intent gate, and a self-built `read` whose
canonical `value` carries a content tag the upstream `edit` accepts.

## What is in the box

| Package | Role |
|---|---|
| `@dsh-tool-hashline/hashline` | version anchor for `@hy-sde-org/dsh-hashline@0.2.1-alpha.4` (no vendoring) |
| `@dsh-tool-hashline/tool-edit` | version anchor for `@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4` |
| `@dsh-tool-hashline/tool-read` | the complete `read`: mint / window / seen / card / prompt |
| `presets/ptc-hashline/` | the preset patch plus its persona and watchdog assets |
| `patches/` | two local precise-version patches: `dsh-tool-edit` (effective working directory, MV containment + create intent, partial-move reporting, BOM-preserving hashline read, DEST/commit wording) and `dsh-hashline` (disk move before snapshot migration, truthful snapshot-commit error) |

## Runtime dependency surface

`tool-read` imports at runtime only Node builtins, the pinned hashline anchor, and two host
contract packages: `@deepseek-ai/dsh-tools` (`defineTool`) and `@deepseek-ai/dsh-fs`
(`FsError`, needed for the `FS_*` error codes). Host implementation packages and host read
config are forbidden; `pnpm test:unit` enforces this whitelist with an AST scan of `src` and
`dist` (spec NFR-4 / C-08).

## Install into a DSH profile

```powershell
pnpm install:profile                 # default: --profile web
pnpm install:profile --profile other --dry-run
```

The script builds when a `dist/` entry is missing, links this checkout's four
packages through the source `dsh` CLI (`pnpm dsh plugin add link:…`), registers
the bundle, and verifies `--dump-config` plus resource resolution. It is
idempotent (a second run reports "already installed") and never restarts the
host; it prints the restart command and the preset to pick.

## Build, check, test

```powershell
pnpm install
pnpm build            # tsc -> packages/*/dist (host-loadable JS + .d.ts)
pnpm check            # build + tsc --noEmit for every package and the root test suites
pnpm test             # build + package tests
pnpm test:unit        # tag/window/config/lang pure functions
pnpm test:integration # real ToolRuntime + local fs + upstream edit
pnpm test:ptc         # run_code dispatch via the production PTC bridge (in-process carrier), nullable SDK, intent gate
pnpm test:compat      # upstream guard/recovery/lifecycle matrix
pnpm check:preset     # baseline drift, caps equality, resource digests
pnpm test:profile     # clean profile install + dsh composition + read->edit
```

Every gate fails non-zero with a printed reason. `tests/compat/README.md`
records the pinned upstream behaviors; `docs/acceptance/` maps each requirement
to the case that proves it. See [acceptance traceability](./docs/acceptance/2026-10-23-acceptance-traceability.md)
and the [runtime-fix acceptance record](./docs/acceptance/2026-10-23-runtime-fix-acceptance.md).

## Install into a profile (not the daily profile yet)

The repository root is the bundle: `package.json` declares
`dsh.bundle.patch -> ./presets/ptc-hashline/preset.patch.yml`.

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
   profile. The composition leg needs the `dsh` launcher: it uses `$DSH_CLI` when set,
   otherwise a sibling `deepseek-harness/apps/cli/lib/bin.js`, and reports a GAP when
   neither is available.

The preset turns stock `read`/`edit` **off** and mounts this `read` plus the
upstream `edit`; both tools keep their names (`read`, `edit`) because the gate
matches behavior tools by name.

### Working directory (read and edit share one source)

Both tools take the **effective** session directory from the host's
`workingDirectory` service — the value the model is shown and that `cd` changes
— and use it for path resolution and for the snapshot store key
(`path.resolve(cwd, authoredPath)`). A Session's `header.cwd` is only its origin.

Without an agent, both fall back to `process.cwd()` (matching the editor), so an
agentless relative read resolves there rather than at the filesystem provider's
mount default.

The upstream editor reads `session.cwd`, which a real Session does not expose, so
it always fell back to the host process directory. `pnpm patchedDependencies`
applies a small patch to `@hy-sde-org/dsh-tool-edit@0.2.1-alpha.4` that reads the
service instead (and confines both MV endpoints). Read takes the same value, so
`read` → relative-path `edit` finds the snapshot. See
[ADR-0003](./docs/adr/0003-effective-working-directory.md); a clean install MUST
resolve to the patched package (the lockfile records `patch_hash`).

## Byte fidelity (BOM and line endings)

Hashline edits on a UTF-8 file that starts with a **single** byte-order mark keep
that marker, the CRLF/LF style and the trailing newline; a file without one never
gains one. The mechanism: the local provider's decoder consumes one leading BOM
and does not report it, so the editor adapter reads the hashline text through a
dedicated BOM-preserving entry that re-attaches the marker from the raw three-byte
prefix (and re-checks the file version before doing so).

Scope, stated rather than implied:

- One initial BOM, under the **Local** provider as verified at this version. A file
  with **consecutive** leading BOMs is refused before any write with an explicit
  message (no silent rewrite, no recovery-based repair); unify read/edit/diff
  handling for that case before widening this.
- The BOM-preserving entry is used by hashline mode only. `replace`, `patch`,
  `apply_patch` and the diff preview keep their previous behavior.
- The adapter read now costs one extra three-byte range read and one closing
  `stat`, and REM/noop/recovery/preflight go through the same entry. `read`
  itself is unchanged: still one `stat` and one `readText`.

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
`packages/hashline/package.json` and `packages/tool-edit/package.json`, then:

1. Re-check BOTH patches. `dsh-tool-edit`: the new version must read
   `workingDirectory`, confine both MV endpoints, create the MV target through
   `write-intent`/`createIfAbsent`, report partial moves, preserve a leading BOM
   in hashline mode, and state the DEST basis plus the non-atomic commit.
   `dsh-hashline`: it must move the disk file before migrating the snapshot and
   report a failed commit without claiming an outcome it cannot prove. If the new
   version covers all of that, delete the patch and its `patchedDependencies`
   entry; otherwise redo it for the new version (never edit `node_modules` by hand).
2. `pnpm install` (the lockfile must carry the new `patch_hash` for both).
3. `pnpm test:unit && pnpm test:integration && pnpm test:compat` (plus
   `pnpm check:preset` if the preset is touched) **before** switching any daily
   profile.

`tests/compat/README.md` records the baseline as "original version + local patches".
This release stays `private`; nothing is published and the daily profile is
untouched.
