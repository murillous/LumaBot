// Contrato das coleções: CRUD, filtros, ordenação, paginação e validação da consulta.

import assert from 'node:assert/strict';
import type {
  Collection,
  FindQuery,
  JsonObject,
  JsonValue,
  StoragePort,
  Where,
} from '#storage/types.ts';
import type { ContractCase, ContractTestApi } from './harness.ts';

type Doc = JsonObject;

async function seed(collection: Collection<Doc>, docs: readonly Doc[]): Promise<string[]> {
  const ids: string[] = [];
  for (const doc of docs) ids.push(await collection.insert(doc));
  return ids;
}

function tags(docs: readonly Doc[]): JsonValue[] {
  return docs.map((doc) => doc['tag'] ?? null);
}

// Documentos com tipos misturados no campo `v`, para filtros e ordenação.
const MIXED: readonly Doc[] = [
  { tag: 's-b', v: 'b' },
  { tag: 'n-2', v: 2 },
  { tag: 'null', v: null },
  { tag: 'true', v: true },
  { tag: 'arr', v: [1] },
  { tag: 'n-10', v: 10 },
  { tag: 'missing' },
  { tag: 's-a', v: 'a' },
  { tag: 'false', v: false },
  { tag: 'obj', v: { a: 1 } },
  { tag: 'n--1', v: -1 },
  { tag: 's-1', v: '1' },
  { tag: 'n-1', v: 1 },
];

async function findTags(port: StoragePort, query: FindQuery<Doc>): Promise<JsonValue[]> {
  const collection = port.forNamespace('p').collection<Doc>('mixed');
  if ((await collection.find({ limit: 1 })).length === 0) await seed(collection, MIXED);
  return tags(await collection.find(query));
}

