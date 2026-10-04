import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts: Vitest 4.0 carries its own copy of Vite, whose plugin
// types do not match the project's, and the tests need none of the build plugins anyway.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // `npm run coverage`: every source file counts, those no test reaches included.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
