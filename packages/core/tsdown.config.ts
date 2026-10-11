import { defineConfig } from 'tsdown';

// Um entry por público (ADR 0034): plugin e app (`@usebridger/core`), transports e storages
// (`@usebridger/core/adapter`) e a suíte de contrato de storage (`@usebridger/core/storage-contract`),
// separada para que quem usa o kernel em produção não carregue código de teste.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    adapter: 'src/adapter.ts',
    'storage-contract': 'src/storage/contract/index.ts',
  },
});
