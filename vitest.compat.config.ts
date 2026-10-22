import { defineConfig } from 'vitest/config'

/** Upstream compatibility matrix: guard, recovery and lifecycle behavior pinned per engine version. */
export default defineConfig({
  test: {
    include: ['tests/compat/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
})
