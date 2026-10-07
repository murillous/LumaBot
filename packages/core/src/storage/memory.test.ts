import { describe, expect, it } from 'vitest';
import { defineStorageContract } from './contract/index.ts';
import { createMemoryStorage } from './memory.ts';

// O adapter em memória é a referência: precisa passar na suíte inteira.
defineStorageContract({ describe, it }, { name: 'memória', create: createMemoryStorage });

// Memória não persiste; aqui `reopen` devolve o mesmo port só para exercitar os testes de
// persistência da própria suíte (que os adapters SQLite/Postgres rodam de verdade).
defineStorageContract(
  { describe, it },
  {
    name: 'memória com reopen simulado',
    create: createMemoryStorage,
    reopen: async (port) => port,
  },
);

describe('createMemoryStorage', () => {
  it('instâncias não compartilham dados', async () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    await a.forNamespace('p').kv.set('k', 'a');
    await a.forNamespace('p').collection('c').insert({ x: 1 });
    await a.authState('s').setCreds('a');
    expect(await b.forNamespace('p').kv.get('k')).toBeUndefined();
    expect(await b.forNamespace('p').collection('c').find()).toEqual([]);
    expect(await b.authState('s').getCreds()).toBeUndefined();
  });

  it('fechar uma instância não afeta outra', async () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    await a.close();
    await b.forNamespace('p').kv.set('k', 1);
    expect(await b.forNamespace('p').kv.get('k')).toBe(1);
  });

  it('setKeys com valor não serializável não aplica nada do lote', async () => {
    const auth = createMemoryStorage().authState('s');
    const bad = { t: { '1': 'ok', '2': undefined as never } };
    await expect(auth.setKeys(bad)).rejects.toThrow(TypeError);
    expect(await auth.getKeys('t', ['1'])).toEqual({});
  });
});
