// Namespaces de storage. O adapter só isola strings distintas; quem garante que um plugin não
// alcança os dados do kernel (jobs do scheduler, overrides de config) nem os de outra sessão
// são estas funções: todo namespace começado por "$" é do kernel, ":" separa a sessão do resto,
// "@" separa o plugin do tenant (ADR 0072), e `pluginStorage` recusa os três no nome do plugin.
// Assim a garantia não depende da validação de nome de plugin (M1-8). O escopo compartilhado entre
// sessões (ADR 0075) fica em `$shared:<plugin>`: espaço do kernel, que nenhuma sessão alcança.

import { ReservedNamespaceError } from './errors.ts';
import type { PluginStorage, StoragePort } from './types.ts';

const KERNEL_PREFIX = '$';
const SESSION_SEPARATOR = ':';
const TENANT_SEPARATOR = '@';
const SHARED_PREFIX = `${KERNEL_PREFIX}shared${SESSION_SEPARATOR}`;

/** Sessão cujos namespaces ficam sem prefixo: o formato de quem não passa `session`. */
export const DEFAULT_SESSION = 'default';

/** `true` se o namespace pertence ao kernel. */
export function isReservedNamespace(namespace: string): boolean {
  return namespace.startsWith(KERNEL_PREFIX);
}

/**
 * Storage de um plugin, no namespace do nome dele, ou no de um tenant dele (`'<plugin>@<tenant>'`,
 * ADR 0072). Lança se o nome cai no espaço do kernel ou de outra sessão, ou se o tenant é vazio.
 *
 * O tenant vem do transport e pode ter qualquer caractere, então fica no fim: nem a sessão nem o
 * plugin têm "@" ou ":", e o primeiro dos dois no namespace diz de quem ele é. Por isso
 * `<sessão>:<plugin>:<tenant>` não serviria: `escola:t1` seria tanto o tenant `t1` do plugin
 * `escola` na sessão `default` quanto o plugin `t1` da sessão `escola`.
 */
export function pluginStorage(
  port: StoragePort,
  pluginName: string,
  tenant?: string,
): PluginStorage {
  if (pluginName === '') throw new TypeError('Nome de plugin vazio não tem namespace de storage.');
  if (
    isReservedNamespace(pluginName) ||
    pluginName.includes(SESSION_SEPARATOR) ||
    pluginName.includes(TENANT_SEPARATOR)
  ) {
    throw new ReservedNamespaceError(pluginName);
  }
  if (tenant === undefined) return port.forNamespace(pluginName);
  assertTenantId(tenant);
  return port.forNamespace(`${pluginName}${TENANT_SEPARATOR}${tenant}`);
}

/** Recusa o que não é um ID de tenant: só texto não vazio. */
export function assertTenantId(tenant: unknown): asserts tenant is string {
  if (typeof tenant !== 'string' || tenant === '') {
    throw new TypeError(
      `ID de tenant deve ser texto não vazio; recebido ${JSON.stringify(tenant)}.`,
    );
  }
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

/**
 * Visão do storage comum a todas as sessões (ADR 0075): `forNamespace('x')` vira `'$shared:x'`, sem
 * o prefixo de sessão. Começa com "$", então o namespace de plugin de nenhuma sessão coincide com
 * ele; os componentes do kernel não usam ":" no nome. `authState` e `close` passam direto.
 */
export function sharedStorage(port: StoragePort): StoragePort {
  return {
    forNamespace: (namespace) => port.forNamespace(`${SHARED_PREFIX}${namespace}`),
    authState: (name) => port.authState(name),
    close: () => port.close(),
  };
}
