import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works at a domain root (Vercel) and under a
  // sub-path (GitHub Pages) without rebuilding.
  base: './',
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
