import { defineConfig } from 'tsdown';

// O benchmark roda do build, como o kernel roda em produção: executar o `.ts` carrega o type
// stripping do Node, que soma ~14 MB de RSS e distorce a meta de memória ociosa.
export default defineConfig({
  entry: { main: 'src/main.ts' },
  // Pacote privado, sem consumidor de tipos.
  dts: false,
});
