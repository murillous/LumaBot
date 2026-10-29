import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Só os testes do app: fora disso há worktrees locais e o node_modules.
  test: { include: ['src/**/*.test.ts'] },
});
