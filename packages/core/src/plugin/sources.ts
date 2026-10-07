import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginDefinition } from './types.ts';

/**
 * Plugin a carregar e de onde veio. As duas fontes (ADR 0007) produzem a mesma `definition`;
 * `origin` só serve para mensagens de erro e para a tabela de boot.
 */
export interface PluginEntry {
  readonly definition: PluginDefinition;
  /** `'config'` para a lista da config; caminho absoluto do módulo para `pluginDirs`. */
  readonly origin: string;
}

/** Falha ao ler uma pasta de plugins ou importar um módulo dela. Erro no boot. */
export class PluginDiscoveryError extends Error {
  override readonly name = 'PluginDiscoveryError';
  readonly path: string;

  constructor(path: string, message: string, cause?: unknown) {
    super(`pluginDirs: ${message} (${path})`, { cause });
    this.path = path;
  }
}

const MODULE_EXTENSIONS = ['.ts', '.mts', '.js', '.mjs'];

/** Arquivos que convivem na pasta sem serem plugin: testes, tipos e helpers com `_`/`.`. */
function isIgnored(name: string): boolean {
  return (
    name.startsWith('.') ||
    name.startsWith('_') ||
    name.endsWith('.d.ts') ||
    name.endsWith('.d.mts') ||
    /\.(test|spec)\.[cm]?[jt]s$/.test(name)
  );
}

/** Duck typing de propósito: o core instalado no app pode ser outra cópia que a do plugin. */
const looksLikePlugin = (value: unknown): value is PluginDefinition =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string' &&
  typeof (value as { setup?: unknown }).setup === 'function';

/** Módulo da entrada da pasta: o próprio arquivo, ou o `index.*` de uma subpasta. */
async function moduleOf(dir: string, entry: { name: string; isDirectory(): boolean }) {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) {
    const index = MODULE_EXTENSIONS.map((ext) => join(path, `index${ext}`)).find((candidate) =>
      existsSync(candidate),
    );
    if (index === undefined) {
      throw new PluginDiscoveryError(
        path,
        'subpasta sem index.ts/index.js; para a pasta não ser lida como plugin, prefixe com "_"',
      );
    }
    return index;
  }
  return MODULE_EXTENSIONS.includes(extname(entry.name)) ? path : undefined;
}

/**
 * Descobre os plugins de uma pasta. Convenção: cada arquivo `.ts`/`.mts`/`.js`/`.mjs` e cada
 * subpasta com `index.*` é um módulo que exporta (export nomeado) um ou mais plugins; todo
 * export com `name` string e `setup` função entra. Ficam de fora nomes começando com `_` ou
 * `.`, testes e `.d.ts`. A ordem é a alfabética dos nomes — nunca a do sistema de arquivos —
 * e um módulo sem plugin é erro, porque quase sempre é engano.
 */
export async function discoverPlugins(dir: string): Promise<PluginEntry[]> {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (cause) {
    throw new PluginDiscoveryError(dir, 'não foi possível ler a pasta', cause);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const found: PluginEntry[] = [];
  for (const entry of entries) {
    if (isIgnored(entry.name)) continue;
    const path = await moduleOf(dir, entry);
    if (path === undefined) continue;
    let namespace: Record<string, unknown>;
    try {
      namespace = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
    } catch (cause) {
      throw new PluginDiscoveryError(path, 'falha ao importar o módulo', cause);
    }
    // O mesmo plugin pode sair por dois exports (ex.: nomeado e default): conta uma vez.
    const plugins = new Set(Object.values(namespace).filter(looksLikePlugin));
    if (plugins.size === 0) {
      throw new PluginDiscoveryError(path, 'o módulo não exporta nenhum plugin (definePlugin)');
    }
    for (const definition of plugins) found.push({ definition, origin: path });
  }
  return found;
}

export interface CollectPluginsOptions {
  /** Plugins instanciados na config (ex.: pacotes npm que o app importa). */
  readonly plugins?: readonly PluginDefinition[];
  /** Pastas varridas por `discoverPlugins`, relativas a `cwd`. */
  readonly pluginDirs?: readonly string[];
  /** Base dos caminhos relativos de `pluginDirs`. Padrão: `process.cwd()`. */
  readonly cwd?: string;
}

/** Junta as duas fontes: primeiro a lista da config, depois cada pasta na ordem dada. */
export async function collectPlugins(options: CollectPluginsOptions): Promise<PluginEntry[]> {
  const entries: PluginEntry[] = (options.plugins ?? []).map((definition) => ({
    definition,
    origin: 'config',
  }));
  const cwd = options.cwd ?? process.cwd();
  for (const dir of options.pluginDirs ?? []) {
    entries.push(...(await discoverPlugins(resolve(cwd, dir))));
  }
  return entries;
}
