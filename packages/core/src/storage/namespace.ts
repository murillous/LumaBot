// Namespaces de storage. O adapter só isola strings distintas; quem garante que um plugin não
// alcança os dados do kernel (jobs do scheduler, overrides de config) são estas funções: todo
// namespace começado por "$" é do kernel, e `pluginStorage` recusa esses nomes. Assim a
// garantia não depende da validação de nome de plugin (M1-8).

import { ReservedNamespaceError } from './errors.ts';
import type { PluginStorage, StoragePort } from './types.ts';

const KERNEL_PREFIX = '$';

/** `true` se o namespace pertence ao kernel. */
export function isReservedNamespace(namespace: string): boolean {
  return namespace.startsWith(KERNEL_PREFIX);
}

/** Storage de um plugin, no namespace do nome dele. Lança se o nome cai no espaço do kernel. */
export function pluginStorage(port: StoragePort, pluginName: string): PluginStorage {
  if (pluginName === '') throw new TypeError('Nome de plugin vazio não tem namespace de storage.');
  if (isReservedNamespace(pluginName)) throw new ReservedNamespaceError(pluginName);
  return port.forNamespace(pluginName);
}

/** Storage interno de um componente do kernel (`'scheduler'` → namespace `'$scheduler'`). */
export function kernelStorage(port: StoragePort, component: string): PluginStorage {
  if (component === '') throw new TypeError('Componente do kernel vazio.');
  return port.forNamespace(`${KERNEL_PREFIX}${component}`);
}
