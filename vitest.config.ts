import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      shared: path.resolve(__dirname, 'shared/src/index.ts'),
    },
  },
  test: {
    include: ['server/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
    sequence: {
      concurrent: false,
    },
  },
});
