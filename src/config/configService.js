import dotenv from "dotenv";
import { ConfigStore } from "./ConfigStore.js";
import { EnvStore } from "./EnvStore.js";
import { CONFIG_SCHEMA, EDITABLE_ENV_KEYS, SECRET_KEYS, flattenSchemaFields } from "./configSchema.js";
import { CONFIG, MENUS, MESSAGES } from "./constants.js";
import { LUMA_CONFIG } from "./lumaConfig.js";

/**
 * Serviço de configuração consumido pelo dashboard.
 *
 * Lê os valores atuais (env + overrides mesclados) e grava alterações:
 * env vai para o .env (e atualiza process.env para o próximo spawn do bot),
 * config vai para o ConfigStore (override JSON). As mudanças entram em vigor
 * no restart do bot.
 */

const SECTIONS = { CONFIG, LUMA_CONFIG, MENUS, MESSAGES };

function getByPath(obj, dottedPath) {
  return dottedPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function maskSecret(value) {
  if (!value) return "";
  const str = String(value);
  if (str.length <= 4) return "••••";
  return `••••${str.slice(-4)}`;
}

/** Valor atual de um campo do schema (secrets mascarados). */
function readFieldValue(field) {
  if (field.source === "env") {
    const raw = process.env[field.key];
    if (field.type === "secret") return raw ? maskSecret(raw) : "";
    if (field.type === "boolean") return raw === "true";
    if (field.type === "number") return raw != null && raw !== "" ? Number(raw) : "";
    return raw ?? "";
  }
  // Prefere o override vivo (recém-salvo) sobre o snapshot importado no boot:
  // SECTIONS é congelado no load do módulo, então sem isto o dashboard mostraria
  // o valor de boot e parecia "voltar ao default" após salvar.
  const liveOverrides = ConfigStore.getOverrides()[field.section];
  const overrideValue = liveOverrides ? getByPath(liveOverrides, field.key) : undefined;
  const section = SECTIONS[field.section];
  const value = overrideValue !== undefined ? overrideValue : section ? getByPath(section, field.key) : undefined;
  if (field.type === "secret") return value ? maskSecret(value) : "";
  return value ?? (field.type === "boolean" ? false : "");
}

/** Retorna o schema com os valores atuais preenchidos em cada campo. */
export function readConfig() {
  // Re-sincroniza com o disco: overrides (config) e .env (env) podem ter mudado
  // desde o boot do dashboard. Sem isto o painel reflete só o estado inicial.
  ConfigStore.reload();
  dotenv.config({ override: true });
  // Overrides de env (data/env-overrides.json) prevalecem sobre o .env — mesma
  // ordem do boot do bot, para o painel mostrar o que de fato vale.
  EnvStore.reload();
  EnvStore.applyToProcessEnv();

  const groups = CONFIG_SCHEMA.groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => ({ ...field, value: readFieldValue(field) })),
  }));
  return { groups };
}

/**
 * Persiste alterações de env no EnvStore (data/env-overrides.json, gravável) em
 * vez do .env — em produção o .env é read-only (EROFS). Também atualiza o
 * process.env do dashboard para o próximo spawn do bot herdar o novo valor.
 */
function updateEnvFile(updates) {
  EnvStore.save(updates);
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value == null ? "" : String(value);
  }
}

/** Constrói o objeto aninhado {section: {a: {b: value}}} a partir de um path. */
function nestPath(section, dottedPath, value) {
  const keys = dottedPath.split(".");
  const root = {};
  let cursor = root;
  keys.forEach((key, i) => {
    cursor[key] = i === keys.length - 1 ? value : {};
    cursor = cursor[key];
  });
  return { [section]: root };
}

/**
 * Aplica alterações de configuração.
 * @param {Array<{key:string, source:string, section?:string, value:any}>} changes
 */
export function writeConfig(changes) {
  if (!Array.isArray(changes)) throw new Error("changes deve ser um array");

  const fieldsByKey = new Map(flattenSchemaFields().map((f) => [`${f.source}:${f.section ?? "env"}:${f.key}`, f]));

  const envUpdates = {};
  let configOverride = {};

  for (const change of changes) {
    const id = `${change.source}:${change.section ?? "env"}:${change.key}`;
    const field = fieldsByKey.get(id);
    if (!field) continue; // ignora chaves fora do schema (whitelist)

    if (field.source === "env") {
      if (!EDITABLE_ENV_KEYS.has(field.key)) continue;
      // Secret mascarado não foi alterado → não sobrescreve com a máscara.
      if (field.type === "secret" && String(change.value).startsWith("••••")) continue;
      let value = change.value;
      if (field.type === "boolean") value = value ? "true" : "false";
      envUpdates[field.key] = value;
    } else {
      if (field.type === "secret" && String(change.value).startsWith("••••")) continue;
      configOverride = deepMergeLocal(configOverride, nestPath(field.section, field.key, change.value));
    }
  }

  if (Object.keys(envUpdates).length > 0) updateEnvFile(envUpdates);
  if (Object.keys(configOverride).length > 0) ConfigStore.save(configOverride);

  return { ok: true };
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepMergeLocal(base, override) {
  if (!isPlainObject(override)) return override;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(override)) {
    out[key] =
      isPlainObject(base?.[key]) && isPlainObject(override[key])
        ? deepMergeLocal(base[key], override[key])
        : override[key];
  }
  return out;
}

export { SECRET_KEYS };
