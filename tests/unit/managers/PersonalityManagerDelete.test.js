import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Testes do PersonalityManager.deletePersona (US-005).
 *
 * Mocka o DatabaseService para isolar a lógica de deleção/fallback da ativa
 * — sem tocar no SQLite.
 */

let mockGetPersonality = vi.fn().mockReturnValue(null);
let mockSetPersonality = vi.fn();
let mockDeleteCustomPersona = vi.fn().mockReturnValue(false);

vi.mock("../../../src/services/Database.js", () => ({
  DatabaseService: {
    get getPersonality() { return mockGetPersonality; },
    get setPersonality() { return mockSetPersonality; },
    get deleteCustomPersona() { return mockDeleteCustomPersona; },
  },
}));

import { PersonalityManager, CUSTOM_PREFIX } from "../../../src/managers/PersonalityManager.js";
import { LUMA_CONFIG } from "../../../src/config/lumaConfig.js";

const JID = "chat@g.us";

beforeEach(() => {
  mockGetPersonality = vi.fn().mockReturnValue(null);
  mockSetPersonality = vi.fn();
  mockDeleteCustomPersona = vi.fn().mockReturnValue(false);
});

describe("deletePersona — deleção de custom", () => {
  it("remove custom existente e retorna deleted true", () => {
    mockDeleteCustomPersona = vi.fn().mockReturnValue(true);

    const result = PersonalityManager.deletePersona(JID, `${CUSTOM_PREFIX}batman`);

    expect(mockDeleteCustomPersona).toHaveBeenCalledWith(JID, "batman");
    expect(result).toEqual({ deleted: true, wasActive: false });
  });

  it("retorna not_found quando a custom não existe no chat", () => {
    mockDeleteCustomPersona = vi.fn().mockReturnValue(false);

    const result = PersonalityManager.deletePersona(JID, `${CUSTOM_PREFIX}fantasma`);

    expect(result).toEqual({ deleted: false, reason: "not_found" });
    expect(mockSetPersonality).not.toHaveBeenCalled();
  });
});

describe("deletePersona — recusa predefinida", () => {
  it("recusa key predefinida sem chamar o DB", () => {
    const result = PersonalityManager.deletePersona(JID, "pensadora");

    expect(result).toEqual({ deleted: false, reason: "predefined" });
    expect(mockDeleteCustomPersona).not.toHaveBeenCalled();
  });

  it("recusa key sem prefixo custom que não é predefinida", () => {
    const result = PersonalityManager.deletePersona(JID, "lixo");

    expect(result).toEqual({ deleted: false, reason: "not_custom" });
    expect(mockDeleteCustomPersona).not.toHaveBeenCalled();
  });
});

describe("deletePersona — fallback quando deleta a ativa", () => {
  it("volta para DEFAULT_PERSONALITY se a deletada era a ativa", () => {
    mockDeleteCustomPersona = vi.fn().mockReturnValue(true);
    mockGetPersonality = vi.fn().mockReturnValue(`${CUSTOM_PREFIX}batman`);

    const result = PersonalityManager.deletePersona(JID, `${CUSTOM_PREFIX}batman`);

    expect(result).toEqual({ deleted: true, wasActive: true });
    expect(mockSetPersonality).toHaveBeenCalledWith(JID, LUMA_CONFIG.DEFAULT_PERSONALITY);
  });

  it("não altera a ativa se a deletada não era a ativa", () => {
    mockDeleteCustomPersona = vi.fn().mockReturnValue(true);
    mockGetPersonality = vi.fn().mockReturnValue(`${CUSTOM_PREFIX}outra`);

    const result = PersonalityManager.deletePersona(JID, `${CUSTOM_PREFIX}batman`);

    expect(result).toEqual({ deleted: true, wasActive: false });
    expect(mockSetPersonality).not.toHaveBeenCalled();
  });
});
