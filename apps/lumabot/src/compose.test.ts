// A composição do app: todos os plugins juntos sobre o transport falso. Pega o que um plugin sozinho
// não vê: conflito de nome de comando ou de serviço, ciclo de dependência, plugin que não carrega.

import { metrics } from '@usebridger/plugin-metrics';
import { createTestBot, fixtures, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { aiMetrics } from '#plugins/ai-metrics/ai-metrics.ts';
import { fakeProvider, scripted } from '#plugins/ai-testing.ts';
import { download } from '#plugins/download/download.ts';
import { help } from '#plugins/help/help.ts';
import { luma } from '#plugins/luma/luma.ts';
import { pdf } from '#plugins/pdf/pdf.ts';
import { ping } from '#plugins/ping.ts';
import { rank } from '#plugins/rank/rank.ts';
import { reminders } from '#plugins/reminders/reminders.ts';
import { resumo } from '#plugins/resumo/resumo.ts';
import { spontaneous } from '#plugins/spontaneous/spontaneous.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerConvert } from '#plugins/sticker-convert/sticker-convert.ts';
import { stickerText } from '#plugins/sticker-text/sticker-text.ts';
import { transcribe } from '#plugins/transcribe/transcribe.ts';
import { userNames } from '#plugins/user-names/user-names.ts';
import { utils } from '#plugins/utils/utils.ts';
import { webSearch } from '#plugins/web-search/web-search.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

async function start(model = scripted('oi')) {
  bot = await createTestBot({
    plugins: [
      ping,
      metrics,
      ai,
      fakeProvider({ a: model }, { nativeSearch: true }),
      aiMetrics,
      luma,
      spontaneous,
      resumo,
      transcribe,
      webSearch(),
      help,
      sticker,
      stickerText,
      stickerConvert,
      pdf(),
      reminders,
      download({}),
      userNames,
      rank,
      utils,
    ],
    pluginConfig: {
      ai: { models: [{ model: 'fake:a' }] },
      luma: { thinkingDelayMs: { min: 0, max: 0 } },
    },
  });
  return bot;
}

describe('composição do app', () => {
  it('sobe com todos os plugins, sem conflito de comando, serviço ou dependência', async () => {
    const b = await start();

    const loaded = b.bot.plugins().filter((p) => p.status === 'loaded');
    expect(loaded.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'ai',
        'ai-metrics',
        'luma',
        'spontaneous',
        'resumo',
        'transcribe',
        'web-search',
      ]),
    );
    expect(b.bot.plugins().filter((p) => p.status !== 'loaded')).toEqual([]);
  });

  it('!help lista os comandos novos agrupados', async () => {
    const b = await start();

    await b.receive({ text: '!help' });

    const text = b.sent
      .flatMap(({ content }) => (content.type === 'text' ? [content.text] : []))
      .join('\n');
    expect(text).toMatch(/Inteligência artificial\*\n.*!luma/);
    expect(text).toMatch(/!resumo/);
    expect(text).toMatch(/!transcribe\* \(!t\)/);
    expect(text).toMatch(/!persona/);
  });

  it('a conversa com a Luma conta no rank e aparece no !luma stats', async () => {
    const b = await start();

    await b.receive({ text: 'oi', sender: { id: 'ana@x', name: 'Ana' } });
    await b.receive({ text: '!rank global' });
    await b.receive({ text: '!luma stats' });

    expect(b.sent).toContainText(/— 1/);
    expect(b.sent).toContainText(/Respostas: 1/);
  });

  it('a Luma pode criar figurinha pelo ai.tools do sticker', async () => {
    const { toolAnswer } = await import('#plugins/ai-testing.ts');
    const b = await start(scripted(toolAnswer('create_sticker', {}), 'prontinho'));

    await b.receive({ text: 'faz uma figurinha dessa imagem', image: fixtures.image() });

    expect(b.sent).toContainSticker();
    expect(b.sent).toHaveReplied('prontinho');
  });
});
