import dotenv from 'dotenv';
import { EnvStore } from './EnvStore.js';

/**
 * Módulo de configuração centralizada de variáveis de ambiente.
 *
 * Responsabilidades:
 * 1. Carrega o arquivo .env com override:true — prevalece sobre env herdado do processo pai
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
// override:true garante que o .env do bot prevalece sobre env herdado do processo
// pai (dashboard), evitando que uma chave antiga em memória contamine o bot.
dotenv.config({ override: true });

// Overrides de env editados pelo dashboard vivem em data/env-overrides.json
// (volume gravável) e prevalecem sobre o .env — em produção o .env é read-only.
EnvStore.applyToProcessEnv();

// ─── Aviso de configuração de IA ──────────────────────────────────────────────

/**
 * Emite warnings se nenhuma chave de IA estiver configurada.
 * A ausência de chave não impede o bot de iniciar — features sem IA (sticker,
 * download, comandos de grupo) continuam funcionando normalmente.
 * O provider de IA é opcional: só falha silenciosamente para as mensagens
 * que precisariam de resposta inteligente.
 */
function warnIfNoAIKey() {
  const provider = process.env.AI_PROVIDER || 'gemini';

  const hasKey =
    (provider === 'gemini'   && process.env.GEMINI_API_KEY?.trim()) ||
    (provider === 'openai'   && process.env.OPENAI_API_KEY?.trim()) ||
    (provider === 'deepseek' && process.env.DEEPSEEK_API_KEY?.trim());

  if (!hasKey) {
    console.warn(
      `[Config] ⚠️  Nenhuma API Key de IA configurada para o provider "${provider}". ` +
      `O bot iniciará sem suporte a conversas — sticker, download e comandos de grupo funcionam normalmente.`,
    );
  }
}

warnIfNoAIKey();

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
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || undefined,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || undefined,

  // Busca na internet — opcional (cai para Google Grounding se ausente)
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || undefined,

  // Número do dono do bot para permissões especiais — opcional
  OWNER_NUMBER: process.env.OWNER_NUMBER || undefined,

  // Arquivo de cookies (formato Netscape) para o yt-dlp autenticar downloads —
  // opcional. Sem ele, plataformas com login gated (YouTube, Instagram, X)
  // falham com "sign in to confirm you're not a bot".
  YTDLP_COOKIES_FILE: process.env.YTDLP_COOKIES_FILE || undefined,

  // Nível de log do Baileys/Pino — padrão "silent" para não poluir stdout
  LOG_LEVEL: process.env.LOG_LEVEL || 'silent',

  // Dashboard
  DASHBOARD_PORT: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || '',
  CLOUDFLARE_TUNNEL: process.env.CLOUDFLARE_TUNNEL === 'true',
});
