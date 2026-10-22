# tool-read tests

Implement M1 first; use [requirements v3 §8.1](../../../docs/spec/2026-10-22-ptc-hashline-需求规格.md) as the acceptance contract. Existing post-execute tests are historical experiments, not implementation coverage.

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
