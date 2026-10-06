/**
 * Esquema declarativo de toda a configuração editável do LumaBot.
 *
 * Fonte única consumida pelo dashboard para renderizar formulários e pelo
 * backend para validar o que pode ser gravado. Cada campo aponta para onde
 * o valor vive:
 *
 *   source: 'env'    → variável de ambiente (gravada no .env, aplica no restart)
 *   source: 'config' → override sobre constants.js/lumaConfig.js (ConfigStore)
 *
 * Para 'config', `section` é o nome do export (CONFIG, LUMA_CONFIG, MENUS,
 * MESSAGES) e `path` é o caminho com pontos dentro dele (ex: 'TECHNICAL.maxHistory').
 *
 * Tipos de campo: text | number | boolean | secret | select | textarea | json
 */
export const CONFIG_SCHEMA = {
  groups: [
    {
      id: "ai",
      title: "IA & Provedor",
      description: "Provedor de IA, modelo e chaves de API.",
      fields: [
        { key: "AI_PROVIDER", source: "env", label: "Provedor", type: "select", options: ["gemini", "openai", "deepseek"] },
        { key: "AI_MODEL", source: "env", label: "Modelo (opcional)", type: "text", placeholder: "gemini-2.5-flash" },
        { key: "GEMINI_API_KEY", source: "env", label: "Gemini API Key", type: "secret" },
        { key: "OPENAI_API_KEY", source: "env", label: "OpenAI API Key", type: "secret" },
        { key: "DEEPSEEK_API_KEY", source: "env", label: "DeepSeek API Key", type: "secret" },
        { key: "TAVILY_API_KEY", source: "env", label: "Tavily API Key (busca web)", type: "secret" },
      ],
    },
    {
      id: "bot",
      title: "Bot & Dashboard",
      description: "Identidade do dono, logs e acesso ao painel.",
      fields: [
        { key: "OWNER_NUMBER", source: "env", label: "Número do dono", type: "text", placeholder: "5511999999999" },
        { key: "LOG_LEVEL", source: "env", label: "Nível de log", type: "select", options: ["silent", "error", "warn", "info", "debug"] },
        { key: "DASHBOARD_PORT", source: "env", label: "Porta do dashboard", type: "number" },
        { key: "DASHBOARD_PASSWORD", source: "env", label: "Senha do dashboard", type: "secret" },
        { key: "CLOUDFLARE_TUNNEL", source: "env", label: "Cloudflare Tunnel", type: "boolean" },
      ],
    },
    {
      id: "ia_tuning",
      title: "Ajuste fino da IA",
      description: "Parâmetros de geração e memória de conversa.",
      fields: [
        { key: "TECHNICAL.generationConfig.temperature", source: "config", section: "LUMA_CONFIG", label: "Temperature", type: "number", step: 0.1, min: 0, max: 2 },
        { key: "TECHNICAL.generationConfig.maxOutputTokens", source: "config", section: "LUMA_CONFIG", label: "Máx. tokens de saída", type: "number" },
        { key: "TECHNICAL.generationConfig.topP", source: "config", section: "LUMA_CONFIG", label: "topP", type: "number", step: 0.05, min: 0, max: 1 },
        { key: "TECHNICAL.generationConfig.topK", source: "config", section: "LUMA_CONFIG", label: "topK", type: "number" },
        { key: "TECHNICAL.maxHistory", source: "config", section: "LUMA_CONFIG", label: "Máx. de linhas no histórico", type: "number" },
        { key: "TECHNICAL.groupContextSize", source: "config", section: "LUMA_CONFIG", label: "Mensagens de contexto de grupo", type: "number" },
        { key: "TECHNICAL.maxResponseLength", source: "config", section: "LUMA_CONFIG", label: "Tamanho máx. da resposta", type: "number" },
        { key: "TECHNICAL.maxParts", source: "config", section: "LUMA_CONFIG", label: "Máx. de balões [PARTE]", type: "number" },
        { key: "TECHNICAL.models", source: "config", section: "LUMA_CONFIG", label: "Modelos Gemini (fallback)", type: "json" },
        { key: "DEFAULT_PERSONALITY", source: "config", section: "LUMA_CONFIG", label: "Personalidade padrão", type: "text" },
      ],
    },
    {
      id: "spontaneous",
      title: "Interações espontâneas",
      description: "Quando e com que frequência a Luma fala sozinha em grupos.",
      fields: [
        { key: "SPONTANEOUS.enabled", source: "config", section: "LUMA_CONFIG", label: "Ativado", type: "boolean" },
        { key: "SPONTANEOUS.chance", source: "config", section: "LUMA_CONFIG", label: "Chance base (grupo quieto)", type: "number", step: 0.01, min: 0, max: 1 },
        { key: "SPONTANEOUS.imageChance", source: "config", section: "LUMA_CONFIG", label: "Chance com imagem", type: "number", step: 0.01, min: 0, max: 1 },
        { key: "SPONTANEOUS.cooldownMs", source: "config", section: "LUMA_CONFIG", label: "Cooldown (ms)", type: "number" },
        { key: "SPONTANEOUS.activityBoost.threshold", source: "config", section: "LUMA_CONFIG", label: "Limiar de grupo ativo (msgs)", type: "number" },
        { key: "SPONTANEOUS.activityBoost.boostedChance", source: "config", section: "LUMA_CONFIG", label: "Chance com grupo ativo", type: "number", step: 0.01, min: 0, max: 1 },
        { key: "SPONTANEOUS.emojiPool", source: "config", section: "LUMA_CONFIG", label: "Pool de emojis", type: "json" },
      ],
    },
    {
      id: "media",
      title: "Mídia & Limites",
      description: "Stickers, vídeos e limites técnicos.",
      fields: [
        { key: "STICKER_SIZE", source: "config", section: "CONFIG", label: "Tamanho do sticker (px)", type: "number" },
        { key: "STICKER_QUALITY", source: "config", section: "CONFIG", label: "Qualidade do sticker", type: "number", min: 1, max: 100 },
        { key: "VIDEO_DURATION", source: "config", section: "CONFIG", label: "Duração máx. de vídeo (s)", type: "number" },
        { key: "GIF_DURATION", source: "config", section: "CONFIG", label: "Duração máx. de GIF (s)", type: "number" },
        { key: "VIDEO_DOWNLOAD_MAX_SIZE_MB", source: "config", section: "CONFIG", label: "Tamanho máx. de download (MB)", type: "number" },
        { key: "MAX_FILE_SIZE", source: "config", section: "CONFIG", label: "Tamanho máx. de arquivo (KB)", type: "number" },
      ],
    },
    {
      id: "personalities",
      title: "Personalidades",
      description: "As personas da Luma — contexto, estilo e traços. Edição avançada em JSON.",
      fields: [
        { key: "PERSONALITIES", source: "config", section: "LUMA_CONFIG", label: "Personalidades (JSON)", type: "json", advanced: true },
        { key: "TRIGGERS", source: "config", section: "LUMA_CONFIG", label: "Gatilhos (regex como strings)", type: "json", advanced: true },
      ],
    },
    {
      id: "prompts",
      title: "Prompts",
      description: "Templates de prompt enviados à IA. Use os placeholders {{...}}.",
      fields: [
        { key: "PROMPT_TEMPLATE", source: "config", section: "LUMA_CONFIG", label: "Prompt principal", type: "textarea", advanced: true },
        { key: "VISION_PROMPT_TEMPLATE", source: "config", section: "LUMA_CONFIG", label: "Prompt de visão", type: "textarea", advanced: true },
      ],
    },
    {
      id: "messages",
      title: "Mensagens & Menus",
      description: "Textos de UI, ajuda e respostas do bot.",
      fields: [
        { key: "HELP_TEXT", source: "config", section: "MENUS", label: "Texto de ajuda (!help)", type: "textarea" },
        { key: "MESSAGES", source: "config", section: "MESSAGES", label: "Mensagens do sistema (JSON)", type: "json", advanced: true },
      ],
    },
  ],
};

/** Lista achatada de todos os campos, útil para validação no backend. */
export function flattenSchemaFields() {
  return CONFIG_SCHEMA.groups.flatMap((g) => g.fields);
}

/** Conjunto de chaves de env editáveis pelo dashboard. */
export const EDITABLE_ENV_KEYS = new Set(
  flattenSchemaFields().filter((f) => f.source === "env").map((f) => f.key)
);

/** Campos do tipo secret — mascarados na leitura. */
export const SECRET_KEYS = new Set(
  flattenSchemaFields().filter((f) => f.type === "secret").map((f) => f.key)
);
