// As tools que os plugins do app contribuem no `ai.tools`: o catálogo inteiro e as que só leem.
// É teste do app, não do `ai`: junta plugins da Luma que o `ai` não conhece.

import { definePlugin, type ExtensionPoint } from '@usebridger/core';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, scripted, toolAnswer } from '#plugins/ai/testing.ts';
import type { AiTool } from '#plugins/ai/tools.ts';
import { download } from '#plugins/download/download.ts';
import { help } from '#plugins/help/help.ts';
import { pdf } from '#plugins/pdf/pdf.ts';
import { rank } from '#plugins/rank/rank.ts';
import { reminders } from '#plugins/reminders/reminders.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerConvert } from '#plugins/sticker-convert/sticker-convert.ts';
import { userNames } from '#plugins/user-names/user-names.ts';
import { utils } from '#plugins/utils/utils.ts';

let bot: TestBot;

afterEach(async () => {
  await bot.stop();
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

describe('tools só de leitura do app', () => {
  /** `!ask` pede ao `ai` com as tools oferecidas, como a Luma faria. */
  const caller = definePlugin({
    name: 'caller',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { ai: '^0.1.0' },
    setup: (ctx) => {
      ctx.commands.add({
        name: 'ask',
        run: async (c) =>
          (
            await ctx.services.get('ai').generate({
              purpose: 'teste',
              messages: [{ role: 'user', content: 'oi' }],
              toolContext: { message: c.message, reply: c.reply, signal: c.signal, log: c.log },
            })
          ).text,
      });
    },
  });
  const unavailable = new APICallError({
    message: 'http 503',
    url: 'x',
    requestBodyValues: {},
    statusCode: 503,
  });

  // Se uma perder o `sideEffects: false`, um 503 depois dela vira "Tô sem cabeça agora" em vez de
  // cair no próximo modelo.
  it.each(['list_commands', 'get_name', 'ranking', 'chat_info'])(
    'a tool %s não bloqueia o fallback',
    async (name) => {
      const a = scripted(toolAnswer(name, {}, 'já vi'), unavailable);
      bot = await createTestBot({
        plugins: [
          ai,
          fakeProvider({ a, b: scripted('de b') }),
          caller,
          help,
          userNames,
          rank,
          utils,
        ],
        pluginConfig: { ai: { models: [{ model: 'fake:a' }, { model: 'fake:b' }] } },
      });
      await bot.receive({ text: '!ask' });

      // O 2º passo de `a` só existe se a tool rodou e devolveu o resultado ao modelo.
      expect(a.doGenerateCalls).toHaveLength(2);
      expect(bot.sent.at(-1)?.content).toMatchObject({ type: 'text', text: 'de b' });
    },
  );
});
