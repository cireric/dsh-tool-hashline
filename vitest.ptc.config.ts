import { defineConfig } from 'vitest/config'

/** PTC acceptance tier: real run_code dispatch through the registry's PTC bridge. */
export default defineConfig({
  test: {
    include: ['tests/ptc/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
})
