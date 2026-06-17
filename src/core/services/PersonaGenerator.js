import { Logger } from "../../utils/Logger.js";

/**
 * Traço de formato anexado pelo SISTEMA (não pelo modelo) a toda persona custom.
 * É a mesma regra de formato WhatsApp já usada pelas personas predefinidas
 * (ver src/config/lumaConfig.js): blocos curtos e separação por [PARTE].
 */
export const WHATSAPP_FORMAT_TRAIT =
  "MENSAGENS CURTAS: Máximo 200 caracteres por bloco. Se precisar falar mais, separe a mensagem usando [PARTE] (máx 1 a 2 blocos bem curtos).";

// Limites de cada campo do shape de persona. name/context/style são truncados
// quando excedem; traits é o único limite que pode rejeitar (mínimo de 3).
const LIMITS = {
  name: 40,
  context: 600,
  style: 300,
  trait: 200,
  minTraits: 3,
  maxTraits: 8,
};

const PERSONA_PROMPT = (description) =>
  `Você é um gerador de personalidades para uma assistente de WhatsApp chamada Luma.\n` +
  `A partir da descrição livre abaixo, crie uma personalidade coerente e responda APENAS com um objeto JSON válido, sem texto extra e sem cercas de código.\n\n` +
  `Formato exato do JSON:\n` +
  `{\n` +
  `  "name": "nome curto e marcante da persona (até ${LIMITS.name} caracteres)",\n` +
  `  "description": "uma linha curta resumindo a vibe, pode começar com um emoji",\n` +
  `  "context": "quem a persona é, em 2ª pessoa ('Você é...'), até ${LIMITS.context} caracteres",\n` +
  `  "style": "como ela escreve: tom, gírias, uso de emojis, até ${LIMITS.style} caracteres",\n` +
  `  "traits": ["entre ${LIMITS.minTraits} e ${LIMITS.maxTraits} traços de comportamento, cada um até ${LIMITS.trait} caracteres"]\n` +
  `}\n\n` +
  `Não inclua regras de formato/tamanho de mensagem nos traits — isso é adicionado automaticamente.\n\n` +
  `Descrição: ${description}`;

/**
 * Transforma uma descrição livre em um shape de persona validado
 * ({ name, description, context, style, traits[] }), pronto para persistir.
 *
 * A lógica de parsing, validação e geração de slug é pura: depende apenas do
 * texto devolvido pela IA, que entra por injeção de dependência (aiService).
 */
export class PersonaGenerator {
  /**
   * @param {object} deps
   * @param {{ generateContent: Function }} deps.aiService - provider de IA (AIPort)
   */
  constructor({ aiService } = {}) {
    if (!aiService) throw new Error("PersonaGenerator: aiService é obrigatório.");
    this.aiService = aiService;
  }

  /**
   * Gera e valida uma persona a partir de uma descrição livre.
   * JSON malformado dispara 1 retry; persistindo, lança erro tratável.
   *
   * @param {string} description
   * @returns {Promise<{name:string, description:string, context:string, style:string, traits:string[]}>}
   */
  async generate(description) {
    const trimmed = (description ?? "").trim();
    if (!trimmed) throw new Error("PersonaGenerator: descrição vazia.");

    const prompt = PERSONA_PROMPT(trimmed);

    let parsed = await this._requestAndParse(prompt);
    if (!parsed) {
      // Retry único: o modelo às vezes devolve texto fora do JSON.
      Logger.warn("⚠️ PersonaGenerator: JSON inválido na 1ª tentativa, tentando de novo...");
      parsed = await this._requestAndParse(prompt);
    }
    if (!parsed) {
      throw new Error("PersonaGenerator: a IA não devolveu um JSON de persona válido.");
    }

    return this._validate(parsed);
  }

  /**
   * Deriva um slug em kebab-case a partir do nome, garantindo unicidade contra
   * as chaves já existentes (append -2, -3... em caso de colisão).
   * @param {string} name
   * @param {string[]} [existingKeys]
   * @returns {string}
   */
  slugify(name, existingKeys = []) {
    const base =
      (name ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // remove acentos
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "persona";

    const taken = new Set(existingKeys);
    if (!taken.has(base)) return base;

    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  /** @private — pede ao modelo e tenta extrair/parsear o JSON; null se falhar. */
  async _requestAndParse(prompt) {
    let text;
    try {
      const response = await this.aiService.generateContent([
        { role: "user", parts: [{ text: prompt }] },
      ]);
      text = response?.text ?? "";
    } catch (error) {
      Logger.error("❌ PersonaGenerator: erro ao chamar a IA:", error);
      throw error;
    }
    return this._extractJson(text);
  }

  /** @private — isola o objeto JSON do texto (tolera cercas de código). */
  _extractJson(text) {
    if (!text) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }

  /** @private — aplica limites, rejeita traits insuficientes, anexa o trait de formato. */
  _validate(raw) {
    const name = this._truncate(raw.name, LIMITS.name);
    const description = this._truncate(raw.description, LIMITS.name * 3);
    const context = this._truncate(raw.context, LIMITS.context);
    const style = this._truncate(raw.style, LIMITS.style);

    if (!name || !context || !style) {
      throw new Error("PersonaGenerator: persona incompleta (name, context ou style ausente).");
    }

    const traits = Array.isArray(raw.traits)
      ? raw.traits
          .filter((t) => typeof t === "string" && t.trim())
          .map((t) => this._truncate(t, LIMITS.trait))
          .slice(0, LIMITS.maxTraits)
      : [];

    if (traits.length < LIMITS.minTraits) {
      throw new Error(
        `PersonaGenerator: persona precisa de pelo menos ${LIMITS.minTraits} traços (recebeu ${traits.length}).`
      );
    }

    // O trait de formato é responsabilidade do sistema, nunca do modelo.
    traits.push(WHATSAPP_FORMAT_TRAIT);

    return { name, description, context, style, traits };
  }

  /** @private */
  _truncate(value, max) {
    if (typeof value !== "string") return "";
    const v = value.trim();
    return v.length > max ? v.slice(0, max).trim() : v;
  }
}
