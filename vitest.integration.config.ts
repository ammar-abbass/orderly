import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/integration/**/*.test.ts',
      'tests/e2e/**/*.test.ts',
      'tests/chaos/**/*.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
