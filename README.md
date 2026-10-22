# dsh-tool-hashline

Make oh-my-pi style hashline editing work on **stock** DeepSeek Harness.

- Dependency pins: `@hy-sde-org/dsh-hashline` + `@hy-sde-org/dsh-tool-edit` (no vendoring).
- Planned integration: a complete `read` tool with canonical tag/nextAction fields, bounded output windows, and the upstream engine's limited seen-line guard.
- One independent `ptc-hashline` preset will include the pinned `ptc-gate` persona/watchdog assets; the original ptc-roles project is not a deployment dependency.
- Status: **scaffold / not implemented**. See [HANDOFF.md](./HANDOFF.md).
- Implementation and acceptance baseline: [requirements v3](./docs/spec/2026-10-22-ptc-hashline-需求规格.md).
