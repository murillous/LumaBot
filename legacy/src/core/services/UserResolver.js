import { DatabaseService } from "../../services/Database.js";
import { Logger } from "../../utils/Logger.js";

/**
 * Camada de resolução de usuários por JID.
 *
 * O WhatsApp não garante um nome humano a partir de um JID arbitrário, então
 * não tentamos converter JID→nome em tempo real. Em vez disso usamos o JID/LID
 * como identidade técnica estável e enriquecemos o perfil ao longo do tempo
 * (mensagens, eventos de contato, metadata de grupo, menções). O melhor nome
 * disponível é escolhido na hora da exibição.
 *
 * Prioridade de exibição: apelido manual → pushName → notify → contato →
 * verificado → fallback baseado no identificador técnico.
 */
export class UserResolver {
  /** Enriquece o perfil a partir de uma mensagem recebida. */
  static upsertFromMessage(jid, { pushName } = {}) {
    try {
      DatabaseService.upsertWaUser(jid, { pushName });
    } catch (error) {
      Logger.error("[UserResolver] Falha ao salvar usuário da mensagem:", error);
    }
  }

  /** Enriquece o perfil a partir de um evento de contato do Baileys. */
  static upsertFromContact(contact = {}) {
    if (!contact?.id) return;
    try {
      DatabaseService.upsertWaUser(contact.id, {
        lid: contact.lid,
        phoneNumber: contact.phoneNumber,
        contactName: contact.name,
        notifyName: contact.notify,
        verifiedName: contact.verifiedName,
      });
    } catch (error) {
      Logger.error("[UserResolver] Falha ao salvar contato:", error);
    }
  }

  /** Cria um registro básico para um JID mencionado (sem nome ainda). */
  static register(jid) {
    if (!jid) return;
    try {
      DatabaseService.upsertWaUser(jid, {});
    } catch (error) {
      Logger.error("[UserResolver] Falha ao registrar menção:", error);
    }
  }

  /** Define o apelido manual — prioridade máxima na exibição. */
  static setNickname(jid, nickname) {
    DatabaseService.setNickname(jid, nickname);
  }

  static getUser(jid) {
    return DatabaseService.getWaUser(jid);
  }

  /**
   * Escolhe o melhor nome de exibição a partir de um perfil ou JID.
   * @param {string|object} jidOrProfile - JID (consulta o banco) ou perfil já carregado.
   */
  static getDisplayName(jidOrProfile) {
    const profile =
      typeof jidOrProfile === "string"
        ? DatabaseService.getWaUser(jidOrProfile)
        : jidOrProfile;
    const jid =
      typeof jidOrProfile === "string" ? jidOrProfile : profile?.jid;

    if (profile) {
      const name = this.pickName(profile);
      if (name) return name;
    }
    return this.fallbackFromJid(jid);
  }

  /** Retorna o primeiro nome não-vazio na ordem de prioridade, ou null. */
  static pickName(profile) {
    const candidates = [
      profile.bot_nickname,
      profile.push_name,
      profile.notify_name,
      profile.contact_name,
      profile.verified_name,
    ];
    for (const candidate of candidates) {
      if (candidate && String(candidate).trim() !== "") return String(candidate);
    }
    return null;
  }

  /**
   * Fallback seguro quando nenhum nome humano está disponível.
   * Usa os últimos 6 dígitos do identificador técnico — nunca o nome,
   * pois nome não é identidade.
   */
  static fallbackFromJid(jid) {
    const raw = String(jid || "").split("@")[0].split(":")[0];
    const cleaned = raw.replace(/\D/g, "") || raw;
    return cleaned.length > 6 ? `@${cleaned.slice(-6)}` : `@${cleaned}`;
  }
}
