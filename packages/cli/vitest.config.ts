import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
  test: {
    root: '.',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 30_000,
  },
});
