import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocka o DatabaseService para isolar a lógica de resolução do SQLite.
const mockGetWaUser = vi.fn();
const mockUpsert = vi.fn();
const mockSetNickname = vi.fn();

vi.mock("../../../../src/services/Database.js", () => ({
  DatabaseService: {
    getWaUser: (...a) => mockGetWaUser(...a),
    upsertWaUser: (...a) => mockUpsert(...a),
    setNickname: (...a) => mockSetNickname(...a),
  },
}));

vi.mock("../../../../src/utils/Logger.js", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { UserResolver } = await import("../../../../src/core/services/UserResolver.js");

describe("UserResolver.getDisplayName — prioridade de exibição", () => {
  beforeEach(() => {
    mockGetWaUser.mockReset();
    mockUpsert.mockReset();
    mockSetNickname.mockReset();
  });

  it("apelido manual tem prioridade máxima", () => {
    const profile = {
      jid: "x@s.whatsapp.net",
      bot_nickname: "Murilo",
      push_name: "Mu",
      notify_name: "M",
    };
    expect(UserResolver.getDisplayName(profile)).toBe("Murilo");
  });

  it("usa pushName quando não há apelido", () => {
    const profile = { jid: "x@s.whatsapp.net", push_name: "João", contact_name: "J" };
    expect(UserResolver.getDisplayName(profile)).toBe("João");
  });

  it("respeita a ordem notify → contato → verificado", () => {
    expect(
      UserResolver.getDisplayName({ jid: "x@s", notify_name: "N", contact_name: "C" })
    ).toBe("N");
    expect(UserResolver.getDisplayName({ jid: "x@s", contact_name: "C" })).toBe("C");
    expect(UserResolver.getDisplayName({ jid: "x@s", verified_name: "V" })).toBe("V");
  });

  it("ignora nomes vazios e cai para o próximo", () => {
    const profile = { jid: "551199@s.whatsapp.net", bot_nickname: "  ", push_name: "Real" };
    expect(UserResolver.getDisplayName(profile)).toBe("Real");
  });

  it("fallback usa os últimos 6 dígitos quando não há nome", () => {
    expect(UserResolver.getDisplayName({ jid: "5511987654321@s.whatsapp.net" })).toBe("@654321");
  });

  it("consulta o banco quando recebe um JID (string)", () => {
    mockGetWaUser.mockReturnValue({ jid: "y@s", push_name: "Ana" });
    expect(UserResolver.getDisplayName("y@s")).toBe("Ana");
    expect(mockGetWaUser).toHaveBeenCalledWith("y@s");
  });

  it("fallback para JID sem perfil no banco", () => {
    mockGetWaUser.mockReturnValue(null);
    expect(UserResolver.getDisplayName("5511999999@s.whatsapp.net")).toBe("@999999");
  });

  it("trata JID @lid e dispositivo linkado no fallback", () => {
    expect(UserResolver.getDisplayName({ jid: "12345678:9@lid" })).toBe("@345678");
  });
});

describe("UserResolver — enriquecimento", () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockSetNickname.mockReset();
  });

  it("upsertFromMessage delega pushName ao DatabaseService", () => {
    UserResolver.upsertFromMessage("a@s", { pushName: "Bia" });
    expect(mockUpsert).toHaveBeenCalledWith("a@s", { pushName: "Bia" });
  });

  it("upsertFromContact mapeia campos do contato Baileys", () => {
    UserResolver.upsertFromContact({ id: "c@s", name: "Carlos", notify: "C", lid: "9@lid" });
    expect(mockUpsert).toHaveBeenCalledWith("c@s", {
      lid: "9@lid",
      phoneNumber: undefined,
      contactName: "Carlos",
      notifyName: "C",
      verifiedName: undefined,
    });
  });

  it("upsertFromContact ignora contato sem id", () => {
    UserResolver.upsertFromContact({ name: "sem id" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("register cria registro básico do JID mencionado", () => {
    UserResolver.register("m@s");
    expect(mockUpsert).toHaveBeenCalledWith("m@s", {});
  });

  it("setNickname delega ao DatabaseService", () => {
    UserResolver.setNickname("z@s", "Zé");
    expect(mockSetNickname).toHaveBeenCalledWith("z@s", "Zé");
  });
});
