import { describe, expect, it, vi } from 'vitest';
import { TenantScope } from '#tenant/scope.ts';
import { ReservedNamespaceError } from './errors.ts';
import { createMemoryStorage } from './memory.ts';
import { pluginStorage } from './namespace.ts';
import { tenantStorage } from './tenant.ts';

describe('storage com escopo de tenant (ADR 0072)', () => {
  it('namespace do tenant é "<plugin>@<tenant>"; sem tenant, o do plugin', () => {
    const port = createMemoryStorage();
    const spy = vi.spyOn(port, 'forNamespace');
    pluginStorage(port, 'notas', 'escola:a');
    pluginStorage(port, 'notas');
    expect(spy.mock.calls).toEqual([['notas@escola:a'], ['notas']]);
  });

  it('plugin com "@" no nome e tenant vazio são recusados', () => {
    const port = createMemoryStorage();
    expect(() => pluginStorage(port, 'notas@a')).toThrow(ReservedNamespaceError);
    expect(() => pluginStorage(port, 'notas', '')).toThrow(TypeError);
    expect(() => tenantStorage(port, 'notas', new TenantScope()).forTenant('')).toThrow(TypeError);
  });

  it('KV segue o tenant corrente, e sem tenant fica no escopo da sessão', async () => {
    const port = createMemoryStorage();
    const scope = new TenantScope();
    const storage = tenantStorage(port, 'notas', scope);

    await scope.run('a', () => storage.kv.set('k', 'de a'));
    await scope.run('b', () => storage.kv.set('k', 'de b'));
    await storage.kv.set('k', 'global');

    expect(await scope.run('a', () => storage.kv.get('k'))).toBe('de a');
    expect(await scope.run('b', () => storage.kv.get('k'))).toBe('de b');
    expect(await scope.run('c', () => storage.kv.get('k'))).toBeUndefined();
    expect(await storage.kv.get('k')).toBe('global');
    expect(await scope.run('a', () => storage.kv.delete('k'))).toBe(true);
    expect(await storage.forTenant('b').kv.get('k')).toBe('de b');
  });

  it('coleção obtida fora do escopo grava no tenant de quem a usa', async () => {
    const port = createMemoryStorage();
    const scope = new TenantScope();
    const storage = tenantStorage(port, 'notas', scope);
    const alunos = storage.collection<{ nome: string }>('alunos', { indexes: ['nome'] });

    const id = await scope.run('a', () => alunos.insert({ nome: 'Ana' }));
    await scope.run('b', () => alunos.insert({ nome: 'Bia' }));

    expect(await scope.run('a', () => alunos.find())).toEqual([{ id, nome: 'Ana' }]);
    expect(await scope.run('b', () => alunos.get(id))).toBeUndefined();
    expect(await alunos.find()).toEqual([]);
    expect(await scope.run('b', () => alunos.update({}, { nome: 'Bea' }))).toBe(1);
    expect(await storage.forTenant('b').collection('alunos').find()).toMatchObject([
      { nome: 'Bea' },
    ]);
    expect(await scope.run('a', () => alunos.delete({}))).toBe(1);
  });

  it('índice inválido lança já no collection(), fora de escopo', () => {
    const storage = tenantStorage(createMemoryStorage(), 'notas', new TenantScope());
    expect(() => storage.collection('alunos', { indexes: ['a.b'] })).toThrow(TypeError);
  });
});
