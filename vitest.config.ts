import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared sources, so they don't need a build first.
    alias: { '@sst/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
  },
});
