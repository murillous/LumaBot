import type { TransportCommands } from '#transport/types.ts';
import type { CommandInfo } from './command.ts';
import type { RegisteredCommand } from './registry.ts';

/** Comando como os plugins e o transport o veem: os dados da definição, sem `run` nem `onReject`. */
export function commandInfo({ plugin, definition }: RegisteredCommand): CommandInfo {
  return {
    plugin,
    name: definition.name,
    aliases: [...(definition.aliases ?? [])],
    description: definition.description ?? null,
    role: definition.role ?? 'everyone',
  };
}

export interface CommandCatalogOptions {
  /** Comandos registrados agora. */
  readonly list: () => readonly RegisteredCommand[];
  /** Destino do erro de um listener de `onChange`, que lançou ou rejeitou. */
  readonly onError: (error: unknown) => void;
}

/** A lista de comandos que o transport lê e assina (ADR 0064), com os avisos em lote. */
export interface CommandCatalog {
  readonly commands: TransportCommands;
  /** O registro mudou. O aviso sai no fim do tick ou, dentro de um `batch`, no fim dele. */
  changed(): void;
  /** Liga os avisos. Antes disso (o boot, que termina antes do `connect()`), nada avisa. */
  open(): void;
  /** Desliga os avisos de vez: o `teardown` do shutdown apagaria o menu da plataforma. */
  close(): void;
  /** Roda `work` segurando os avisos; ao fim, um aviso só, se a lista mudou. */
  batch<T>(work: () => Promise<T>): Promise<T>;
}

type Listener = () => void | Promise<void>;

export function createCommandCatalog(options: CommandCatalogOptions): CommandCatalog {
  let phase: 'boot' | 'open' | 'closed' = 'boot';
  // Lotes em andamento; o reload em cascata pode aninhar.
  let holds = 0;
  let dirty = false;
  let scheduled = false;
  const listeners = new Set<Listener>();

  function notify(listener: Listener): void {
    try {
      const result = listener();
      if (result instanceof Promise) result.catch(options.onError);
    } catch (error) {
      options.onError(error);
    }
  }

  function flush(): void {
    scheduled = false;
    // Um lote aberto depois da mudança, no mesmo tick, avisa quando terminar.
    if (phase !== 'open' || holds > 0 || !dirty) return;
    dirty = false;
    for (const listener of [...listeners]) notify(listener);
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    // Microtask, não timer: vários `add` seguidos viram um aviso, e nada sobrevive ao `stop()`.
    queueMicrotask(flush);
  }

  return {
    commands: {
      list: () => options.list().map(commandInfo),
      onChange(listener) {
        // Depois do `close()`, a assinatura fica sem efeito: o `flush` não roda mais.
        if (phase !== 'closed') listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },

    changed() {
      if (phase !== 'open') return;
      dirty = true;
      if (holds === 0) schedule();
    },

    open() {
      if (phase === 'boot') phase = 'open';
    },

    close() {
      phase = 'closed';
      listeners.clear();
    },

    async batch(work) {
      holds++;
      try {
        return await work();
      } finally {
        holds--;
        if (holds === 0 && dirty) schedule();
      }
    },
  };
}
