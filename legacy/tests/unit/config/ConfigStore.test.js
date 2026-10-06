import { describe, it, expect, vi, beforeEach } from "vitest";

// Sistema de arquivos em memória para isolar o teste do disco real.
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

const { ConfigStore } = await import("../../../src/config/ConfigStore.js");

describe("ConfigStore", () => {
  beforeEach(() => {
    files.clear();
    ConfigStore.reload();
  });

  it("retorna os defaults quando não há override da seção", () => {
    expect(ConfigStore.apply("CONFIG", { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("mescla o override sobre o default (deep merge de objetos)", () => {
    ConfigStore.save({ CONFIG: { b: 99, c: { d: 1 } } });
    expect(
      ConfigStore.apply("CONFIG", { a: 1, b: 2, c: { d: 0, e: 5 } })
    ).toEqual({ a: 1, b: 99, c: { d: 1, e: 5 } });
  });

  it("array do override substitui o array default por inteiro", () => {
    ConfigStore.save({ X: { list: [9] } });
    expect(ConfigStore.apply("X", { list: [1, 2, 3] })).toEqual({ list: [9] });
  });

  it("não muta o objeto de defaults original", () => {
    const defaults = { a: 1, nested: { x: 1 } };
    ConfigStore.save({ S: { nested: { x: 2 } } });
    ConfigStore.apply("S", defaults);
    expect(defaults).toEqual({ a: 1, nested: { x: 1 } });
  });

  it("parse inválido cai para os defaults sem lançar", () => {
    files.set(ConfigStore.path, "{ json quebrado");
    ConfigStore.reload();
    expect(ConfigStore.apply("CONFIG", { a: 1 })).toEqual({ a: 1 });
  });

  it("save persiste o override e reflete em getOverrides", () => {
    ConfigStore.save({ CONFIG: { a: 42 } });
    expect(ConfigStore.getOverrides()).toEqual({ CONFIG: { a: 42 } });
  });

  it("save rejeita argumento que não é objeto", () => {
    expect(() => ConfigStore.save("nope")).toThrow();
  });
});
