# Compatibility matrix

Run against each DSH version before switching a daily profile:

| DSH | status | notes |
|---|---|---|
| 0.2.1-rc.2 | target | initial development |
| next rc/minor | todo | scripted compatibility gate before any daily-profile switch |

The authoritative contract is [requirements v3 §8.1](../../docs/spec/2026-10-22-ptc-hashline-需求规格.md). The planned `pnpm test:compat` command is not implemented yet.

Cover normal read→edit, retained same-session unseen-anchor rejection, seen union, [0] and error reveals, cross-session and evicted-snapshot behavior, recovery, REM/block boundaries, mismatch retry behavior, and engine identity. At or above 4 MiB of normalized UTF-8 text, read does not mint a tag. Known permissive upstream behavior must be asserted explicitly rather than mistaken for strict guard coverage.
