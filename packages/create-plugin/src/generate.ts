import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Pasta do template: ao lado de `src/` no fonte e de `dist/` no pacote publicado. */
export const TEMPLATE_DIR: string = join(import.meta.dirname, '..', 'template');

// A mesma regra do `name` no manifesto (`definePlugin`): o nome vira namespace de storage e
// prefixo de rota, então o scaffold recusa antes de gerar um plugin que não carrega.
const PLUGIN_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const PREFIX = 'zapforge-plugin-';

/** Os nomes que o template recebe, todos tirados do nome do pacote. */
export interface PluginNames {
  /** Nome do pacote npm (`@acme/zapforge-plugin-ola`). */
  readonly packageName: string;
  /** `name` do manifesto: o pacote sem escopo e sem o prefixo `zapforge-plugin-` (`ola`). */
  readonly pluginName: string;
  /** Nome do export em camelCase (`ola`, `boasVindas`). */
  readonly exportName: string;
  /** Pasta criada: o pacote sem escopo (`zapforge-plugin-ola`). */
  readonly directory: string;
}

/** Nome inválido para pacote ou plugin; a mensagem diz o que corrigir. */
export class PluginNameError extends Error {
  override readonly name = 'PluginNameError';
}

/** Pasta de destino já existe e tem arquivos: o scaffold não sobrescreve nada. */
export class TargetNotEmptyError extends Error {
  override readonly name = 'TargetNotEmptyError';
}

export function pluginNames(packageName: string): PluginNames {
  if (!PACKAGE_NAME.test(packageName)) {
    throw new PluginNameError(
      `"${packageName}" não é um nome de pacote npm válido: use minúsculas, dígitos e hífens, ` +
        'com escopo opcional (@acme/zapforge-plugin-ola).',
    );
  }
  const directory = packageName.slice(packageName.indexOf('/') + 1);
  const pluginName = directory.startsWith(PREFIX) ? directory.slice(PREFIX.length) : directory;
  if (!PLUGIN_NAME.test(pluginName)) {
    throw new PluginNameError(
      `"${pluginName}" não serve de nome de plugin: use kebab-case começando por letra ` +
        '(ola, boas-vindas).',
    );
  }
  const exportName = pluginName.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return { packageName, pluginName, exportName, directory };
}

/**
 * Copia o template para `target` trocando os marcadores `__package__`, `__name__` e `__export__`.
 * O template guarda o `.gitignore` como `_gitignore`, porque o npm o tira do pacote publicado.
 */
export function generate(target: string, names: PluginNames): void {
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new TargetNotEmptyError(`A pasta ${target} já existe e não está vazia.`);
  }
  cpSync(TEMPLATE_DIR, target, { recursive: true });
  renameSync(join(target, '_gitignore'), join(target, '.gitignore'));
  for (const entry of readdirSync(target, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const source = readFileSync(path, 'utf8');
    const next = source
      .replaceAll('__package__', names.packageName)
      .replaceAll('__name__', names.pluginName)
      .replaceAll('__export__', names.exportName);
    if (next !== source) writeFileSync(path, next);
  }
}
