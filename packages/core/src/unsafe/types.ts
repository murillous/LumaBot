// Contrato do escape hatch (M1-15, ADR 0011).

/** `ctx.unsafe`: acesso explícito ao objeto nativo do transport. */
export interface Unsafe {
  /** Objeto nativo (ex.: socket do Baileys). Ler loga um aviso, uma vez por plugin. */
  readonly native: unknown;
}
