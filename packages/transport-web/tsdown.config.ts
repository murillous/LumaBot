import { defineConfig } from 'tsdown';

// Dois públicos: o app, que monta o transport (`@zapforge/transport-web`), e o front, que só
// precisa do cliente de referência (`@zapforge/transport-web/client`), sem o `jose` nem o core.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
  },
});
