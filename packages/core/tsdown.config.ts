import { defineConfig } from 'tsdown';

// Dois entries: o kernel e a suíte de contrato de storage (`@zapforge/core/storage-contract`),
// separada para que quem usa o kernel em produção não carregue código de teste.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'storage-contract': 'src/storage/contract/index.ts',
  },
});
