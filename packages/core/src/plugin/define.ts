import type { z } from 'zod';
import { assertCommandDefinition, type CommandDefinition } from '#commands/command.ts';
import { isBotEventName } from '#events/names.ts';
import { isCapability } from '#transport/capabilities.ts';
import { isValidRange, parseVersion } from './semver.ts';
import type { PluginDefinition, PluginMessages } from './types.ts';

/**
 * Nome de plugin: kebab-case minúsculo, começando por letra. É estável porque vira chave de
 * `disabledPlugins`, namespace de storage e prefixo de rota HTTP (`/plugins/<name>/…`).
 */
export const PLUGIN_NAME_PATTERN: RegExp = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;

/** Manifesto malformado: erro de quem escreveu o plugin, então derruba o boot. */
export class PluginManifestError extends Error {
  override readonly name = 'PluginManifestError';
  /** `name` declarado, se havia um string. */
  readonly plugin: string | undefined;
  /** De onde o plugin veio (`config` ou caminho do módulo), quando conhecido. */
  readonly origin: string | undefined;
  readonly issues: readonly string[];

  constructor(plugin: string | undefined, issues: readonly string[], origin?: string) {
    const who = plugin === undefined ? 'plugin sem nome' : `plugin "${plugin}"`;
    const where = origin === undefined ? '' : ` (${origin})`;
    super(`Manifesto inválido no ${who}${where}:\n- ${issues.join('\n- ')}`);
    this.plugin = plugin;
    this.origin = origin;
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkName(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== 'string' || !PLUGIN_NAME_PATTERN.test(value)) {
    issues.push(
      `${label} deve ser kebab-case minúsculo (ex.: "user-names"); recebido ${show(value)}`,
    );
  } else if (value.length > MAX_NAME_LENGTH) {
    issues.push(`${label} passa de ${MAX_NAME_LENGTH} caracteres`);
  }
}

const show = (value: unknown): string =>
  typeof value === 'string' ? `"${value}"` : value === undefined ? 'nada' : typeof value;

function checkNames(value: unknown, label: string, self: unknown, issues: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(`${label} deve ser uma lista de nomes de plugin`);
    return;
  }
  for (const name of value) {
    checkName(name, `${label}: item`, issues);
    if (name === self) issues.push(`${label} não pode citar o próprio plugin`);
  }
}

/**
 * `commands` do manifesto (ADR 0079). Confere aqui o que o `ctx.commands.add` só descobriria no
 * boot, para o erro sair no `definePlugin`, que aponta a linha do plugin.
 */
function checkCommands(value: unknown, issues: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push('commands deve ser um objeto nome → comando');
    return;
  }
  for (const [name, declared] of Object.entries(value)) {
    const label = `commands["${name}"]`;
    if (!isRecord(declared)) {
      issues.push(`${label} deve ser um objeto com run`);
      continue;
    }
    if (declared['name'] !== undefined) {
      issues.push(`${label}: o nome vem da chave; tire o campo name`);
    }
    if (typeof declared['run'] !== 'function') issues.push(`${label}.run deve ser uma função`);
    const { aliases, description, onReject } = declared;
    if (aliases !== undefined && !(Array.isArray(aliases) && aliases.every(isString))) {
      issues.push(`${label}.aliases deve ser uma lista de textos`);
      continue;
    }
    if (description !== undefined && typeof description !== 'string') {
      issues.push(`${label}.description deve ser um texto`);
    }
    if (onReject !== undefined && typeof onReject !== 'function') {
      issues.push(`${label}.onReject, se presente, deve ser uma função`);
    }
    try {
      assertCommandDefinition({ ...declared, name } as unknown as CommandDefinition);
    } catch (error) {
      issues.push(`${label}: ${(error as Error).message}`);
    }
  }
}