export function collectionContract(api: ContractTestApi, test: ContractCase): void {
  api.describe('coleções: CRUD', () => {
    test('insert devolve ids únicos e get devolve o documento com o id', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const ids = await seed(items, [{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }]);
      assert.equal(new Set(ids).size, 3);
      for (const id of ids) assert.ok(typeof id === 'string' && id.length > 0);
      assert.deepEqual(await items.get(ids[1] as string), { tag: 'b', id: ids[1] });
      assert.equal(await items.get('id-que-nao-existe'), undefined);
    });

    test('find sem consulta devolve tudo na ordem de inserção', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await seed(items, [{ tag: 'c' }, { tag: 'a' }, { tag: 'b' }]);
      assert.deepEqual(tags(await items.find()), ['c', 'a', 'b']);
    });

    test('insert recusa o campo reservado id e não-objetos', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await assert.rejects(items.insert({ id: 'x', tag: 'a' }), TypeError);
      await assert.rejects(items.insert([1] as unknown as Doc), TypeError);
      await assert.rejects(items.insert(null as unknown as Doc), TypeError);
      assert.deepEqual(await items.find(), []);
    });

    test('documentos entram e saem como cópia', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const input = { tag: 'a', list: [1] };
      const id = await items.insert(input);
      input.list.push(2);
      const found = await items.get(id);
      assert.ok(found !== undefined);
      assert.deepEqual(found['list'], [1]);
      (found['list'] as number[]).push(3);
      const [first] = await items.find();
      assert.ok(first !== undefined);
      assert.deepEqual(first['list'], [1]);
      (first['list'] as number[]).push(4);
      assert.deepEqual((await items.get(id))?.['list'], [1]);
    });

    test('campos undefined somem, como no JSON', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const id = await items.insert({ tag: 'a', gone: undefined } as unknown as Doc);
      const found = await items.get(id);
      assert.deepEqual(found, { tag: 'a', id });
      assert.equal(Object.hasOwn(found ?? {}, 'gone'), false);
    });

    test('a mesma coleção pedida de novo enxerga os dados; nomes distintos isolam', async (port) => {
      const storage = port.forNamespace('p');
      await storage.collection<Doc>('a').insert({ tag: 'a' });
      await storage.collection<Doc>('b').insert({ tag: 'b' });
      assert.deepEqual(tags(await storage.collection<Doc>('a').find()), ['a']);
      assert.deepEqual(tags(await storage.collection<Doc>('b').find()), ['b']);
    });

    test('índices declarados não mudam o resultado', async (port) => {
      const storage = port.forNamespace('p');
      const plain = storage.collection<Doc>('items');
      await seed(plain, [
        { tag: 'b', n: 2 },
        { tag: 'a', n: 1 },
      ]);
      const indexed = storage.collection<Doc>('items', { indexes: ['n', 'tag', 'n'] });
      assert.deepEqual(tags(await indexed.find({ where: { n: { gte: 1 } }, orderBy: 'n' })), [
        'a',
        'b',
      ]);
    });

    test('índice com nome de campo inválido lança TypeError', async (port) => {
      const storage = port.forNamespace('p');
      assert.throws(() => storage.collection('items', { indexes: ['a.b'] }), TypeError);
      assert.throws(() => storage.collection('items', { indexes: [''] }), TypeError);
    });

    test('update por id faz merge raso e devolve quantos casaram', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const [id] = await seed(items, [{ tag: 'a', n: 1, nested: { x: 1, y: 2 } }]);
      assert.equal(await items.update(id as string, { n: 2, nested: { x: 9 }, extra: 'e' }), 1);
      assert.deepEqual(await items.get(id as string), {
        tag: 'a',
        n: 2,
        nested: { x: 9 },
        extra: 'e',
        id,
      });
      assert.equal(await items.update('id-que-nao-existe', { n: 3 }), 0);
    });

    test('update por filtro altera todos os que casam', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await seed(items, [
        { tag: 'a', done: false },
        { tag: 'b', done: true },
        { tag: 'c', done: false },
      ]);
      assert.equal(await items.update({ done: false }, { done: true }), 2);
      assert.equal((await items.find({ where: { done: true } })).length, 3);
      assert.equal(await items.update({ tag: 'z' }, { done: false }), 0);
    });

    test('update com patch vazio conta os que casaram e não muda nada', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const [id] = await seed(items, [{ tag: 'a' }]);
      assert.equal(await items.update(id as string, {}), 1);
      assert.deepEqual(await items.get(id as string), { tag: 'a', id });
    });

    test('update recusa patch com id e não grava nada', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const [id] = await seed(items, [{ tag: 'a' }]);
      await assert.rejects(items.update(id as string, { id: 'x', tag: 'b' }), TypeError);
      assert.deepEqual(await items.get(id as string), { tag: 'a', id });
    });

    test('update não muda a posição do documento na ordem de inserção', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const [first] = await seed(items, [{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }]);
      await items.update(first as string, { tag: 'a2' });
      assert.deepEqual(tags(await items.find()), ['a2', 'b', 'c']);
    });

    test('delete por id e por filtro devolve quantos removeu', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const [first] = await seed(items, [
        { tag: 'a', n: 1 },
        { tag: 'b', n: 2 },
        { tag: 'c', n: 3 },
        { tag: 'd', n: 4 },
      ]);
      assert.equal(await items.delete(first as string), 1);
      assert.equal(await items.delete(first as string), 0);
      assert.equal(await items.get(first as string), undefined);
      assert.equal(await items.delete({ n: { gte: 3 } }), 2);
      assert.deepEqual(tags(await items.find()), ['b']);
      assert.equal(await items.delete({}), 1);
      assert.deepEqual(await items.find(), []);
    });
  });

  api.describe('coleções: filtros', () => {
    test('valor escalar é eq implícito e compara tipo e valor', async (port) => {
      assert.deepEqual(await findTags(port, { where: { v: 1 } }), ['n-1']);
      assert.deepEqual(await findTags(port, { where: { v: { eq: 1 } } }), ['n-1']);
      assert.deepEqual(await findTags(port, { where: { v: '1' } }), ['s-1']);
      assert.deepEqual(await findTags(port, { where: { v: true } }), ['true']);
      assert.deepEqual(await findTags(port, { where: { v: false } }), ['false']);
    });

    test('null casa com null e com campo ausente', async (port) => {
      assert.deepEqual(await findTags(port, { where: { v: null } }), ['null', 'missing']);
      assert.deepEqual(await findTags(port, { where: { nunca: null } }), tags(MIXED));
    });

    test('ne é o complemento exato de eq (inclui ausentes, arrays e objetos)', async (port) => {
      assert.deepEqual(
        await findTags(port, { where: { v: { ne: 1 } } }),
        tags(MIXED).filter((tag) => tag !== 'n-1'),
      );
      assert.deepEqual(
        await findTags(port, { where: { v: { ne: null } } }),
        tags(MIXED).filter((tag) => tag !== 'null' && tag !== 'missing'),
      );
    });

    test('gt/gte/lt/lte em números só casam com números', async (port) => {
      assert.deepEqual(await findTags(port, { where: { v: { gt: 1 } } }), ['n-2', 'n-10']);
      assert.deepEqual(await findTags(port, { where: { v: { gte: 1 } } }), ['n-2', 'n-10', 'n-1']);
      assert.deepEqual(await findTags(port, { where: { v: { lt: 1 } } }), ['n--1']);
      assert.deepEqual(await findTags(port, { where: { v: { lte: 1 } } }), ['n--1', 'n-1']);
    });

    test('gt/gte/lt/lte em texto só casam com texto', async (port) => {
      assert.deepEqual(await findTags(port, { where: { v: { gte: 'a' } } }), ['s-b', 's-a']);
      assert.deepEqual(await findTags(port, { where: { v: { lt: 'b' } } }), ['s-a', 's-1']);
    });

    test('vários operadores no mesmo campo combinam com E', async (port) => {
      assert.deepEqual(await findTags(port, { where: { v: { gt: -1, lte: 2 } } }), ['n-2', 'n-1']);
      assert.deepEqual(await findTags(port, { where: { v: { gte: 1, ne: 2 } } }), ['n-10', 'n-1']);
    });

    test('vários campos combinam com E', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await seed(items, [
        { tag: 'a', chat: 'x', n: 1 },
        { tag: 'b', chat: 'y', n: 1 },
        { tag: 'c', chat: 'x', n: 2 },
      ]);
      assert.deepEqual(tags(await items.find({ where: { chat: 'x', n: 1 } })), ['a']);
    });

    test('in casa com qualquer item, com a igualdade de eq', async (port) => {
      assert.deepEqual(await findTags(port, { where: { v: { in: [1, 'a', null] } } }), [
        'null',
        'missing',
        's-a',
        'n-1',
      ]);
      assert.deepEqual(await findTags(port, { where: { v: { in: [] } } }), []);
    });

    test('texto é comparado por code point (ordem UTF-8)', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      // Em UTF-16, '😀' (surrogates D83D DE00) vem antes de 'ｚ' (FF5A); por code point, depois.
      await seed(items, [
        { tag: 'emoji', s: '😀' },
        { tag: 'wide', s: 'ｚ' },
        { tag: 'ascii', s: 'z' },
      ]);
      assert.deepEqual(tags(await items.find({ where: { s: { gt: 'ｚ' } } })), ['emoji']);
      assert.deepEqual(tags(await items.find({ orderBy: 's' })), ['ascii', 'wide', 'emoji']);
    });

    test('filtra e ordena pelo id', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      const ids = await seed(items, [{ tag: 'a' }, { tag: 'b' }, { tag: 'c' }]);
      assert.deepEqual(tags(await items.find({ where: { id: ids[1] as string } })), ['b']);
      assert.deepEqual(
        (await items.find({ orderBy: 'id' })).map((doc) => doc.id),
        [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    });

    test('filtro com campo undefined é ignorado', async (port) => {
      const where = { v: undefined } as unknown as Where<Doc>;
      assert.deepEqual(await findTags(port, { where }), tags(MIXED));
    });
  });

  api.describe('coleções: ordenação e paginação', () => {
    test('asc ordena entre tipos: null/ausente < booleano < número < texto < array/objeto', async (port) => {
      assert.deepEqual(await findTags(port, { orderBy: 'v' }), [
        'null',
        'missing',
        'false',
        'true',
        'n--1',
        'n-1',
        'n-2',
        'n-10',
        's-1',
        's-a',
        's-b',
        'arr',
        'obj',
      ]);
    });

    test('desc inverte a ordem, mas empates seguem a inserção', async (port) => {
      assert.deepEqual(await findTags(port, { orderBy: { field: 'v', direction: 'desc' } }), [
        'arr',
        'obj',
        's-b',
        's-a',
        's-1',
        'n-10',
        'n-2',
        'n-1',
        'n--1',
        'true',
        'false',
        'null',
        'missing',
      ]);
    });

    test('vários critérios, em ordem de precedência', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await seed(items, [
        { tag: 'a', chat: 'x', score: 1 },
        { tag: 'b', chat: 'y', score: 5 },
        { tag: 'c', chat: 'x', score: 3 },
        { tag: 'd', chat: 'y', score: 5 },
        { tag: 'e', chat: 'x', score: 3 },
      ]);
      assert.deepEqual(
        tags(await items.find({ orderBy: ['chat', { field: 'score', direction: 'desc' }] })),
        ['c', 'e', 'a', 'b', 'd'],
      );
      assert.deepEqual(tags(await items.find({ orderBy: [{ field: 'score' }] })), [
        'a',
        'c',
        'e',
        'b',
        'd',
      ]);
    });

    test('limit e offset paginam depois de filtrar e ordenar', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await seed(
        items,
        [5, 3, 1, 4, 2].map((n) => ({ tag: `t${n}`, n })),
      );
      assert.deepEqual(tags(await items.find({ orderBy: 'n', limit: 2 })), ['t1', 't2']);
      assert.deepEqual(tags(await items.find({ orderBy: 'n', limit: 2, offset: 2 })), ['t3', 't4']);
      assert.deepEqual(tags(await items.find({ orderBy: 'n', offset: 4 })), ['t5']);
      assert.deepEqual(tags(await items.find({ orderBy: 'n', offset: 9 })), []);
      assert.deepEqual(tags(await items.find({ limit: 0 })), []);
      assert.deepEqual(
        tags(await items.find({ where: { n: { gt: 1 } }, orderBy: 'n', limit: 1, offset: 1 })),
        ['t3'],
      );
    });

    test('vencidos até agora, ordenados por horário (caso do scheduler)', async (port) => {
      const jobs = port.forNamespace('$scheduler').collection<Doc>('jobs', { indexes: ['fireAt'] });
      const now = 1_000_000;
      await seed(jobs, [
        { tag: 'futuro', fireAt: now + 1 },
        { tag: 'atrasado-2', fireAt: now - 10 },
        { tag: 'agora', fireAt: now },
        { tag: 'atrasado-1', fireAt: now - 20 },
        { tag: 'empate', fireAt: now - 10 },
      ]);
      const due = await jobs.find({ where: { fireAt: { lte: now } }, orderBy: 'fireAt', limit: 3 });
      assert.deepEqual(tags(due), ['atrasado-1', 'atrasado-2', 'empate']);
    });
  });

  api.describe('coleções: consultas inválidas', () => {
    const invalid: readonly [string, FindQuery<Doc>, typeof TypeError | typeof RangeError][] = [
      ['operador desconhecido', { where: { v: { like: 'a' } as never } }, TypeError],
      ['objeto de operadores vazio', { where: { v: {} } }, TypeError],
      ['campo aninhado', { where: { 'a.b': 1 } }, TypeError],
      ['campo vazio', { where: { '': 1 } }, TypeError],
      ['array como valor de eq', { where: { v: [1] as never } }, TypeError],
      ['objeto em eq', { where: { v: { eq: { a: 1 } as never } } }, TypeError],
      ['NaN como operando', { where: { v: { gt: Number.NaN } } }, TypeError],
      ['booleano em gt', { where: { v: { gt: true as never } } }, TypeError],
      ['null em lt', { where: { v: { lt: null as never } } }, TypeError],
      ['in que não é array', { where: { v: { in: 1 as never } } }, TypeError],
      ['in com item não escalar', { where: { v: { in: [[1]] as never } } }, TypeError],
      ['orderBy com campo inválido', { orderBy: 'a.b' }, TypeError],
      [
        'orderBy com direção inválida',
        { orderBy: { field: 'v', direction: 'up' as never } },
        TypeError,
      ],
      ['limit negativo', { limit: -1 }, RangeError],
      ['limit fracionário', { limit: 1.5 }, RangeError],
      ['offset negativo', { offset: -1 }, RangeError],
    ];
    for (const [name, query, error] of invalid) {
      test(`${name} rejeita com ${error.name}`, async (port) => {
        const items = port.forNamespace('p').collection<Doc>('items');
        await assert.rejects(items.find(query), error);
      });
    }

    test('update e delete validam o filtro antes de alterar', async (port) => {
      const items = port.forNamespace('p').collection<Doc>('items');
      await seed(items, [{ tag: 'a' }]);
      await assert.rejects(items.update({ tag: { like: 'a' } as never }, { tag: 'b' }), TypeError);
      await assert.rejects(items.delete({ 'a.b': 1 }), TypeError);
      assert.deepEqual(tags(await items.find()), ['a']);
    });
  });
}
