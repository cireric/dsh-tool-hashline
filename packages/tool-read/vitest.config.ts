import { defineConfig } from 'vitest/config'

/**
 * Package-local test scope. `tests/post-execute.spec.ts` is a historical
 * experiment (the decorator route was rejected); it stays on disk as evidence
 * but is not part of the implementation's coverage. The acceptance tiers are
 * `pnpm test:unit` and `pnpm test:integration` at the repo root.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.spec.ts', 'tests/integration/**/*.spec.ts'],
  },
})
