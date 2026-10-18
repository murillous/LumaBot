import { createTestBot, type TestBot } from '@usebridger/testing';
import { APICallError } from 'ai';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '#plugins/ai/ai.ts';
import { fakeProvider, promptText, scripted } from '#plugins/ai-testing.ts';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
import { ping } from '#plugins/ping.ts';
import { userNames } from '#plugins/user-names/user-names.ts';
import { resumo } from './resumo.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true };

async function start(
  model: ReturnType<typeof scripted>,
  resumoConfig: Record<string, unknown> = {},
) {
  bot = await createTestBot({
    plugins: [ai, fakeProvider({ a: model }), resumo, aiToolsProbe],
    pluginConfig: { ai: { models: [{ model: 'fake:a' }] }, resumo: resumoConfig },
  });
  return bot;
}

const say = (b: TestBot, text: string, name: string, chat = group) =>
  b.receive({ text, chat, sender: { id: `${name}@x`, name } });

describe('!resumo', () => {
  it('resume a conversa do chat com a voz da Luma', async () => {
    const model = scripted('a Ana e o Bia combinaram pizza');
    const b = await start(model);
    await say(b, 'vamos de pizza?', 'Ana');
    await say(b, 'bora, às 20h', 'Bia');

    await b.receive({ text: '!resumo', chat: group });

    expect(b.sent).toHaveReplied('📋 *Resumo da conversa:*\n\na Ana e o Bia combinaram pizza');
    const prompt = promptText(model);
    expect(prompt).toContain('Ana: vamos de pizza?');
    expect(prompt).toContain('Bia: bora, às 20h');
    expect(prompt).toContain('Você é a Luma');
    expect(prompt).not.toContain('!resumo');
  });

  it('!resumo n resume só as últimas n, com teto em maxLimit', async () => {
    const model = scripted('ok');
    const b = await start(model, { maxLimit: 3, defaultLimit: 2 });
    for (const t of ['um', 'dois', 'três', 'quatro', 'cinco']) await say(b, t, 'Ana');

    await b.receive({ text: '!resumo 2', chat: group });
    await b.receive({ text: '!resumo 99', chat: group });
    await b.receive({ text: '!resumo', chat: group });

    expect(promptText(model, 0)).toMatch(/quatro.*cinco/s);
    expect(promptText(model, 0)).not.toContain('três');
    expect(promptText(model, 1)).toContain('três');
    expect(promptText(model, 1)).not.toContain('dois');
    expect(promptText(model, 2)).not.toContain('três');
  });

  it('argumento que não é número cai no padrão', async () => {
    const model = scripted('ok');
    const b = await start(model, { defaultLimit: 1 });
    await say(b, 'primeira', 'Ana');
    await say(b, 'segunda', 'Ana');

    await b.receive({ text: '!resumo abc', chat: group });

    expect(promptText(model)).toContain('segunda');
    expect(promptText(model)).not.toContain('primeira');
  });

  it('cada chat tem a sua conversa', async () => {
    const model = scripted('ok');
    const b = await start(model);
    await say(b, 'assunto do grupo A', 'Ana', { id: 'a@fake', isGroup: true });

    await b.receive({ text: '!resumo', chat: { id: 'b@fake', isGroup: true } });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(b.sent).toHaveReplied('📭 Não tem conversa recente salva aqui ainda.');
  });

  it('só guarda a conversa: o próprio comando e os outros comandos ficam de fora', async () => {
    const model = scripted('ok');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), resumo, ping],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });
    const b = bot;
    await say(b, 'oi pessoal', 'Ana');
    await say(b, '!ping', 'Ana');

    await b.receive({ text: '!resumo', chat: group });

    expect(promptText(model)).not.toContain('!ping');
  });

  it('mensagem só de mídia, sem legenda, não entra', async () => {
    const model = scripted('ok');
    const b = await start(model);
    await b.receive({ sticker: Buffer.from('x'), chat: group });

    await b.receive({ text: '!resumo', chat: group });

    expect(b.sent).toHaveReplied('📭 Não tem conversa recente salva aqui ainda.');
  });

  it('falha da IA: resposta curta, sem vazar a causa', async () => {
    const err = new APICallError({
      message: 'boom',
      url: 'x',
      requestBodyValues: {},
      statusCode: 400,
    });
    const b = await start(scripted(err));
    await say(b, 'oi', 'Ana');

    await b.receive({ text: '!resumo', chat: group });

    expect(b.sent).toHaveReplied('❌ Não consegui gerar o resumo agora.');
  });

  it('resposta vazia da IA também é falha', async () => {
    const b = await start(scripted('   '));
    await say(b, 'oi', 'Ana');

    await b.receive({ text: '!resumo', chat: group });

    expect(b.sent).toHaveReplied('❌ Não consegui gerar o resumo agora.');
  });

  it('usa a cadeia própria do resumo', async () => {
    const principal = scripted('da principal');
    const barata = scripted('da barata');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ p: principal, b: barata }), resumo],
      pluginConfig: {
        ai: { models: [{ model: 'fake:p' }] },
        resumo: { models: [{ model: 'fake:b' }] },
      },
    });
    await say(bot, 'oi', 'Ana');

    await bot.receive({ text: '!resumo', chat: group });

    expect(bot.sent).toContainText(/da barata/);
    expect(principal.doGenerateCalls).toHaveLength(0);
  });

  it('a janela guarda só bufferSize mensagens', async () => {
    const model = scripted('ok');
    const b = await start(model, { bufferSize: 2 });
    for (const t of ['velha', 'meio', 'nova']) await say(b, t, 'Ana');

    await b.receive({ text: '!resumo', chat: group });

    expect(promptText(model)).not.toContain('velha');
    expect(promptText(model)).toContain('meio');
  });

  it('usa o apelido do user-names, se o plugin existe', async () => {
    const model = scripted('ok');
    bot = await createTestBot({
      plugins: [ai, fakeProvider({ a: model }), userNames, resumo],
      pluginConfig: { ai: { models: [{ model: 'fake:a' }] } },
    });
    await bot.receive({ text: '!nick Aninha', sender: { id: 'Ana@x', name: 'Ana' } });
    await say(bot, 'oi', 'Ana');

    await bot.receive({ text: '!resumo', chat: group });

    expect(promptText(model)).toContain('Aninha: oi');
  });

  it('config incoerente impede o boot', async () => {
    await expect(
      createTestBot({
        plugins: [ai, resumo],
        pluginConfig: { resumo: { defaultLimit: 500, maxLimit: 200 } },
      }),
    ).rejects.toThrow(/defaultLimit/);
  });
});

describe('tool summarize_chat', () => {
  it('devolve o resumo só ao modelo', async () => {
    const b = await start(scripted('resumo pronto'));
    await say(b, 'vamos de pizza?', 'Ana');

    await b.receive({ text: '!tool summarize_chat', chat: group });

    expect(toolResult(b)).toEqual({ ok: true, summary: 'resumo pronto' });
    expect(b.sent).not.toContainText(/📋/);
  });

  it('sem conversa: no-history', async () => {
    const b = await start(scripted('x'));

    await b.receive({ text: '!tool summarize_chat', chat: group });

    expect(toolResult(b)).toEqual({ ok: false, error: 'no-history' });
  });
});
