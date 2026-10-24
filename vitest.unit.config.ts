import { defineConfig } from 'vitest/config'

/**
 * Pure-function tier: no host runtime, no disk. Run with `pnpm test:unit`.
 *
 * `tests/unit` holds the repository-level pure modules (the evaluation driver's
 * own rules); the package-local directories keep the per-package suites.
 */
export default defineConfig({
  test: {
    include: ['packages/*/tests/unit/**/*.spec.ts', 'tests/unit/**/*.spec.ts'],
    reporters: ['default'],
  },
})
