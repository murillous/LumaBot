import { LUMA_CONFIG } from "../config/lumaConfig.js";
import { DatabaseService } from "../services/Database.js";

/**
 * Prefixo interno das chaves de personas custom no armazenamento (chat_settings)
 * e na listagem. Garante que uma key custom nunca colida com uma predefinida.
 */
export const CUSTOM_PREFIX = "custom:";

export class PersonalityManager {

  /**
   * Resolve a config da persona ativa do chat na ordem:
   * custom do chat -> predefinida -> DEFAULT_PERSONALITY.
   * Sempre devolve o shape { name, description, context, style, traits[] }.
   */
  static getPersonaConfig(jid) {
    const savedKey = DatabaseService.getPersonality(jid);

    // Key custom: prefixo 'custom:' aponta para uma persona do próprio chat.
    if (typeof savedKey === "string" && savedKey.startsWith(CUSTOM_PREFIX)) {
      const custom = DatabaseService.getCustomPersona(jid, savedKey.slice(CUSTOM_PREFIX.length));
      if (custom) {
        return {
          name: custom.name,
          description: custom.description,
          context: custom.context,
          style: custom.style,
          traits: custom.traits,
        };
      }
      // Custom não existe mais (ex: foi deletada) -> cai no padrão.
    }

    const key = savedKey || LUMA_CONFIG.DEFAULT_PERSONALITY;
    return LUMA_CONFIG.PERSONALITIES[key] || LUMA_CONFIG.PERSONALITIES[LUMA_CONFIG.DEFAULT_PERSONALITY];
  }

  /**
   * Define a persona ativa do chat. Aceita chaves predefinidas ou chaves custom
   * (prefixo 'custom:'), validando estas contra as personas custom do próprio chat.
   * Retorna true se a key é válida e foi persistida.
   */
  static setPersonality(jid, key) {
    if (LUMA_CONFIG.PERSONALITIES[key]) {
      DatabaseService.setPersonality(jid, key);
      return true;
    }

    if (typeof key === "string" && key.startsWith(CUSTOM_PREFIX)) {
      const exists = DatabaseService.getCustomPersona(jid, key.slice(CUSTOM_PREFIX.length));
      if (exists) {
        DatabaseService.setPersonality(jid, key);
        return true;
      }
    }

    return false;
  }

  static getActiveName(jid) {
    const config = this.getPersonaConfig(jid);
    return config.name;
  }

  /**
   * Lista predefinidas + custom do chat. Cada item carrega `isCustom` marcando
   * a origem. Custom recebem o prefixo 'custom:' na key. Sem jid, lista só as
   * predefinidas (compatível com chamadas sem contexto de chat).
   */
  static getList(jid) {
    const predefined = Object.entries(LUMA_CONFIG.PERSONALITIES).map(([key, data]) => ({
      key,
      name: data.name,
      desc: data.description,
      isCustom: false,
    }));

    const custom = jid
      ? DatabaseService.getCustomPersonas(jid).map((p) => ({
          key: `${CUSTOM_PREFIX}${p.key}`,
          name: p.name,
          desc: p.description,
          isCustom: true,
        }))
      : [];

    return [...predefined, ...custom];
  }
}
