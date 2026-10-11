import { defineConfig } from 'tsdown';

// O `@usebridger/core` fica fora do bundle (peer dependency): o plugin usa o core do bot.
export default defineConfig({
  entry: 'src/index.ts',
  dts: true,
});
