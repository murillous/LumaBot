import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";

/**
 * Camada de override de variáveis de ambiente.
 *
 * Em produção o bot roda num container com filesystem read-only: o `.env` é
 * baked na imagem e não pode ser reescrito (EROFS). Apenas `data/` é um volume
 * gravável. Então as edições de env feitas pelo dashboard vão para um JSON em
 * `data/env-overrides.json` e são aplicadas POR CIMA do `.env` no boot.
 *
 * Estrutura do JSON: { "CHAVE": "valor", ... } — valores sempre string.
 *
 * Falha de leitura/parse nunca derruba o boot: loga e segue só com o `.env`.
 */
const OVERRIDES_PATH = path.resolve("./data/env-overrides.json");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function load() {
  try {
    if (!fs.existsSync(OVERRIDES_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(OVERRIDES_PATH, "utf-8"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    Logger.error("[EnvStore] Falha ao ler env-overrides, usando só o .env:", error);
    return {};
  }
}

let overrides = load();

export const EnvStore = {
  /** Recarrega o arquivo de overrides do disco. */
  reload() {
    overrides = load();
    return overrides;
  },

  /** Objeto de overrides carregado (somente leitura lógica). */
  getOverrides() {
    return overrides;
  },

  /**
   * Aplica os overrides em process.env. Por padrão sobrescreve o que veio do
   * `.env` — esse é justamente o ponto: o dashboard tem prioridade sobre a imagem.
   */
  applyToProcessEnv() {
    for (const [key, value] of Object.entries(overrides)) {
      process.env[key] = value == null ? "" : String(value);
    }
  },

  /**
   * Persiste um patch de overrides (usado pelo dashboard). Faz merge sobre o que
   * já existe, grava no disco (em `data/`, gravável) e atualiza process.env.
   * @param {Record<string, unknown>} updates
   */
  save(updates) {
    if (!isPlainObject(updates)) {
      throw new Error("EnvStore.save espera um objeto { CHAVE: valor }.");
    }
    const merged = { ...overrides };
    for (const [key, value] of Object.entries(updates)) {
      merged[key] = value == null ? "" : String(value);
    }
    fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(merged, null, 2), "utf-8");
    overrides = merged;
    return merged;
  },

  /** Caminho absoluto do arquivo de overrides. */
  get path() {
    return OVERRIDES_PATH;
  },
};
