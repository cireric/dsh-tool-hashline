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
