import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Um projeto por app.
  test: { projects: ['apps/*'] },
});
