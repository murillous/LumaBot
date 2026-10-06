import { describe, it, expect, afterEach } from "vitest";
import { DatabaseService } from "../../../src/services/Database.js";

// better-sqlite3 abre os arquivos reais (./data) no import; usamos JIDs fake
// e limpamos após cada teste para não poluir os dados reais.
const CHAT_A = "test-persona-chat-a@g.us";
const CHAT_B = "test-persona-chat-b@g.us";

function persona(overrides = {}) {
  return {
    key: "custom:guru",
    name: "Guru",
    description: "Um mentor calmo",
    context: "Responde sempre com sabedoria",
    style: "Tom sereno",
    traits: ["paciente", "sábio", "direto"],
    ...overrides,
  };
}

describe("DatabaseService — custom_personas CRUD", () => {
  afterEach(() => {
    DatabaseService.getCustomPersonas(CHAT_A).forEach((p) =>
      DatabaseService.deleteCustomPersona(CHAT_A, p.key)
    );
    DatabaseService.getCustomPersonas(CHAT_B).forEach((p) =>
      DatabaseService.deleteCustomPersona(CHAT_B, p.key)
    );
  });

  it("cria e busca persona individual com traits desserializado", () => {
    DatabaseService.createCustomPersona(CHAT_A, persona());

    const found = DatabaseService.getCustomPersona(CHAT_A, "custom:guru");
    expect(found).not.toBeNull();
    expect(found.name).toBe("Guru");
    expect(found.traits).toEqual(["paciente", "sábio", "direto"]);
  });

  it("getCustomPersona retorna null quando não existe", () => {
    expect(DatabaseService.getCustomPersona(CHAT_A, "custom:inexistente")).toBeNull();
  });

  it("getCustomPersonas lista somente as personas do chat", () => {
    DatabaseService.createCustomPersona(CHAT_A, persona({ key: "custom:um", name: "Um" }));
    DatabaseService.createCustomPersona(CHAT_A, persona({ key: "custom:dois", name: "Dois" }));
    DatabaseService.createCustomPersona(CHAT_B, persona({ key: "custom:outro", name: "Outro" }));

    const listA = DatabaseService.getCustomPersonas(CHAT_A);
    expect(listA.map((p) => p.key).sort()).toEqual(["custom:dois", "custom:um"]);
    expect(DatabaseService.getCustomPersonas(CHAT_B)).toHaveLength(1);
  });

  it("respeita UNIQUE (chat_jid, key) — key duplicada no mesmo chat lança", () => {
    DatabaseService.createCustomPersona(CHAT_A, persona());
    expect(() => DatabaseService.createCustomPersona(CHAT_A, persona())).toThrow();
  });

  it("permite a mesma key em chats diferentes", () => {
    DatabaseService.createCustomPersona(CHAT_A, persona());
    expect(() => DatabaseService.createCustomPersona(CHAT_B, persona())).not.toThrow();
    expect(DatabaseService.getCustomPersona(CHAT_B, "custom:guru")).not.toBeNull();
  });

  it("countCustomPersonas conta apenas o chat", () => {
    expect(DatabaseService.countCustomPersonas(CHAT_A)).toBe(0);
    DatabaseService.createCustomPersona(CHAT_A, persona({ key: "custom:um" }));
    DatabaseService.createCustomPersona(CHAT_A, persona({ key: "custom:dois" }));
    expect(DatabaseService.countCustomPersonas(CHAT_A)).toBe(2);
    expect(DatabaseService.countCustomPersonas(CHAT_B)).toBe(0);
  });

  it("deleteCustomPersona remove e retorna booleano", () => {
    DatabaseService.createCustomPersona(CHAT_A, persona());
    expect(DatabaseService.deleteCustomPersona(CHAT_A, "custom:guru")).toBe(true);
    expect(DatabaseService.getCustomPersona(CHAT_A, "custom:guru")).toBeNull();
    expect(DatabaseService.deleteCustomPersona(CHAT_A, "custom:guru")).toBe(false);
  });
});
