import { defineConfig } from 'vitest/config';

// Evaluations against data sets that are not in the repository. See scripts/eval/README.md.
export default defineConfig({
  test: {
    include: ['scripts/eval/**/*.eval.ts'],
    environment: 'node',
  },
});
