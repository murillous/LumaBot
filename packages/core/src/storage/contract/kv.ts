// Contrato do KV e do isolamento por namespace.

import assert from 'node:assert/strict';
import { ReservedNamespaceError } from '#storage/errors.ts';
import { kernelStorage, pluginStorage } from '#storage/namespace.ts';
import type { JsonValue } from '#storage/types.ts';
import type { ContractCase, ContractTestApi } from './harness.ts';

export function kvContract(api: ContractTestApi, test: ContractCase): void {
  api.describe('KV', () => {
    test('get de chave inexistente devolve undefined', async (port) => {
      assert.equal(await port.forNamespace('p').kv.get('nada'), undefined);
    });

    test('guarda e devolve qualquer JsonValue', async (port) => {
      const { kv } = port.forNamespace('p');
      const values: JsonValue[] = [
        'texto',
        '',
        0,
        -1.5,
        true,
        false,
        null,
        [],
        [1, 'a', null, [true]],
        {},
        { a: { b: [1, { c: 'd' }] }, e: null },
      ];
      for (const [index, value] of values.entries()) await kv.set(`k${index}`, value);
      for (const [index, value] of values.entries()) {
        assert.deepEqual(await kv.get(`k${index}`), value);
      }
    });

    test('set substitui o valor anterior', async (port) => {
      const { kv } = port.forNamespace('p');
      await kv.set('k', { a: 1 });
      await kv.set('k', 'outro');
      assert.equal(await kv.get('k'), 'outro');
    });

    test('delete devolve se a chave existia e a remove', async (port) => {
      const { kv } = port.forNamespace('p');
      await kv.set('k', 1);
      assert.equal(await kv.delete('k'), true);
      assert.equal(await kv.get('k'), undefined);
      assert.equal(await kv.delete('k'), false);
    });

    test('aceita chaves arbitrárias (vazia, com separadores, unicode)', async (port) => {
      const { kv } = port.forNamespace('p');
      const keys = ['', ':', 'a:b', 'a/b', 'a.b', "a'b", 'ção 😀'];
      for (const key of keys) await kv.set(key, key);
      for (const key of keys) assert.equal(await kv.get(key), key);
    });

    test('valores entram e saem como cópia', async (port) => {
      const { kv } = port.forNamespace('p');
      const input = { list: [1] };
      await kv.set('k', input);
      input.list.push(2);
      const first = await kv.get<{ list: number[] }>('k');
      assert.deepEqual(first, { list: [1] });
      first?.list.push(3);
      assert.deepEqual(await kv.get('k'), { list: [1] });
    });

    test('segue a semântica de JSON.stringify (undefined some, NaN vira null)', async (port) => {
      const { kv } = port.forNamespace('p');
      const value = { a: undefined, b: Number.NaN, c: [Number.POSITIVE_INFINITY] };
      await kv.set('k', value as unknown as JsonValue);
      assert.deepEqual(await kv.get('k'), { b: null, c: [null] });
    });
  });

  api.describe('namespaces', () => {
    test('a mesma chave em namespaces distintos não colide', async (port) => {
      await port.forNamespace('a').kv.set('k', 'a');
      await port.forNamespace('b').kv.set('k', 'b');
      assert.equal(await port.forNamespace('a').kv.get('k'), 'a');
      assert.equal(await port.forNamespace('b').kv.get('k'), 'b');
      await port.forNamespace('a').kv.delete('k');
      assert.equal(await port.forNamespace('b').kv.get('k'), 'b');
    });

    test('forNamespace repetido enxerga os mesmos dados', async (port) => {
      await port.forNamespace('a').kv.set('k', 1);
      assert.equal(await port.forNamespace('a').kv.get('k'), 1);
    });

    test('concatenar namespace, coleção e chave não gera colisão', async (port) => {
      // Um adapter que monte "namespace:chave" sem escape juntaria estes pares.
      await port.forNamespace('a').kv.set('b:c', 'a + b:c');
      await port.forNamespace('a:b').kv.set('c', 'a:b + c');
      assert.equal(await port.forNamespace('a').kv.get('b:c'), 'a + b:c');
      assert.equal(await port.forNamespace('a:b').kv.get('c'), 'a:b + c');
      assert.equal(await port.forNamespace('a').kv.get('b'), undefined);

      await port.forNamespace('a').collection('b:c').insert({ from: 'a + b:c' });
      await port.forNamespace('a:b').collection('c').insert({ from: 'a:b + c' });
      assert.deepEqual(
        (await port.forNamespace('a').collection('b:c').find()).map((doc) => doc['from']),
        ['a + b:c'],
      );
      assert.deepEqual(
        (await port.forNamespace('a:b').collection('c').find()).map((doc) => doc['from']),
        ['a:b + c'],
      );
    });

    test('KV e coleção do mesmo namespace não se misturam', async (port) => {
      const storage = port.forNamespace('a');
      await storage.kv.set('docs', 1);
      await storage.collection('docs').insert({ x: 1 });
      assert.equal(await storage.kv.get('docs'), 1);
      assert.equal((await storage.collection('docs').find()).length, 1);
    });

    test('plugin não alcança o namespace reservado do kernel', async (port) => {
      await kernelStorage(port, 'scheduler').kv.set('k', 'kernel');
      const plugin = pluginStorage(port, 'scheduler');
      assert.equal(await plugin.kv.get('k'), undefined);
      await plugin.kv.set('k', 'plugin');
      assert.equal(await kernelStorage(port, 'scheduler').kv.get('k'), 'kernel');
      assert.throws(() => pluginStorage(port, '$scheduler'), ReservedNamespaceError);
    });
  });
}
