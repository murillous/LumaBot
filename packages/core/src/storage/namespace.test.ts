import { describe, expect, it, vi } from 'vitest';
import { ReservedNamespaceError } from './errors.ts';
import { createMemoryStorage } from './memory.ts';
import {
  isReservedNamespace,
  kernelStorage,
  pluginStorage,
  sessionStorage,
  sharedStorage,
} from './namespace.ts';

describe('namespaces de storage', () => {
  it('prefixo "$" é do kernel', () => {
    expect(isReservedNamespace('$scheduler')).toBe(true);
    expect(isReservedNamespace('scheduler')).toBe(false);
    expect(isReservedNamespace('a$')).toBe(false);
  });

  it('pluginStorage usa o nome do plugin como namespace', () => {
    const port = createMemoryStorage();
    const spy = vi.spyOn(port, 'forNamespace');
    pluginStorage(port, 'sticker');
    expect(spy).toHaveBeenCalledWith('sticker');
  });

  it('kernelStorage prefixa o componente', () => {
    const port = createMemoryStorage();
    const spy = vi.spyOn(port, 'forNamespace');
    kernelStorage(port, 'config');
    expect(spy).toHaveBeenCalledWith('$config');
  });

  it('plugin com nome reservado ou vazio é recusado', () => {
    const port = createMemoryStorage();
    expect(() => pluginStorage(port, '$config')).toThrow(ReservedNamespaceError);
    expect(() => pluginStorage(port, '')).toThrow(TypeError);
    expect(() => kernelStorage(port, '')).toThrow(TypeError);
  });

  it('plugin não lê nem escreve os dados do kernel', async () => {
    const port = createMemoryStorage();
    await kernelStorage(port, 'config').kv.set('overrides', { a: 1 });
    expect(await pluginStorage(port, 'config').kv.get('overrides')).toBeUndefined();
  });

  it("sessionStorage prefixa os namespaces com a sessão; 'default' fica sem prefixo", () => {
    const port = createMemoryStorage();
    const spy = vi.spyOn(port, 'forNamespace');
    pluginStorage(sessionStorage(port, 'vendas'), 'sticker');
    kernelStorage(sessionStorage(port, 'vendas'), 'scheduler');
    expect(sessionStorage(port, 'default')).toBe(port);
    expect(spy.mock.calls).toEqual([['vendas:sticker'], ['vendas:$scheduler']]);
  });

  it('plugin não alcança outra sessão nem o kernel da própria', async () => {
    const port = createMemoryStorage();
    const vendas = sessionStorage(port, 'vendas');
    const suporte = sessionStorage(port, 'suporte');
    await pluginStorage(suporte, 'sticker').kv.set('k', 'suporte');
    await pluginStorage(port, 'sticker').kv.set('k', 'default');
    await kernelStorage(vendas, 'config').kv.set('k', 'kernel');

    expect(await pluginStorage(vendas, 'sticker').kv.get('k')).toBeUndefined();
    // ":" e "$" seriam o caminho para o namespace de outra sessão ou do kernel.
    expect(() => pluginStorage(port, 'suporte:sticker')).toThrow(ReservedNamespaceError);
    expect(() => pluginStorage(vendas, '$config')).toThrow(ReservedNamespaceError);
  });

  it('sharedStorage fica em "$shared:<plugin>", sem prefixo de sessão (ADR 0075)', () => {
    const port = createMemoryStorage();
    const spy = vi.spyOn(port, 'forNamespace');
    pluginStorage(sharedStorage(port), 'rank');
    pluginStorage(sharedStorage(port), 'rank', 'escola-a');
    expect(spy.mock.calls).toEqual([['$shared:rank'], ['$shared:rank@escola-a']]);
  });

  it('o escopo compartilhado não coincide com sessão, kernel nem outro plugin', async () => {
    const port = createMemoryStorage();
    await pluginStorage(sharedStorage(port), 'rank').kv.set('k', 'shared');
    await pluginStorage(sharedStorage(port), 'outro').kv.set('k', 'outro');

    expect(await pluginStorage(port, 'rank').kv.get('k')).toBeUndefined();
    expect(await pluginStorage(sessionStorage(port, 'vendas'), 'rank').kv.get('k')).toBeUndefined();
    expect(await kernelStorage(port, 'shared').kv.get('k')).toBeUndefined();
    expect(await pluginStorage(sharedStorage(port), 'rank').kv.get('k')).toBe('shared');
    // Nenhum nome de plugin chega ao "$shared:" pelo namespace da sessão.
    expect(() => pluginStorage(port, '$shared:rank')).toThrow(ReservedNamespaceError);
  });
});
