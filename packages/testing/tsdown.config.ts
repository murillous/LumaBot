import { defineConfig } from 'tsdown';

// Dois entries: o principal registra os matchers no `expect` do Vitest; o `/bot` traz o mesmo
// kit sem importar o Vitest, para quem sobe o bot fora dos testes (o benchmark).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bot: 'src/bot.ts',
  },
});
