// Contrato do service registry (M1-9, ADR 0018). O M1-9 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

/**
 * Mapa nome → tipo do serviço, preenchido por declaration merging no plugin que provê:
 *
 * ```ts
 * declare module '@zapforge/core' {
 *   interface Services { ai: AiService }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: vazio de propósito; plugins estendem por declaration merging.
export interface Services {}

export type ServiceName = keyof Services;

/** Acesso do plugin ao registry (`ctx.services`). */
export interface ServiceAccess {
  provide<K extends ServiceName>(name: K, service: Services[K]): void;
  /** Lança erro claro se ninguém provê o serviço. */
  get<K extends ServiceName>(name: K): Services[K];
  has(name: ServiceName): boolean;
}
