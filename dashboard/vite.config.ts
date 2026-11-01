import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // `loadEnv` lê o `.env` do dashboard e o ambiente (o Biome proíbe `process.env`). Prefixo
  // `LUMA_` só para a config do dev server; nada disso vai para o bundle.
  const env = loadEnv(mode, import.meta.dirname, 'LUMA_');
  const target = env['LUMA_BOT_URL'] || 'http://127.0.0.1:3000';
  // Mesma origem: o cookie de sessão do core é `Secure; SameSite=Strict` e sem `api.cors` não há
  // CORS, então a API só funciona sob a origem do próprio app. Sem `changeOrigin` o Host chega ao
  // bot como o do browser; o core não confere Host nem Origin sem `api.cors`, então tanto faz, e
  // o padrão do proxy é o mais simples.
  const proxy = {
    '/api': { target },
    '/openapi.json': { target },
    // O painel genérico do Bridger (Conexão, Usuários, Chaves de API) até o dashboard cobri-los.
    // Regex para não pegar `/plugins/dashboard-x`; `/plugins/:nome` sem `dashboard` é do SPA.
    '^/plugins/dashboard(/|$)': { target },
  };
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
    preview: { proxy },
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      // pushState precisa de uma origem de verdade; about:blank lança SecurityError.
      environmentOptions: { happyDOM: { url: 'http://localhost:3000/' } },
    },
  };
});
