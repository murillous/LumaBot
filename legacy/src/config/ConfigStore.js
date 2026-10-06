import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";

/**
 * Camada de override de configuração.
 *
 * Os defaults vivem no código (constants.js, lumaConfig.js). Este store lê um
 * arquivo JSON (data/config-overrides.json, fora do git) e mescla os valores
 * salvos por cima dos defaults no momento em que cada módulo de config é
 * carregado. Assim o dashboard pode reconfigurar o bot sem reescrever os
 * arquivos-fonte .js — basta gravar o override e reiniciar o bot.
 *
 * Estrutura do JSON: chaveado pelo nome do export de config.
 *   { "CONFIG": { ... }, "LUMA_CONFIG": { ... }, "MENUS": { ... } }
 *
 * Falha de leitura/parse nunca derruba o boot: loga e usa só os defaults.
 */
const OVERRIDES_PATH = path.resolve("./data/config-overrides.json");

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Deep-merge: objetos planos são mesclados recursivamente; arrays e primitivos
 * do override substituem o default por inteiro (não há merge de arrays).
 */
function deepMerge(base, override) {
  if (!isPlainObject(override)) return override;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(override)) {
    const baseValue = isPlainObject(base) ? base[key] : undefined;
    const overrideValue = override[key];
    out[key] =
      isPlainObject(baseValue) && isPlainObject(overrideValue)
        ? deepMerge(baseValue, overrideValue)
        : overrideValue;
  }
  return out;
}

function loadOverrides() {
  try {
    if (!fs.existsSync(OVERRIDES_PATH)) return {};
    const raw = fs.readFileSync(OVERRIDES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    // Override corrompido não pode derrubar o bot — segue só com os defaults.
    Logger.error("[ConfigStore] Falha ao ler overrides, usando defaults:", error);
    return {};
  }
}

let overrides = loadOverrides();

export const ConfigStore = {
  /** Retorna o objeto de overrides carregado (somente leitura lógica). */
  getOverrides() {
    return overrides;
  },

  /** Recarrega o arquivo de overrides do disco. */
  reload() {
    overrides = loadOverrides();
    return overrides;
  },

  /**
   * Mescla os overrides da seção indicada sobre os defaults fornecidos.
   * @param {string} sectionKey - Nome do export (ex: 'CONFIG', 'LUMA_CONFIG').
   * @param {object} defaults - Objeto default definido no código.
   */
  apply(sectionKey, defaults) {
    const section = overrides[sectionKey];
    if (section === undefined) return defaults;
    return deepMerge(defaults, section);
  },

  /**
   * Persiste um patch de overrides (usado pelo dashboard). Faz merge sobre o
   * que já existe e grava no disco. Retorna o objeto resultante.
   * @param {object} patch - Override parcial, chaveado por export.
   */
  save(patch) {
    if (!isPlainObject(patch)) {
      throw new Error("ConfigStore.save espera um objeto de override.");
    }
    const merged = deepMerge(overrides, patch);
    fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(merged, null, 2), "utf-8");
    overrides = merged;
    return merged;
  },

  /** Caminho absoluto do arquivo de overrides (usado pelo dashboard). */
  get path() {
    return OVERRIDES_PATH;
  },
};
