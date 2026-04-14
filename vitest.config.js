import { defineConfig } from 'vitest/config';

/**
 * Configuração do Vitest para o LumaBot.
 *
 * Usamos o runner nativo de ESM (sem transpilação), já que o projeto
 * é 100% ESM ("type": "module" no package.json). O coverage via v8
 * não requer instrumentação adicional de código — apenas a flag --coverage.
 */
export default defineConfig({
  test: {
    // Ambiente Node puro — sem DOM, sem jsdom
    environment: 'node',

    // Glob de arquivos de teste
    include: ['tests/**/*.test.js'],

    // Relatório no terminal: verboso para ver cada caso individualmente
    reporter: ['verbose'],

    // Cobertura de código
    coverage: {
      provider: 'v8',

      // Apenas o código-fonte da aplicação — exclui config, testes e infra
      include: ['src/**/*.js'],
      exclude: [
        'src/public/**',   // assets do dashboard (HTML/CSS/JS cliente)
        'src/config/**',   // configs são testadas indiretamente
      ],

      // Relatórios gerados: terminal (rápido) + lcov (para CI e badges)
      reporter: ['text', 'lcov'],

      // Meta mínima: 60% na fase 0, sobe para 80% nas fases seguintes
      thresholds: {
        lines:     60,
        functions: 60,
        branches:  60,
        statements: 60,
      },
    },
  },
});
