// Namespaces de storage. O adapter só isola strings distintas; quem garante que um plugin não
// alcança os dados do kernel (jobs do scheduler, overrides de config) nem os de outra sessão
// são estas funções: todo namespace começado por "$" é do kernel, ":" separa a sessão do resto,
// e `pluginStorage` recusa os dois. Assim a garantia não depende da validação de nome de plugin
// (M1-8).

import { ReservedNamespaceError } from './errors.ts';
import type { PluginStorage, StoragePort } from './types.ts';

const KERNEL_PREFIX = '$';
const SESSION_SEPARATOR = ':';

/** Sessão cujos namespaces ficam sem prefixo: o formato de quem não passa `session`. */
export const DEFAULT_SESSION = 'default';

/** `true` se o namespace pertence ao kernel. */
export function isReservedNamespace(namespace: string): boolean {
  return namespace.startsWith(KERNEL_PREFIX);
}

/** Storage de um plugin, no namespace do nome dele. Lança se o nome cai no espaço do kernel. */
export function pluginStorage(port: StoragePort, pluginName: string): PluginStorage {
  if (pluginName === '') throw new TypeError('Nome de plugin vazio não tem namespace de storage.');
  if (isReservedNamespace(pluginName) || pluginName.includes(SESSION_SEPARATOR)) {
    throw new ReservedNamespaceError(pluginName);
  }
  return port.forNamespace(pluginName);
}

/** Storage interno de um componente do kernel (`'scheduler'` → namespace `'$scheduler'`). */
export function kernelStorage(port: StoragePort, component: string): PluginStorage {
  if (component === '') throw new TypeError('Componente do kernel vazio.');
  return port.forNamespace(`${KERNEL_PREFIX}${component}`);
}

/**
 * Visão do storage no escopo de uma sessão (ADR 0036): `forNamespace('x')` vira
 * `'<sessão>:x'`, e a sessão `'default'` fica sem prefixo. O nome da sessão não tem ":"
 * (kebab-case) e `pluginStorage` recusa ":", então nenhum namespace de uma sessão coincide
 * com o de outra. `authState` e `close` passam direto: o auth state já é por sessão.
 */
export function sessionStorage(port: StoragePort, session: string): StoragePort {
  if (session === DEFAULT_SESSION) return port;
  return {
    forNamespace: (namespace) => port.forNamespace(`${session}${SESSION_SEPARATOR}${namespace}`),
    authState: (name) => port.authState(name),
    close: () => port.close(),
  };
}
