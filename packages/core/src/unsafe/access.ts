// Fábrica do escape hatch `ctx.unsafe` (M1-15, ADR 0011; `raw` no ADR 0066).

import type { Logger } from '#logger/types.ts';
import type { Message } from '#message/types.ts';
import type { PluginManifest } from '#plugin/types.ts';
import type { Interaction, Transport } from '#transport/types.ts';
import type { Unsafe } from './types.ts';

export interface UnsafeAccessOptions {
  /**
   * Só `name` (vai no aviso), `native` (lido a cada acesso) e `raw` (consultado a cada chamada)
   * são usados.
   */
  readonly transport: Pick<Transport, 'name' | 'native' | 'raw'>;
  readonly log: Logger;
  /**
   * A interação de onde o kernel montou a mensagem (clique ou comando nativo). O transport nunca
   * viu essa `Message`, então o `raw` pergunta a ele pela interação. Ausente: nenhuma mensagem
   * vem de interação.
   */
  readonly interactionOf?: (message: Message) => Interaction | undefined;
}

/** Fábrica de `Unsafe` de um bot; guarda quais plugins já foram avisados. */
export interface UnsafeAccess {
  /**
   * `Unsafe` do plugin. Pode ser chamado várias vezes para o mesmo plugin (ex.: um por
   * contexto de mensagem): o aviso continua saindo uma vez só por plugin.
   */
  forPlugin(manifest: Pick<PluginManifest, 'name' | 'transports'>): Unsafe;
}

/** O que o plugin acessou; cada um avisa uma vez, para o log medir os dois usos (ADR 0011). */
type Accessor = 'native' | 'raw';

/**
 * Uma por instância de bot. O registro de "já avisou" mora aqui, e não em cada `Unsafe` nem em
 * escopo de módulo: assim o aviso sai uma vez por plugin mesmo com vários `Unsafe` do mesmo
 * plugin, e dois bots no mesmo processo não silenciam um ao outro.
 */
export function createUnsafeAccess(options: UnsafeAccessOptions): UnsafeAccess {
  const { transport, log, interactionOf } = options;
  const warned = new Set<string>();

  function warnOnce(manifest: Pick<PluginManifest, 'name' | 'transports'>, what: Accessor): void {
    const id = `${what}:${manifest.name}`;
    if (warned.has(id)) return;
    warned.add(id);
    const fields = { plugin: manifest.name, transport: transport.name };
    const access = what === 'native' ? 'ctx.unsafe.native' : 'ctx.unsafe.raw()';
    // Sem `transports` no manifesto o plugin se diz portável, mas ao ler o objeto nativo ele
    // passa a depender deste transport (ADR 0011). Não bloqueamos: o aviso deixa isso visível.
    if (manifest.transports === undefined) {
      log.warn(
        `plugin "${manifest.name}" acessou ${access} sem declarar transports no manifesto; ` +
          `ele fica preso ao transport "${transport.name}" (declare transports: ['${transport.name}'])`,
        fields,
      );
      return;
    }
    log.warn(
      `plugin "${manifest.name}" acessou ${access} do transport "${transport.name}"`,
      fields,
    );
  }

  return {
    forPlugin(manifest) {
      return {
        // Getter, não valor copiado: o objeto nativo pode ser trocado a cada reconexão.
        get native(): unknown {
          warnOnce(manifest, 'native');
          return transport.native;
        },
        raw(message) {
          warnOnce(manifest, 'raw');
          // Só aqui, sob demanda: o caminho da mensagem não paga nada por o plugin poder pedir.
          return transport.raw?.(interactionOf?.(message) ?? message);
        },
      };
    },
  };
}
