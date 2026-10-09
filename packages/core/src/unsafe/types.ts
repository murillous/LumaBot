// Contrato do escape hatch (M1-15, ADR 0011; `raw` no ADR 0066).

import type { Message } from '#message/types.ts';

/** `ctx.unsafe`: acesso explícito ao objeto nativo do transport. */
export interface Unsafe {
  /** Objeto nativo (ex.: socket do Baileys). Ler loga um aviso, uma vez por plugin. */
  readonly native: unknown;
  /**
   * Objeto bruto de onde a mensagem saiu (ex.: o `WAMessage` do Baileys), ou `undefined` se o
   * transport não o expõe ou a mensagem não veio dele (montada em teste ou pelo próprio plugin).
   * Na mensagem de um clique ou de um comando nativo, é o objeto bruto da interação. Chamar loga
   * um aviso, uma vez por plugin, como o `native` (ADR 0066).
   */
  raw(message: Message): unknown;
}
