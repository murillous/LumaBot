import { defineConfig } from 'tsdown';

// Só o binário: ninguém importa o scaffold como biblioteca.
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  dts: false,
});
