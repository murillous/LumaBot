import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PersonaGenerator,
  WHATSAPP_FORMAT_TRAIT,
} from "../../../../src/core/services/PersonaGenerator.js";

// aiService falso: cada teste configura o que generateContent devolve.
function makeAi(...texts) {
  const generateContent = vi.fn();
  texts.forEach((t) => generateContent.mockResolvedValueOnce({ text: t, functionCalls: [] }));
  return { generateContent };
}

const validPersona = {
  name: "Luma Pirata",
  description: "🏴‍☠️ arrr",
  context: "Você é a Luma Pirata, fala como um bucaneiro do mar.",
  style: "gírias de pirata, 'arrr', sem emojis demais",
  traits: ["sempre chama o usuário de grumete", "fala de tesouros", "ameaça jogar na prancha"],
};

describe("PersonaGenerator", () => {
  let gen;

  beforeEach(() => {
    gen = null;
  });

  it("gera persona a partir de JSON válido e anexa o trait de formato", async () => {
    const ai = makeAi(JSON.stringify(validPersona));
    gen = new PersonaGenerator({ aiService: ai });

    const persona = await gen.generate("um pirata");

    expect(ai.generateContent).toHaveBeenCalledTimes(1);
    expect(persona.name).toBe("Luma Pirata");
    expect(persona.context).toContain("bucaneiro");
    // 3 traits do modelo + 1 trait de formato anexado pelo sistema.
    expect(persona.traits).toHaveLength(4);
    expect(persona.traits.at(-1)).toBe(WHATSAPP_FORMAT_TRAIT);
  });

  it("tolera JSON embrulhado em cercas de código e texto extra", async () => {
    const ai = makeAi("Claro! aqui está:\n```json\n" + JSON.stringify(validPersona) + "\n```");
    gen = new PersonaGenerator({ aiService: ai });

    const persona = await gen.generate("um pirata");
    expect(persona.name).toBe("Luma Pirata");
  });

  it("faz 1 retry quando o JSON da 1ª resposta é inválido", async () => {
    const ai = makeAi("desculpa, não entendi", JSON.stringify(validPersona));
    gen = new PersonaGenerator({ aiService: ai });

    const persona = await gen.generate("um pirata");
    expect(ai.generateContent).toHaveBeenCalledTimes(2);
    expect(persona.name).toBe("Luma Pirata");
  });

  it("lança erro tratável quando o JSON continua inválido após o retry", async () => {
    const ai = makeAi("nada de json", "ainda sem json");
    gen = new PersonaGenerator({ aiService: ai });

    await expect(gen.generate("um pirata")).rejects.toThrow(/JSON/);
    expect(ai.generateContent).toHaveBeenCalledTimes(2);
  });

  it("trunca campos que excedem os limites", async () => {
    const longName = "x".repeat(100);
    const longContext = "c".repeat(900);
    const longStyle = "s".repeat(500);
    const longTrait = "t".repeat(400);
    const ai = makeAi(
      JSON.stringify({
        ...validPersona,
        name: longName,
        context: longContext,
        style: longStyle,
        traits: [longTrait, "ok 1", "ok 2"],
      })
    );
    gen = new PersonaGenerator({ aiService: ai });

    const persona = await gen.generate("teste");
    expect(persona.name).toHaveLength(40);
    expect(persona.context).toHaveLength(600);
    expect(persona.style).toHaveLength(300);
    expect(persona.traits[0]).toHaveLength(200);
  });

  it("limita a no máximo 8 traits do modelo (+ formato)", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `trait ${i}`);
    const ai = makeAi(JSON.stringify({ ...validPersona, traits: many }));
    gen = new PersonaGenerator({ aiService: ai });

    const persona = await gen.generate("teste");
    expect(persona.traits).toHaveLength(9); // 8 do modelo + 1 de formato
    expect(persona.traits.at(-1)).toBe(WHATSAPP_FORMAT_TRAIT);
  });

  it("rejeita quando há menos de 3 traits válidos", async () => {
    const ai = makeAi(JSON.stringify({ ...validPersona, traits: ["só um", "dois"] }));
    gen = new PersonaGenerator({ aiService: ai });

    await expect(gen.generate("teste")).rejects.toThrow(/traços/);
  });

  it("rejeita descrição vazia sem chamar a IA", async () => {
    const ai = makeAi(JSON.stringify(validPersona));
    gen = new PersonaGenerator({ aiService: ai });

    await expect(gen.generate("   ")).rejects.toThrow(/vazia/);
    expect(ai.generateContent).not.toHaveBeenCalled();
  });

  describe("slugify", () => {
    beforeEach(() => {
      gen = new PersonaGenerator({ aiService: makeAi() });
    });

    it("gera slug kebab-case sem acentos", () => {
      expect(gen.slugify("Luma Pirata Atrevida")).toBe("luma-pirata-atrevida");
      expect(gen.slugify("Açaí Ção")).toBe("acai-cao");
    });

    it("garante unicidade contra chaves existentes", () => {
      expect(gen.slugify("Pirata", ["pirata"])).toBe("pirata-2");
      expect(gen.slugify("Pirata", ["pirata", "pirata-2"])).toBe("pirata-3");
    });

    it("usa fallback 'persona' quando o nome não gera caracteres válidos", () => {
      expect(gen.slugify("🏴‍☠️")).toBe("persona");
    });
  });
});
