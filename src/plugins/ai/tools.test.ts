import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  type AiTool,
  type AiToolContext,
  aiTool,
  invokeTool,
  mediaMessage,
  offeredTools,
  TOOL_FAILED,
} from './tools.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const echo = aiTool({
  name: 'echo',
  description: 'Devolve o texto',
  args: z.object({ text: z.string() }),
  run: async ({ text }) => text,
});

const toolCtx = () => ({ log: { event: vi.fn() } }) as unknown as AiToolContext;

describe('invokeTool', () => {
  it('roda a tool com os argumentos validados', async () => {
    expect(await invokeTool(echo, { text: 'oi' }, toolCtx())).toBe('oi');
  });

  it('argumento inválido volta para o modelo sem rodar', async () => {
    const run = vi.fn();
    const result = await invokeTool({ ...echo, run }, { text: 1 }, toolCtx());

    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: 'invalid-args' });
  });

  it('falha inesperada vira resultado e vai para o log', async () => {
    const ctx = toolCtx();
    const boom = { ...echo, run: () => Promise.reject(new Error('boom')) };

    expect(await invokeTool(boom, { text: 'oi' }, ctx)).toEqual({ ok: false, error: 'failed' });
    expect(ctx.log.event).toHaveBeenCalledExactlyOnceWith(TOOL_FAILED, {
      err: expect.any(Error),
      tool: 'echo',
    });
  });
});

describe('offeredTools', () => {
  it('tira a tool cujo `requires` o transport não tem', () => {
    const image: AiTool = { ...echo, name: 'image', requires: ['send.image'] };

    expect(offeredTools([echo, image], new Set(['send.text']))).toEqual([echo]);
    expect(offeredTools([echo, image], new Set(['send.image']))).toEqual([echo, image]);
  });
});

describe('mediaMessage', () => {
  it('usa a mídia da mensagem e, na falta, a da citada', async () => {
    bot = await createTestBot({ plugins: [] });
    const own = await bot.receive({ text: 'x', image: fixtures.image() });
    const quoting = await bot.receive({ text: 'x', quoted: { sticker: fixtures.image() } });

    expect(mediaMessage(own, ['image'])).toBe(own);
    expect(mediaMessage(quoting, ['sticker'])).toBe(quoting.quoted);
    expect(mediaMessage(own, ['sticker'])).toBeNull();
  });
});
