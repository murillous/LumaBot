import { definePlugin } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemory,
  type LongMemory,
  type MemoryDoc,
  normalize,
  renderMemory,
} from './memory.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

/** A memória sobre o storage de verdade do kit de testes, com relógio injetável. */
async function memoryWith(blockChars = 100, maxAgeMs = 1000) {
  let now = 0;
  let memory: LongMemory | undefined;
  bot = await createTestBot({
    plugins: [
      definePlugin({
        name: 'mem',
        version: '0.0.0',
        engine: '<1.0.0',
        setup: (ctx) => {
          memory = createMemory(ctx.storage.collection<MemoryDoc>('memory'), {
            blockChars,
            maxAgeMs,
            now: () => now,
          });
        },
      }),
    ],
  });
  if (!memory) throw new Error('memória não criada');
  return {
    memory,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createMemory', () => {
  it('guarda no bloco do chat e no de cada pessoa, por chat', async () => {
    const { memory } = await memoryWith();

    await memory.remember('c', '', '', 'o grupo joga sexta');
    await memory.remember('c', 'joao@x', 'João', 'é corintiano');
    await memory.remember('outro', 'joao@x', 'João', 'é palmeirense');

    const blocks = await memory.blocks('c', new Map([['joao@x', 'Joãozinho']]));
    expect(blocks).toEqual({
      chat: ['o grupo joga sexta'],
      people: [{ name: 'Joãozinho', facts: ['é corintiano'] }],
    });
    // Só quem está na conversa entra.
    expect((await memory.blocks('c', new Map())).people).toEqual([]);
  });

  it('fato repetido só renova o prazo; bloco cheio recusa com o que ele tem', async () => {
    const { memory } = await memoryWith(30);

    await memory.remember('c', 'a@x', 'Ana', 'gosta de pizza');
    expect(await memory.remember('c', 'a@x', 'Ana', 'Gosta  de PIZZA')).toEqual({
      ok: true,
      facts: ['gosta de pizza'],
    });
    expect(await memory.remember('c', 'a@x', 'Ana', 'odeia acordar cedo')).toEqual({
      ok: false,
      facts: ['gosta de pizza'],
    });
    expect(await memory.facts('c', 'a@x')).toEqual(['gosta de pizza']);
  });

  it('fato sem ser lembrado no prazo expira; lembrar de novo renova', async () => {
    const { memory, advance } = await memoryWith(100, 1000);
    await memory.remember('c', '', '', 'velho');
    await memory.remember('c', '', '', 'renovado');

    advance(800);
    await memory.remember('c', '', '', 'renovado');
    advance(400);

    expect(await memory.facts('c', '')).toEqual(['renovado']);
  });

  it('forget apaga o que bate (sem acento nem caixa) ou o bloco inteiro; clear, o chat', async () => {
    const { memory } = await memoryWith();
    await memory.remember('c', 'b@x', 'Bia', 'não gosta de ser chamada de Bianca');
    await memory.remember('c', 'b@x', 'Bia', 'mora em Recife');
    await memory.remember('c', '', '', 'combinado: churrasco no sábado');

    expect(await memory.forget('c', 'b@x', 'BIANCA')).toBe(1);
    expect(await memory.facts('c', 'b@x')).toEqual(['mora em Recife']);
    expect(await memory.forget('c', 'b@x', 'futebol')).toBe(0);
    expect(await memory.forget('c', 'b@x')).toBe(1);
    expect(await memory.clear('c')).toBe(1);
    expect(await memory.facts('c', '')).toEqual([]);
  });
});

describe('renderMemory e normalize', () => {
  it('um bloco por seção; sem fato, nada', () => {
    expect(renderMemory({ chat: [], people: [] })).toBe('');
    expect(
      renderMemory({ chat: ['churrasco sábado'], people: [{ name: 'Ana', facts: ['é vegana'] }] }),
    ).toBe('Deste chat:\n- churrasco sábado\n\nSobre Ana:\n- é vegana');
  });

  it('compara sem acento, caixa nem espaço sobrando', () => {
    expect(normalize('  JOÃO   Paulo ')).toBe('joao paulo');
  });
});
