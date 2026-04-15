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
/**
 * Valida as variáveis obrigatórias com base no provider de IA ativo.
 * Só exige a API Key do provider configurado em AI_PROVIDER.
 */
function validateRequired() {
  const missing = [];
  const provider = process.env.AI_PROVIDER || 'gemini';

  if (provider === 'gemini' || provider === undefined) {
    if (!process.env.GEMINI_API_KEY?.trim()) missing.push('GEMINI_API_KEY');
  }

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY?.trim()) missing.push('OPENAI_API_KEY');
  }

  if (provider === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY?.trim()) missing.push('DEEPSEEK_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(
      `[Config] Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}\n` +
      `Crie ou verifique o arquivo .env na raiz do projeto.\n` +
      `Provider ativo: AI_PROVIDER=${provider}`,
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
 *   AI_PROVIDER: string,
 *   AI_MODEL: string,
 *   GEMINI_API_KEY: string | undefined,
 *   OPENAI_API_KEY: string | undefined,
 *   TAVILY_API_KEY: string | undefined,
 *   OWNER_NUMBER: string | undefined,
 *   LOG_LEVEL: string,
 *   DASHBOARD_PORT: number,
 *   DASHBOARD_PASSWORD: string,
 *   CLOUDFLARE_TUNNEL: boolean,
 * }}
 */
export const env = Object.freeze({
  // Provider de IA — define qual adapter usar ('gemini' | 'openai')
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  // Modelo específico — cada adapter usa seu padrão se não informado
  AI_MODEL: process.env.AI_MODEL || undefined,

  // API Keys — apenas a do provider ativo é obrigatória
  GEMINI_API_KEY:   process.env.GEMINI_API_KEY   || undefined,
  OPENAI_API_KEY:   process.env.OPENAI_API_KEY   || undefined,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || undefined,

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
