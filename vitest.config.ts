import { defineConfig } from 'vitest/config';

// Dois projetos: o app (só `src/`, fora disso há worktrees locais e o node_modules) e o dashboard,
// que traz a própria config (happy-dom, Vite). Um `vitest run` na raiz roda os dois, sem repetir.
export default defineConfig({
  test: {
    projects: [{ test: { name: 'app', include: ['src/**/*.test.ts'] } }, 'dashboard'],
  },
});
