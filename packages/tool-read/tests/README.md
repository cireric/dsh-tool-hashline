# tool-read tests

Implement M1 first; use [requirements v3 §8.1](../../../docs/specs/2026-10-22-ptc-hashline-requirements-spec.md) as the acceptance contract. Existing post-execute tests are historical experiments, not implementation coverage.

1. `mintTag` hashes BOM + CRLF normalized text identically to the engine.
2. Header insertion lands after `<content>\n` and is idempotent.
3. `read` of a 3-line file produces `[path#TAG]`, and `tool-edit` accepts the tag
   on the first call.
4. With live content unchanged and a retained same-session snapshot, the first edit at an unseen anchor is rejected.
5. Normalized UTF-8 text at or above 4 MiB produces no tag and a nonempty canonical nextAction.
6. Re-reading unchanged content produces the same tag.
7. Only fully returned lines add seen provenance; clipped lines do not. No complete lines uses [0], without clearing existing seen.
8. Separate column truncation, byte-capped output, and zero-line windows. Test nextAction through actual PTC value.
9. Emit fs/observed once after success; preserve provider errors and perform one stat plus one readText for a valid text read.
10. `mv-observation.spec.ts` also covers the hashline write path: MV DEST resolution
    (PATH-R1/R2), byte fidelity through PUT and MV (BYTES-R1, BOM-01..14), partial
    moves (PART-R1) and a destination `record` failure (SNAP-R3). The BOM cases are
    byte assertions against the raw Buffer — never against the decoded text — and the
    no-BOM control is part of them, so "it happened to add a marker" cannot pass.
