import dotenv from 'dotenv';

/**
 * Módulo de configuração centralizada de variáveis de ambiente.
 *
 * Responsabilidades:
 * 1. Carrega o arquivo .env uma única vez (idempotente — dotenv ignora chamadas repetidas)
 * 2. Valida as variáveis obrigatórias e lança erro explicativo se alguma faltar
 * 3. Exporta um objeto de config congelado — ninguém deve acessar process.env diretamente
 *
 * Por que centralizar?
 * - Sem este módulo, process.env estava espalhado em 4+ arquivos sem validação.
 *   Uma API Key faltando fazia o bot subir e falhar silenciosamente na primeira
 *   requisição à IA, em vez de falhar imediatamente com mensagem clara.
 * - Um único ponto de entrada facilita testar com configs diferentes via vi.stubEnv.
 *
 * Como usar:
 *   import { env } from '../config/env.js';
 *   const apiKey = env.GEMINI_API_KEY;
 */

// Carrega o .env do diretório de trabalho atual (root do projeto).
// No dashboard, process.cwd() é o mesmo root pois o script é lançado de lá.
dotenv.config();

// ─── Variáveis obrigatórias ────────────────────────────────────────────────────

/**
 * Lista de variáveis que DEVEM existir para o bot funcionar.
 * O código não chega à linha de importação se alguma estiver ausente.
 */
const REQUIRED = ['GEMINI_API_KEY'];

/**
 * Valida que todas as variáveis obrigatórias estão presentes e não estão vazias.
 * Lança erro descritivo com todas as variáveis ausentes de uma só vez
 * (não falha na primeira e esconde o resto).
 */
function validateRequired() {
  const missing = REQUIRED.filter(
    (key) => !process.env[key] || process.env[key].trim() === '',
  );

  if (missing.length > 0) {
    throw new Error(
      `[Config] Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}\n` +
      `Crie ou verifique o arquivo .env na raiz do projeto.\n` +
      `Exemplo: GEMINI_API_KEY=sua_chave_aqui`,
    );
  }
}

// Validação executada no momento do import — falha rápido e explícito.
// Em ambiente de teste, use vi.stubEnv() para injetar valores sem tocar no .env real.
validateRequired();

// ─── Exportação congelada ──────────────────────────────────────────────────────

/**
 * Objeto de configuração derivado do ambiente.
 * Congelado para prevenir mutações acidentais em runtime.
 * Acesse sempre via este objeto, nunca via process.env diretamente.
 *
 * @type {{
 *   GEMINI_API_KEY: string,
 *   TAVILY_API_KEY: string | undefined,
 *   OWNER_NUMBER: string | undefined,
 *   LOG_LEVEL: string,
 *   DASHBOARD_PORT: number,
 *   DASHBOARD_PASSWORD: string,
 *   CLOUDFLARE_TUNNEL: boolean,
 * }}
 */
export const env = Object.freeze({
  // IA — obrigatório
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  // Busca na internet — opcional (cai para Google Grounding se ausente)
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || undefined,

  // Número do dono do bot para permissões especiais — opcional
  OWNER_NUMBER: process.env.OWNER_NUMBER || undefined,

  // Nível de log do Baileys/Pino — padrão "silent" para não poluir stdout
  LOG_LEVEL: process.env.LOG_LEVEL || 'silent',

  // Dashboard
  DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || '',
  CLOUDFLARE_TUNNEL: process.env.CLOUDFLARE_TUNNEL === 'true',
});
