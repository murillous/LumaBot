import { definePlugin } from '@usebridger/core';
import {
  createTestBot,
  DEFAULT_CHAT,
  DEFAULT_SENDER,
  FakeTransport,
  type TestBot,
} from '@usebridger/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderError, type RemindersService, reminders } from './reminders.ts';

let bot: TestBot;

// 16/10/2026 09:00 em Brasília.
const NOW = new Date('2026-10-16T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(async () => {
  await bot.stop();
  vi.useRealTimers();
});

const HOUR = 3_600_000;
const text = (b: TestBot) =>
  b.sent.flatMap((s) => (s.content.type === 'text' ? [s.content.text] : []));

// Plugin de teste que só pega o serviço, como a IA do M5 vai fazer.
let captured: RemindersService | undefined;
const grab = definePlugin({
  name: 'grab',
  version: '0.0.0',
  engine: '<1.0.0',
  dependsOn: { reminders: '^1.0.0' },
  setup: (ctx) => {
    captured = ctx.services.get('reminders');
  },
});

async function service(): Promise<RemindersService> {
  if (!captured) throw new Error('serviço não capturado');
  return captured;
}

describe('!lembrete', () => {
  it('cria e confirma com a data no horário de Brasília', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 10:00 | reunião' });
    expect(bot.sent).toContainText('✅ Lembrete criado!\n\n16/10 10:00\nreunião');
  });

  it('o alias !lembrar funciona', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrar 16/10 10:00 | reunião' });
    expect(bot.sent).toContainText(/Lembrete criado/);
  });

  it.each(['!lembrete', '!lembrete sem barra', '!lembrete 31/02 10:00 | x'])(
    '%s -> uso',
    async (input) => {
      bot = await createTestBot({ plugins: [reminders] });
      await bot.receive({ text: input });
      expect(bot.sent).toContainText(/Use: !lembrete DD\/MM HH:mm \| mensagem/);
    },
  );

  it('recusa data no passado', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 08:00 | x' });
    expect(bot.sent).toContainText('❌ A data/hora precisa estar no futuro.');
  });

  it('recusa data a mais de um ano', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10/2028 08:00 | x' });
    expect(bot.sent).toContainText(/muito distante/);
  });

  it('recusa texto acima do limite', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: `!lembrete 17/10 08:00 | ${'a'.repeat(501)}` });
    expect(bot.sent).toContainText('❌ A mensagem do lembrete passou de 500 caracteres.');
  });
});

describe('disparo', () => {
  it('menciona quem criou, no horário, e some da lista', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    await bot.receive({ text: '!lembrete 16/10 10:00 | reunião' });
    bot.transport.clear();

    await vi.advanceTimersByTimeAsync(HOUR - 1000);
    expect(bot.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(bot.sent).toHaveLength(1);
    expect(bot.sent[0]?.mentions).toEqual([DEFAULT_SENDER.id]);
    expect(bot.sent[0]?.chatId).toBe(DEFAULT_CHAT.id);
    expect(bot.sent).toContainText(/⏰ Lembrete: reunião\n@/);
    expect(await (await service()).list(DEFAULT_CHAT.id)).toHaveLength(0);
  });

  it('menciona os marcados no comando', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({
      text: '!lembrete 16/10 10:00 | pagar',
      mentions: [{ ...DEFAULT_SENDER, id: 'ana@fake', phone: '5511911111111', tag: '@ana' }],
    });
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(bot.sent.at(-1)?.mentions).toEqual(['ana@fake']);
  });

  it('sem a capability mentions, avisa sem marcar em vez de perder', async () => {
    bot = await createTestBot({
      plugins: [reminders],
      transport: new FakeTransport({ capabilities: ['send.text', 'quoted'] }),
    });
    await bot.receive({ text: '!lembrete 16/10 10:00 | reunião' });
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(bot.sent.at(-1)?.mentions).toEqual([]);
    expect(bot.sent).toContainText('⏰ Lembrete: reunião');
  });

  it('sobrevive a restart', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 10:00 | reunião' });
    bot = await bot.restart();
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(bot.sent).toContainText(/⏰ Lembrete: reunião/);
  });
});

