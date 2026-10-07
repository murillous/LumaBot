// Contrato do auth state, do close() e (se o adapter permitir reabrir) da persistência.

import assert from 'node:assert/strict';
import { StorageClosedError } from '#storage/errors.ts';
import type { JsonObject } from '#storage/types.ts';
import type { ContractCase, ContractTestApi } from './harness.ts';

export function authStateContract(api: ContractTestApi, test: ContractCase): void {
  api.describe('auth state', () => {
    test('sessão nova não tem credenciais', async (port) => {
      assert.equal(await port.authState('main').getCreds(), undefined);
    });

    test('setCreds substitui e getCreds devolve cópia', async (port) => {
      const auth = port.authState('main');
      const creds = { me: { id: '1' }, noise: { private: { type: 'Buffer', data: 'AAE=' } } };
      await auth.setCreds({ old: true });
      await auth.setCreds(creds);
      creds.me.id = 'mutado';
      const read = (await auth.getCreds()) as { me: { id: string } };
      assert.deepEqual(read, {
        me: { id: '1' },
        noise: { private: { type: 'Buffer', data: 'AAE=' } },
      });
      read.me.id = 'mutado';
      assert.deepEqual(((await auth.getCreds()) as { me: { id: string } }).me, { id: '1' });
    });

    test('getKeys devolve só os ids existentes', async (port) => {
      const auth = port.authState('main');
      await auth.setKeys({ 'pre-key': { '1': { k: 1 }, '2': { k: 2 } } });
      assert.deepEqual(await auth.getKeys('pre-key', ['1', '3', '2']), {
        '1': { k: 1 },
        '2': { k: 2 },
      });
      assert.deepEqual(await auth.getKeys('pre-key', []), {});
      assert.deepEqual(await auth.getKeys('session', ['1']), {});
    });

    test('setKeys grava vários tipos num lote e null remove', async (port) => {
      const auth = port.authState('main');
      await auth.setKeys({
        'pre-key': { '1': 'a', '2': 'b' },
        session: { '1': 'sessão' },
      });
      await auth.setKeys({ 'pre-key': { '1': null, '3': 'c' }, session: { inexistente: null } });
      assert.deepEqual(await auth.getKeys('pre-key', ['1', '2', '3']), { '2': 'b', '3': 'c' });
      // Mesmo id em tipos distintos são chaves distintas.
      assert.deepEqual(await auth.getKeys('session', ['1']), { '1': 'sessão' });
    });

    test('valores das chaves entram e saem como cópia', async (port) => {
      const auth = port.authState('main');
      const value = { list: [1] };
      await auth.setKeys({ t: { a: value } });
      value.list.push(2);
      const read = await auth.getKeys('t', ['a']);
      assert.deepEqual(read, { a: { list: [1] } });
      ((read['a'] as JsonObject)['list'] as number[]).push(3);
      assert.deepEqual(await auth.getKeys('t', ['a']), { a: { list: [1] } });
    });

    test('sessões são isoladas e clear apaga só a própria', async (port) => {
      const a = port.authState('a');
      const b = port.authState('b');
      await a.setCreds('creds-a');
      await b.setCreds('creds-b');
      await a.setKeys({ t: { '1': 'a' } });
      await b.setKeys({ t: { '1': 'b' } });
      assert.deepEqual(await a.getKeys('t', ['1']), { '1': 'a' });

      await a.clear();
      assert.equal(await a.getCreds(), undefined);
      assert.deepEqual(await a.getKeys('t', ['1']), {});
      assert.equal(await b.getCreds(), 'creds-b');
      assert.deepEqual(await b.getKeys('t', ['1']), { '1': 'b' });
      // A sessão continua utilizável depois do clear (novo pareamento).
      await a.setCreds('nova');
      assert.equal(await a.getCreds(), 'nova');
    });

    test('auth state não se mistura com namespaces', async (port) => {
      await port.authState('main').setCreds('auth');
      await port.forNamespace('main').kv.set('creds', 'kv');
      assert.equal(await port.authState('main').getCreds(), 'auth');
      await port.authState('main').clear();
      assert.equal(await port.forNamespace('main').kv.get('creds'), 'kv');
    });
  });

  api.describe('close', () => {
    test('depois de close toda operação rejeita com StorageClosedError', async (port) => {
      const storage = port.forNamespace('p');
      const items = storage.collection('items');
      const auth = port.authState('main');
      await port.close();
      await port.close(); // idempotente
      const operations: (() => Promise<unknown>)[] = [
        () => storage.kv.get('k'),
        () => storage.kv.set('k', 1),
        () => storage.kv.delete('k'),
        () => items.insert({ a: 1 }),
        () => items.get('x'),
        () => items.find(),
        () => items.update('x', { a: 2 }),
        () => items.delete('x'),
        () => port.forNamespace('outro').kv.get('k'),
        () => auth.getCreds(),
        () => auth.setCreds(1),
        () => auth.getKeys('t', ['1']),
        () => auth.setKeys({ t: { '1': 1 } }),
        () => auth.clear(),
      ];
      for (const operation of operations) {
        await assert.rejects(operation(), StorageClosedError);
      }
    });
  });
}

export function persistenceContract(api: ContractTestApi, test: ContractCase): void {
  api.describe('persistência', () => {
    test('KV, coleções (com a ordem de inserção) e auth state sobrevivem a reabrir', async (port, reopen) => {
      const storage = port.forNamespace('p');
      await storage.kv.set('k', { v: 1 });
      const items = storage.collection('items', { indexes: ['n'] });
      const first = await items.insert({ tag: 'b', n: 1 });
      await items.insert({ tag: 'a', n: 1 });
      await port.authState('main').setCreds({ me: '1' });
      await port.authState('main').setKeys({ t: { '1': 'x' } });

      const reopened = await reopen(port);
      const again = reopened.forNamespace('p');
      assert.deepEqual(await again.kv.get('k'), { v: 1 });
      const found = await again.collection('items', { indexes: ['n'] }).find({ orderBy: 'n' });
      assert.deepEqual(
        found.map((doc) => doc['tag']),
        ['b', 'a'],
      );
      assert.equal(found[0]?.id, first);
      assert.deepEqual(await reopened.authState('main').getCreds(), { me: '1' });
      assert.deepEqual(await reopened.authState('main').getKeys('t', ['1']), { '1': 'x' });
    });
  });
}
