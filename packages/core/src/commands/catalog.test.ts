// Lista de comandos do transport (ADR 0064): o aviso de mudança sai em lote, nunca no boot nem
// depois do `close()`.

import { describe, expect, it, vi } from 'vitest';
import { createCommandCatalog } from './catalog.ts';
import { command } from './command.ts';
import { createCommandRegistry } from './registry.ts';

const noop = (): void => undefined;

function setup() {
  const errors: unknown[] = [];
  const catalog = createCommandCatalog({
    list: () => registry.list(),
    onError: (error) => errors.push(error),
  });
  const registry = createCommandRegistry({ onChange: () => catalog.changed() });
  let changes = 0;
  catalog.commands.onChange(() => {
    changes++;
  });
  return { catalog, registry, errors, changes: () => changes };
}

/** Deixa as microtasks pendentes rodarem. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('createCommandCatalog', () => {
  it('list() devolve os comandos como CommandInfo', () => {
    const { registry, catalog } = setup();
    registry.add(
      'escola',
      command({ name: 'notas', aliases: ['n'], description: 'Notas', role: 'owner', run: noop }),
    );
    registry.add('escola', command({ name: 'ajuda', run: noop }));

    expect(catalog.commands.list()).toEqual([
      { plugin: 'escola', name: 'notas', aliases: ['n'], description: 'Notas', role: 'owner' },
      { plugin: 'escola', name: 'ajuda', aliases: [], description: null, role: 'everyone' },
    ]);
  });

  it('não avisa antes do open(): o boot termina antes do connect', async () => {
    const { registry, changes } = setup();
    registry.add('escola', command({ name: 'notas', run: noop }));
    await tick();
    expect(changes()).toBe(0);
  });

  it('aberto, junta as mudanças do mesmo tick num aviso só', async () => {
    const { catalog, registry, changes } = setup();
    catalog.open();

    registry.add('escola', command({ name: 'notas', run: noop }));
    registry.add('escola', command({ name: 'ajuda', run: noop }));
    expect(changes()).toBe(0);
    await tick();
    expect(changes()).toBe(1);

    registry.removePlugin('escola');
    await tick();
    expect(changes()).toBe(2);
  });

  it('dentro de um lote, avisa uma vez no fim, mesmo com mudanças em ticks diferentes', async () => {
    const { catalog, registry, changes } = setup();
    catalog.open();
    registry.add('escola', command({ name: 'notas', run: noop }));
    await tick();
    expect(changes()).toBe(1);

    await catalog.batch(async () => {
      registry.removePlugin('escola');
      await tick();
      // Lote aninhado (reload em cascata): ainda não avisa.
      await catalog.batch(async () => {
        await tick();
        registry.add('escola', command({ name: 'notas', run: noop }));
      });
      await tick();
      expect(changes()).toBe(1);
    });
    await tick();

    expect(changes()).toBe(2);
  });

  it('lote sem mudança não avisa, e o lote que falha avisa e relança', async () => {
    const { catalog, registry, changes } = setup();
    catalog.open();

    await catalog.batch(async () => undefined);
    await tick();
    expect(changes()).toBe(0);

    const failure = new Error('setup quebrou');
    await expect(
      catalog.batch(async () => {
        registry.add('escola', command({ name: 'notas', run: noop }));
        throw failure;
      }),
    ).rejects.toBe(failure);
    await tick();
    expect(changes()).toBe(1);
  });

  it('depois do close() não avisa mais, nem o que já estava agendado', async () => {
    const { catalog, registry, changes } = setup();
    catalog.open();
    registry.add('escola', command({ name: 'notas', run: noop }));
    catalog.close();
    registry.removePlugin('escola');
    await tick();

    expect(changes()).toBe(0);
  });

  it('a assinatura desfeita não recebe aviso', async () => {
    const { catalog, registry } = setup();
    const listener = vi.fn();
    const unsubscribe = catalog.commands.onChange(listener);
    catalog.open();
    unsubscribe();
    unsubscribe();

    registry.add('escola', command({ name: 'notas', run: noop }));
    await tick();

    expect(listener).not.toHaveBeenCalled();
  });

  it('erro do listener, síncrono ou rejeitado, vai ao onError sem barrar os outros', async () => {
    const { catalog, registry, errors, changes } = setup();
    const sync = new Error('lançou');
    const async = new Error('rejeitou');
    catalog.commands.onChange(() => {
      throw sync;
    });
    catalog.commands.onChange(() => Promise.reject(async));
    const last = vi.fn();
    catalog.commands.onChange(last);
    catalog.open();

    registry.add('escola', command({ name: 'notas', run: noop }));
    await tick();

    expect(errors).toEqual([sync, async]);
    expect(changes()).toBe(1);
    expect(last).toHaveBeenCalledTimes(1);
  });
});