describe('!lembretes e !cancelarlembrete', () => {
  it('lista por ordem de disparo, com faltam e estatísticas', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 12:00 | depois' });
    await bot.receive({ text: '!lembrete 16/10 10:00 | antes' });
    await bot.receive({ text: '!lembretes' });
    const list = text(bot).at(-1) ?? '';
    expect(list).toContain('⏰ Lembretes agendados (2)');
    expect(list).toContain('1. 16/10 10:00\n   antes\n   ⏳ Faltam 1 hora(s)');
    expect(list).toContain('2. 16/10 12:00\n   depois\n   ⏳ Faltam 3 hora(s)');
    expect(list).toContain('Total: 2\nHoje: 2\nEsta semana: 2\nEste mês: 2');
    expect(list).toContain('📌 Próximo lembrete\n\n16/10 10:00\nantes');
  });

  it('lista vazia', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembretes' });
    expect(bot.sent).toContainText('📝 Nenhum lembrete agendado neste chat.');
  });

  it('a lista é por chat', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 10:00 | meu' });
    await bot.receive({ text: '!lembretes', chat: 'outro@fake' });
    expect(bot.sent).toContainText(/Nenhum lembrete/);
  });

  it('cancela pelo número e o disparo não acontece', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 10:00 | reunião' });
    await bot.receive({ text: '!cancelarlembrete 1' });
    expect(bot.sent).toContainText('✅ Lembrete removido:\n\nreunião');
    bot.transport.clear();

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(bot.sent).toHaveLength(0);
  });

  it.each([
    ['!cancelarlembrete', /Use: !cancelarlembrete <número>/],
    ['!cancelarlembrete abc', /Use: !cancelarlembrete <número>/],
    ['!cancelarlembrete 9', /não encontrado/],
  ])('%s', async (input, expected) => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: input });
    expect(bot.sent).toContainText(expected);
  });
});

describe('serviço reminders', () => {
  const base = { chatId: 'c@fake', creatorId: 'u@fake', mentionIds: [] as string[] };

  it.each([
    [{ fireAt: Number.NaN, text: 'x' }, 'invalid-date'],
    [{ fireAt: NOW.getTime() - 1, text: 'x' }, 'past'],
    [{ fireAt: NOW.getTime() + 366 * 24 * HOUR, text: 'x' }, 'too-far'],
    [{ fireAt: NOW.getTime() + HOUR, text: ' ​\n ' }, 'empty-text'],
    [{ fireAt: NOW.getTime() + HOUR, text: 'a'.repeat(501) }, 'text-too-long'],
    [{ fireAt: NOW.getTime() + HOUR, text: 'x', chatId: '' }, 'invalid-chat'],
  ])('recusa %j com %s', async (input, code) => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const err = await (await service()).create({ ...base, ...input }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReminderError);
    expect((err as ReminderError).code).toBe(code);
  });

  it('limpa caractere invisível, mantém quebra de linha e marca o criador sem menção', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const svc = await service();
    const created = await svc.create({ ...base, fireAt: NOW.getTime() + HOUR, text: 'a​b\nc' });
    expect(created.text).toBe('ab\nc');
    expect(created.mentionIds).toEqual(['u@fake']);
  });

  it('cancel de outro chat não remove', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const svc = await service();
    const { id } = await svc.create({ ...base, fireAt: NOW.getTime() + HOUR, text: 'x' });
    expect(await svc.cancel('outro@fake', id)).toBe(false);
    expect(await svc.list('c@fake')).toHaveLength(1);
    expect(await svc.cancel('c@fake', id)).toBe(true);
    expect(await svc.cancel('c@fake', id)).toBe(false);
  });
});

describe('ponto de extensão reminders.parsers', () => {
  const emUmMin = definePlugin({
    name: 'em-um-min',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { reminders: '^1.0.0' },
    setup: (ctx) => {
      ctx.services.contribute('reminders.parsers', (input, now) => {
        const m = /^em 1 min \| (.+)$/.exec(input);
        return m?.[1] ? { fireAt: now.getTime() + 60_000, text: m[1] } : null;
      });
    },
  });

  const quebrado = definePlugin({
    name: 'parser-quebrado',
    version: '0.0.0',
    engine: '<1.0.0',
    dependsOn: { reminders: '^1.0.0' },
    setup: (ctx) => {
      ctx.services.contribute('reminders.parsers', () => {
        throw new Error('bug do parser');
      });
    },
  });

  it('um plugin que só contribui muda o formato aceito, sem tocar no dono', async () => {
    bot = await createTestBot({ plugins: [reminders, emUmMin] });
    await bot.receive({ text: '!lembrete em 1 min | x' });
    expect(bot.sent).toContainText('✅ Lembrete criado!\n\n16/10 09:01\nx');
    // O formato padrão continua valendo.
    await bot.receive({ text: '!lembrete 16/10 10:00 | y' });
    expect(text(bot).at(-1)).toContain('16/10 10:00');
  });

  it('parser que lança é ignorado e o próximo é tentado', async () => {
    bot = await createTestBot({ plugins: [reminders, quebrado] });
    await bot.receive({ text: '!lembrete 16/10 10:00 | y' });
    expect(bot.sent).toContainText(/Lembrete criado/);
  });
});
