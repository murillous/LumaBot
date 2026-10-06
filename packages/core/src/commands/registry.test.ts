import { describe, expect, it } from 'vitest';
import { command } from './command.ts';
import { CommandConflictError, createCommandRegistry } from './registry.ts';

const noop = (): void => undefined;

describe('command', () => {
  it('retorna a própria definição', () => {
    const def = { name: 'sticker', aliases: ['s'], run: noop };
    expect(command(def)).toBe(def);
  });

  it('recusa nome ou alias vazio ou com espaço', () => {
    expect(() => command({ name: '', run: noop })).toThrow(TypeError);
    expect(() => command({ name: 'luma stats', run: noop })).toThrow(/luma stats/);
    expect(() => command({ name: 'ok', aliases: ['a b'], run: noop })).toThrow(/Alias/);
  });
});

describe('createCommandRegistry', () => {
  it('encontra por nome e alias sem diferenciar caixa', () => {
    const registry = createCommandRegistry();
    registry.add('media', command({ name: 'Sticker', aliases: ['S'], run: noop }));
    expect(registry.find('sticker')?.plugin).toBe('media');
    expect(registry.find('STICKER')?.definition.name).toBe('Sticker');
    expect(registry.find('s')?.plugin).toBe('media');
    expect(registry.find('st')).toBeUndefined();
  });

  it('lança conflito citando os dois plugins quando o nome colide', () => {
    const registry = createCommandRegistry();
    registry.add('media', command({ name: 'sticker', run: noop }));
    const attempt = (): void => registry.add('fun', command({ name: 'STICKER', run: noop }));

    expect(attempt).toThrow(CommandConflictError);
    expect(attempt).toThrow(
      expect.objectContaining({
        token: 'sticker',
        existing: expect.objectContaining({ plugin: 'media' }),
        incoming: expect.objectContaining({ plugin: 'fun' }),
      }),
    );
    expect(attempt).toThrow(/"STICKER" do plugin "fun".*"sticker" do plugin "media"/);
  });

  it('detecta conflito entre alias e nome de outro plugin', () => {
    const registry = createCommandRegistry();
    registry.add('media', command({ name: 'sticker', aliases: ['s'], run: noop }));
    expect(() => registry.add('search', command({ name: 's', run: noop }))).toThrow(
      CommandConflictError,
    );
  });

  it('detecta conflito dentro do mesmo plugin', () => {
    const registry = createCommandRegistry();
    registry.add('media', command({ name: 'sticker', run: noop }));
    expect(() =>
      registry.add('media', command({ name: 'gif', aliases: ['sticker'], run: noop })),
    ).toThrow(CommandConflictError);
  });

  it('não registra nada do comando que conflitou', () => {
    const registry = createCommandRegistry();
    registry.add('media', command({ name: 'sticker', run: noop }));
    expect(() =>
      registry.add('fun', command({ name: 'gif', aliases: ['g', 'sticker'], run: noop })),
    ).toThrow(CommandConflictError);
    expect(registry.find('gif')).toBeUndefined();
    expect(registry.find('g')).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
  });

  it('aceita alias repetido ou igual ao nome no mesmo comando', () => {
    const registry = createCommandRegistry();
    expect(() =>
      registry.add(
        'media',
        command({ name: 'sticker', aliases: ['STICKER', 's', 's'], run: noop }),
      ),
    ).not.toThrow();
  });

  it('removePlugin libera os tokens do plugin e preserva os dos outros', () => {
    const registry = createCommandRegistry();
    registry.add('media', command({ name: 'sticker', aliases: ['s'], run: noop }));
    registry.add('fun', command({ name: 'dado', run: noop }));

    registry.removePlugin('media');

    expect(registry.find('sticker')).toBeUndefined();
    expect(registry.find('s')).toBeUndefined();
    expect(registry.find('dado')?.plugin).toBe('fun');
    expect(registry.list()).toHaveLength(1);
    // Reload do plugin: registrar de novo não conflita consigo mesmo.
    expect(() => registry.add('media', command({ name: 'sticker', run: noop }))).not.toThrow();
  });
});
