import { defineConfig } from 'vitest/config'

/** Pure-function tier: no host runtime, no disk. Run with `pnpm test:unit`. */
export default defineConfig({
  test: {
    include: ['packages/*/tests/unit/**/*.spec.ts'],
    reporters: ['default'],
  },
})
