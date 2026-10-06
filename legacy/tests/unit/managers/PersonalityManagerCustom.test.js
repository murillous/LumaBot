import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes do PersonalityManager com personas CUSTOM (US-004).
 *
 * Mocka o DatabaseService para isolar a lógica de resolução/listagem/merge
 * entre personas predefinidas e custom — sem tocar no SQLite.
 */

let mockGetPersonality = vi.fn().mockReturnValue(null);
let mockGetCustomPersona = vi.fn().mockReturnValue(null);
let mockGetCustomPersonas = vi.fn().mockReturnValue([]);
let mockSetPersonality = vi.fn();

vi.mock("../../../src/services/Database.js", () => ({
  DatabaseService: {
    get getPersonality() { return mockGetPersonality; },
    get getCustomPersona() { return mockGetCustomPersona; },
    get getCustomPersonas() { return mockGetCustomPersonas; },
    get setPersonality() { return mockSetPersonality; },
  },
}));

import { PersonalityManager, CUSTOM_PREFIX } from "../../../src/managers/PersonalityManager.js";
import { LUMA_CONFIG } from "../../../src/config/lumaConfig.js";

const JID = "chat@g.us";

const fakeCustom = {
  id: 1,
  key: "batman",
  name: "Luma Morcego",
  description: "🦇 sombria e justiceira",
  context: "Você é a vingança da noite.",
  style: "grave, frases curtas",
  traits: ["nunca sorri", "fala em terceira pessoa", "obcecada por justiça"],
  createdAt: "2026-06-17",
};

beforeEach(() => {
  mockGetPersonality = vi.fn().mockReturnValue(null);
  mockGetCustomPersona = vi.fn().mockReturnValue(null);
  mockGetCustomPersonas = vi.fn().mockReturnValue([]);
  mockSetPersonality = vi.fn();
});

describe("getPersonaConfig — resolução nas 3 ordens", () => {
  it("custom do chat tem prioridade quando a key salva é custom e existe", () => {
    mockGetPersonality = vi.fn().mockReturnValue(`${CUSTOM_PREFIX}batman`);
    mockGetCustomPersona = vi.fn().mockReturnValue(fakeCustom);

    const config = PersonalityManager.getPersonaConfig(JID);

    expect(mockGetCustomPersona).toHaveBeenCalledWith(JID, "batman");
    expect(config).toEqual({
      name: fakeCustom.name,
      description: fakeCustom.description,
      context: fakeCustom.context,
      style: fakeCustom.style,
      traits: fakeCustom.traits,
    });
  });

  it("cai na predefinida quando a key salva é predefinida", () => {
    mockGetPersonality = vi.fn().mockReturnValue("agressiva");

    const config = PersonalityManager.getPersonaConfig(JID);

    expect(config.name).toBe(LUMA_CONFIG.PERSONALITIES.agressiva.name);
  });

  it("cai no DEFAULT quando não há nada salvo", () => {
    const config = PersonalityManager.getPersonaConfig(JID);

    const def = LUMA_CONFIG.PERSONALITIES[LUMA_CONFIG.DEFAULT_PERSONALITY];
    expect(config.name).toBe(def.name);
  });

  it("cai no DEFAULT quando a key custom salva não existe mais", () => {
    mockGetPersonality = vi.fn().mockReturnValue(`${CUSTOM_PREFIX}fantasma`);
    mockGetCustomPersona = vi.fn().mockReturnValue(null);

    const config = PersonalityManager.getPersonaConfig(JID);

    const def = LUMA_CONFIG.PERSONALITIES[LUMA_CONFIG.DEFAULT_PERSONALITY];
    expect(config.name).toBe(def.name);
  });
});

describe("setPersonality — aceita chave custom", () => {
  it("persiste e retorna true para chave predefinida", () => {
    const ok = PersonalityManager.setPersonality(JID, "pensadora");
    expect(ok).toBe(true);
    expect(mockSetPersonality).toHaveBeenCalledWith(JID, "pensadora");
  });

  it("persiste e retorna true para chave custom existente no chat", () => {
    mockGetCustomPersona = vi.fn().mockReturnValue(fakeCustom);

    const ok = PersonalityManager.setPersonality(JID, `${CUSTOM_PREFIX}batman`);

    expect(ok).toBe(true);
    expect(mockGetCustomPersona).toHaveBeenCalledWith(JID, "batman");
    expect(mockSetPersonality).toHaveBeenCalledWith(JID, `${CUSTOM_PREFIX}batman`);
  });

  it("retorna false para chave custom inexistente no chat", () => {
    mockGetCustomPersona = vi.fn().mockReturnValue(null);

    const ok = PersonalityManager.setPersonality(JID, `${CUSTOM_PREFIX}naoexiste`);

    expect(ok).toBe(false);
    expect(mockSetPersonality).not.toHaveBeenCalled();
  });

  it("retorna false para chave sem prefixo que não é predefinida", () => {
    const ok = PersonalityManager.setPersonality(JID, "lixo");
    expect(ok).toBe(false);
    expect(mockSetPersonality).not.toHaveBeenCalled();
  });
});

describe("getList — merge predefinida + custom", () => {
  it("mescla predefinidas e custom do chat, marcando origem", () => {
    mockGetCustomPersonas = vi.fn().mockReturnValue([fakeCustom]);

    const list = PersonalityManager.getList(JID);

    const predefCount = Object.keys(LUMA_CONFIG.PERSONALITIES).length;
    expect(list).toHaveLength(predefCount + 1);

    list.slice(0, predefCount).forEach((item) => expect(item.isCustom).toBe(false));

    const customItem = list[list.length - 1];
    expect(customItem).toEqual({
      key: `${CUSTOM_PREFIX}batman`,
      name: fakeCustom.name,
      desc: fakeCustom.description,
      isCustom: true,
    });
  });

  it("sem jid lista apenas as predefinidas", () => {
    const list = PersonalityManager.getList();

    const predefKeys = Object.keys(LUMA_CONFIG.PERSONALITIES);
    expect(list).toHaveLength(predefKeys.length);
    expect(list.every((item) => item.isCustom === false)).toBe(true);
    expect(mockGetCustomPersonas).not.toHaveBeenCalled();
  });
});
