import { defineConfig } from 'vitest/config'

/** Host-runtime tier: real ToolRuntime, real local filesystem, upstream edit. Run with `pnpm test:integration`. */
export default defineConfig({
  test: {
    include: ['packages/*/tests/integration/**/*.spec.ts', 'tests/integration/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
})
