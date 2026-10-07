import { describe, expect, it, vi } from 'vitest';
import { ReservedNamespaceError } from './errors.ts';
import { createMemoryStorage } from './memory.ts';
import { isReservedNamespace, kernelStorage, pluginStorage } from './namespace.ts';

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
});
