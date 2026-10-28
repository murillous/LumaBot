import { defineConfig } from 'tsdown';

// Em produção o app roda do build: executar o `.ts` carregaria o type stripping do Node.
export default defineConfig({
  entry: { main: 'src/main.ts' },
  // App privado, sem consumidor de tipos.
  dts: false,
});
