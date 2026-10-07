// Fábrica do escape hatch `ctx.unsafe` (M1-15, ADR 0011).

import type { Logger } from '#logger/types.ts';
import type { PluginManifest } from '#plugin/types.ts';
import type { Transport } from '#transport/types.ts';
import type { Unsafe } from './types.ts';

export interface UnsafeAccessOptions {
  /** Só `name` (vai no aviso) e `native` (lido a cada acesso) são usados. */
  readonly transport: Pick<Transport, 'name' | 'native'>;
  readonly log: Logger;
}

/** Fábrica de `Unsafe` de um bot; guarda quais plugins já foram avisados. */
export interface UnsafeAccess {
  /**
   * `Unsafe` do plugin. Pode ser chamado várias vezes para o mesmo plugin (ex.: um por
   * contexto de mensagem): o aviso continua saindo uma vez só por plugin.
   */
  forPlugin(manifest: Pick<PluginManifest, 'name' | 'transports'>): Unsafe;
}

/**
 * Uma por instância de bot. O registro de "já avisou" mora aqui, e não em cada `Unsafe` nem em
 * escopo de módulo: assim o aviso sai uma vez por plugin mesmo com vários `Unsafe` do mesmo
 * plugin, e dois bots no mesmo processo não silenciam um ao outro.
 */
export function createUnsafeAccess(options: UnsafeAccessOptions): UnsafeAccess {
  const { transport, log } = options;
  const warned = new Set<string>();

  function warnOnce(manifest: Pick<PluginManifest, 'name' | 'transports'>): void {
    if (warned.has(manifest.name)) return;
    warned.add(manifest.name);
    const fields = { plugin: manifest.name, transport: transport.name };
    // Sem `transports` no manifesto o plugin se diz portável, mas ao ler o objeto nativo ele
    // passa a depender deste transport (ADR 0011). Não bloqueamos: o aviso deixa isso visível.
    if (manifest.transports === undefined) {
      log.warn(
        `plugin "${manifest.name}" acessou ctx.unsafe.native sem declarar transports no manifesto; ` +
          `ele fica preso ao transport "${transport.name}" (declare transports: ['${transport.name}'])`,
        fields,
      );
      return;
    }
    log.warn(
      `plugin "${manifest.name}" acessou ctx.unsafe.native do transport "${transport.name}"`,
      fields,
    );
  }

  return {
    forPlugin(manifest) {
      return {
        // Getter, não valor copiado: o objeto nativo pode ser trocado a cada reconexão.
        get native(): unknown {
          warnOnce(manifest);
          return transport.native;
        },
      };
    },
  };
}
