# Issue tracker: Local Markdown

Local issues, draft specs and raw runtime evidence live under `.scratch/` and are not tracked by Git. Durable requirements and implementation plans belong in `docs/specs/` and `docs/plans/`; existing documents under `docs/spec/` keep their current paths.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- A draft spec may start at `.scratch/<feature-slug>/spec.md`. Once promoted, maintain its authoritative body in `docs/specs/` and its plan in `docs/plans/`; a local tracker may link there but must not maintain a second requirements body.
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

The operations-skills requirements are in [docs/specs](../specs/2026-10-23-ptc-hashline-operations-skills.md), with their [implementation plan](../plans/2026-10-23-ptc-hashline-operations-skills-implementation-plan.md). Migration does not authorize implementation or a real dependency upgrade.

Raw logs and local tickets are not restored by cloning this repository. Promote sanitized conclusions, reproducible tests and necessary evidence into formal docs when needed for maintenance; keep source locations and historical results explicit. The [current acceptance index](../acceptance/2026-10-23-current-status-and-evidence-index.md) distinguishes shipped documentation from local evidence.

## Existing contents

`.scratch/dsh-ptc-roles/` is a copied-out project (it has its own `AGENTS.md`, `docs/`, `preset/`, `scripts/`), not a feature directory. Don't treat it as one, and don't create a feature slug that collides with its name.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
