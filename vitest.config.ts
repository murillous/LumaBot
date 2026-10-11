import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Um projeto por app. O legacy/ roda o próprio Vitest, a partir de legacy/.
  test: { projects: ['apps/*'] },
});
