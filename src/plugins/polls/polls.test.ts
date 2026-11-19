import type { PollMessage } from '@usebridger/core';
import { createMessage } from '@usebridger/core/adapter';
import { createTestBot, type TestBot } from '@usebridger/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai/tools-probe.ts';
import { polls } from './polls.ts';

let bot: TestBot | undefined;
afterEach(async () => {
  await bot?.stop();
  bot = undefined;
});

const group = { id: 'grupo@fake', isGroup: true, title: 'Grupo' };
const ana = { id: 'ana@fake', name: 'Ana', phone: null, isBot: false };
const bia = { id: 'bia@fake', name: 'Bia', phone: null, isBot: false };

async function start() {
  bot = await createTestBot({ plugins: [polls, aiToolsProbe] });
  return bot;
}

/** Abre a enquete pela tool e devolve o envio dela. */
async function open(b: TestBot, args: Record<string, unknown>) {
  await b.receive({ text: `!tool create_poll ${JSON.stringify(args)}`, chat: group });
  const sent = b.sent.find((s) => s.content.type === 'poll');
  if (!sent) throw new Error('enquete não enviada');
  return sent;
}

const vote = (b: TestBot, messageId: string, sender: typeof ana, options: number[]) =>
  b.emit('poll.vote', {
    chat: { id: group.id, isGroup: true },
    messageId,
    sender,
    options,
    fromMe: false,
  } as never);

/** A enquete `id` como mensagem citada: o kit de teste não descreve enquete recebida. */
const pollMessage = (id: string, name: string, options: string[]): PollMessage =>
  createMessage({
    type: 'poll',
    id,
    chat: group,
    sender: ana,
    text: null,
    timestamp: Date.now(),
    fromMe: false,
    poll: { name, options },
  });

async function results(b: TestBot, quoted?: PollMessage) {
  await b.receive({ text: '!tool poll_results', chat: group, ...(quoted ? { quoted } : {}) });
  return toolResult(b);
}

describe('create_poll', () => {
  it('envia a enquete no chat com as opções', async () => {
    const b = await start();

    const sent = await open(b, {
      question: 'Rolê sábado?',
      options: ['Bora', 'Não dá'],
      multiple: true,
    });

    expect(sent.content).toEqual({
      type: 'poll',
      name: 'Rolê sábado?',
      options: ['Bora', 'Não dá'],
      multiple: true,
    });
  });

  it('recusa opção repetida', async () => {
    const b = await start();

    await b.receive({
      text: '!tool create_poll {"question":"X?","options":["a","A "]}',
      chat: group,
    });

    expect(toolResult(b)).toEqual({ ok: false, error: 'duplicate-options' });
  });
});

describe('poll_results', () => {
  it('conta os votos da última enquete do chat, com a troca e a retirada de voto', async () => {
    const b = await start();
    const sent = await open(b, { question: 'Pizza?', options: ['Calabresa', 'Frango', 'Queijo'] });
    const id = sent.key.id;

    await vote(b, id, ana, [0]);
    await vote(b, id, bia, [1]);
    await vote(b, id, ana, [2]); // Ana troca o voto
    await vote(b, id, bia, []); // Bia retira o voto

    expect(await results(b)).toEqual({
      ok: true,
      question: 'Pizza?',
      voters: 1,
      results: [
        { option: 'Calabresa', votes: 0, voters: [] },
        { option: 'Frango', votes: 0, voters: [] },
        { option: 'Queijo', votes: 1, voters: ['Ana'] },
      ],
    });
  });

  it('com várias respostas, cada opção marcada conta', async () => {
    const b = await start();
    const sent = await open(b, { question: 'Dias?', options: ['Sáb', 'Dom'], multiple: true });

    await vote(b, sent.key.id, ana, [0, 1]);
    await vote(b, sent.key.id, bia, [1]);

    expect(await results(b)).toMatchObject({
      voters: 2,
      results: [
        { option: 'Sáb', votes: 1 },
        { option: 'Dom', votes: 2 },
      ],
    });
  });

  it('a enquete citada vale mais que a última', async () => {
    const b = await start();
    const first = await open(b, { question: 'Primeira?', options: ['a', 'b'] });
    await b.receive({
      text: '!tool create_poll {"question":"Segunda?","options":["c","d"]}',
      chat: group,
    });
    await vote(b, first.key.id, ana, [1]);

    const quoted = pollMessage(first.key.id, 'Primeira?', ['a', 'b']);
    expect(await results(b, quoted)).toMatchObject({ question: 'Primeira?', voters: 1 });
  });

  it('enquete que não foi ela que abriu: unknown-poll', async () => {
    const b = await start();

    const quoted = pollMessage('outra', 'De outro?', ['x', 'y']);

    expect(await results(b, quoted)).toEqual({ ok: false, error: 'unknown-poll' });
  });

  it('sem enquete no chat: no-poll', async () => {
    const b = await start();

    expect(await results(b)).toEqual({ ok: false, error: 'no-poll' });
  });

  it('voto em enquete desconhecida é ignorado', async () => {
    const b = await start();

    await vote(b, 'nao-existe', ana, [0]);

    expect(b.transport.errors).toEqual([]);
  });
});
