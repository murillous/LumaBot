import { definePlugin, type ExtensionPoint } from '@usebridger/core';
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
} from './ai-tools.ts';
import { download } from './download/download.ts';
import { help } from './help/help.ts';
import { pdf } from './pdf/pdf.ts';
import { rank } from './rank/rank.ts';
import { reminders } from './reminders/reminders.ts';
import { sticker } from './sticker/sticker.ts';
import { stickerConvert } from './sticker-convert/sticker-convert.ts';
import { userNames } from './user-names/user-names.ts';
import { utils } from './utils/utils.ts';

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

const toolCtx = () => ({ log: { error: vi.fn() } }) as unknown as AiToolContext;

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
    expect(ctx.log.error).toHaveBeenCalledOnce();
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

describe('catálogo do app', () => {
  it('cada plugin da tabela do #375 contribui suas tools, com nome único e JSON Schema', async () => {
    let view: ExtensionPoint<AiTool> | undefined;
    const reader = definePlugin({
      name: 'reader',
      version: '0.0.0',
      engine: '<1.0.0',
      setup: (ctx) => {
        view = ctx.services.extensionPoint('ai.tools');
      },
    });
    bot = await createTestBot({
      plugins: [
        help,
        sticker,
        stickerConvert,
        pdf(),
        reminders,
        download(),
        userNames,
        rank,
        utils,
        reader,
      ],
    });

    const tools = view?.list() ?? [];
    expect(tools.map((t) => t.name).sort()).toEqual([
      'cancel_reminder',
      'chat_info',
      'create_reminder',
      'create_sticker',
      'download_audio',
      'download_media',
      'download_sticker',
      'get_name',
      'image_to_pdf',
      'list_commands',
      'list_reminders',
      'merge_pdfs',
      'ranking',
      'set_nickname',
      'sticker_to_image',
      'sticker_to_video',
    ]);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(tool.description).not.toBe('');
      expect(z.toJSONSchema(tool.args, { io: 'input' })).toMatchObject({ type: 'object' });
    }
  });
});
