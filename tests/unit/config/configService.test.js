import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// FS em memória para isolar do disco real (.env + config-overrides.json).
const files = new Map();

vi.mock("fs", () => {
  const api = {
    existsSync: vi.fn((p) => files.has(p)),
    readFileSync: vi.fn((p) => {
      if (!files.has(p)) throw new Error("ENOENT");
      return files.get(p);
    }),
    writeFileSync: vi.fn((p, data) => {
      files.set(p, data);
    }),
    mkdirSync: vi.fn(),
  };
  return { default: api, ...api };
});

// dotenv.config não deve tocar process.env durante os testes.
vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

const { readConfig, writeConfig } = await import("../../../src/config/configService.js");

describe("configService", () => {
  beforeEach(() => {
    files.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function fieldValue(config, key) {
    for (const group of config.groups) {
      const field = group.fields.find((f) => f.key === key);
      if (field) return field.value;
    }
    return undefined;
  }

  it("reflete um override de config recém-salvo no próximo readConfig (não volta ao default)", () => {
    const key = "TECHNICAL.generationConfig.temperature";
    const before = fieldValue(readConfig(), key);

    writeConfig([{ key, source: "config", section: "LUMA_CONFIG", value: before + 0.3 }]);

    expect(fieldValue(readConfig(), key)).toBe(before + 0.3);
  });

  it("reflete uma env recém-salva no próximo readConfig", () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    writeConfig([{ key: "AI_PROVIDER", source: "env", value: "openai" }]);

    expect(fieldValue(readConfig(), "AI_PROVIDER")).toBe("openai");
  });
});