function checkListeners(value: unknown, issues: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issues.push('on deve ser um objeto evento → listener');
    return;
  }
  for (const [event, listener] of Object.entries(value)) {
    if (!isBotEventName(event)) issues.push(`on: evento desconhecido "${event}"`);
    else if (typeof listener !== 'function') issues.push(`on["${event}"] deve ser uma função`);
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** Problemas do manifesto, um por linha; lista vazia = válido. Não olha compatibilidade. */
export function manifestIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['o plugin deve ser um objeto (use definePlugin)'];
  const issues: string[] = [];
  const { name } = value;
  checkName(name, 'name', issues);

  if (typeof value['version'] !== 'string' || !parseVersion(value['version'])) {
    issues.push(`version deve ser semver (ex.: "1.2.0"); recebido ${show(value['version'])}`);
  }
  if (typeof value['engine'] !== 'string' || !isValidRange(value['engine'])) {
    issues.push(
      `engine é obrigatório e deve ser uma faixa semver do core (ex.: "^1.0.0"); recebido ${show(value['engine'])}`,
    );
  }

  const requires = value['requires'];
  if (requires !== undefined) {
    if (!Array.isArray(requires)) issues.push('requires deve ser uma lista de capabilities');
    else {
      for (const capability of requires) {
        if (typeof capability !== 'string' || !isCapability(capability)) {
          issues.push(`requires: capability desconhecida ${show(capability)}`);
        }
      }
    }
  }

  const transports = value['transports'];
  if (transports !== undefined) {
    if (
      !Array.isArray(transports) ||
      transports.length === 0 ||
      !transports.every((t) => typeof t === 'string' && t.length > 0)
    ) {
      issues.push('transports, se presente, deve ser uma lista não vazia de nomes de transport');
    }
  }

  const dependsOn = value['dependsOn'];
  if (dependsOn !== undefined) {
    if (!isRecord(dependsOn)) issues.push('dependsOn deve ser um objeto nome → faixa semver');
    else {
      for (const [dependency, range] of Object.entries(dependsOn)) {
        checkName(dependency, 'dependsOn: nome', issues);
        if (dependency === name) issues.push('dependsOn não pode citar o próprio plugin');
        if (typeof range !== 'string' || !isValidRange(range)) {
          issues.push(
            `dependsOn["${dependency}"] deve ser uma faixa semver; recebido ${show(range)}`,
          );
        }
      }
    }
  }

  checkNames(value['after'], 'after', name, issues);

  const priority = value['priority'];
  if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority))) {
    issues.push('priority deve ser um número finito');
  }

  const config = value['config'];
  if (config !== undefined && !(isRecord(config) && typeof config['safeParse'] === 'function')) {
    issues.push('config deve ser um schema Zod');
  }

  const messages = value['messages'];
  if (
    messages !== undefined &&
    !(isRecord(messages) && Object.values(messages).every((text) => typeof text === 'string'))
  ) {
    issues.push('messages deve ser um objeto chave → texto');
  }

  checkCommands(value['commands'], issues);
  checkListeners(value['on'], issues);

  // Sem `commands` nem `on`, o `setup` é o único jeito de o plugin fazer algo.
  const declares = value['commands'] !== undefined || value['on'] !== undefined;
  if (typeof value['setup'] !== 'function' && (value['setup'] !== undefined || !declares)) {
    issues.push('setup deve ser uma função (opcional quando o plugin declara commands ou on)');
  }
  if (value['teardown'] !== undefined && typeof value['teardown'] !== 'function') {
    issues.push('teardown, se presente, deve ser uma função');
  }
  return issues;
}

/** Lança `PluginManifestError` se `value` não for um plugin bem formado. */
export function assertPluginDefinition(
  value: unknown,
  origin?: string,
): asserts value is PluginDefinition {
  const issues = manifestIssues(value);
  if (issues.length === 0) return;
  const name = isRecord(value) && typeof value['name'] === 'string' ? value['name'] : undefined;
  throw new PluginManifestError(name, issues, origin);
}

/**
 * Declara um plugin. Valida o manifesto na hora (lança `PluginManifestError`) e devolve a
 * própria definição, tipada: o `ctx.config` de `setup`/`teardown` sai de `z.output` do schema
 * em `config`, e `ctx.plugin.messages` tem as chaves de `messages`.
 */
export function definePlugin<
  TSchema extends z.ZodType = z.ZodType,
  TMessages extends PluginMessages = PluginMessages,
>(definition: PluginDefinition<TSchema, TMessages>): PluginDefinition<TSchema, TMessages> {
  assertPluginDefinition(definition);
  return definition;
}
