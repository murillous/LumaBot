import { createLogger, createMemoryStorage, definePlugin } from '@usebridger/core';
import {
  createTestBot,
  DEFAULT_CHAT,
  DEFAULT_SENDER,
  FakeTransport,
  type TestBot,
} from '@usebridger/testing';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { aiToolsProbe, toolResult } from '#plugins/ai-tools-probe.ts';
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
  dependsOn: { reminders: '^2.0.0' },
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
    await bot.receive({ text: '!lembrete 16/10 10:00 reunião' });
    expect(bot.sent).toContainText('✅ Lembrete criado!\n\n16/10 10:00\nreunião');
  });

  it('o alias !lembrar funciona', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrar 16/10 10:00 reunião' });
    expect(bot.sent).toContainText(/Lembrete criado/);
  });

  it('data inexistente e mensagem vazia têm texto próprio', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 31/02 10:00 x' });
    await bot.receive({ text: '!lembrete 20/10 10:00 ' });
    expect(text(bot)).toEqual(['❌ Data/hora inválida.', '❌ Informe a mensagem do lembrete.']);
  });

  it('preserva emoji composto e troca tab por espaço', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const r = await (await service()).create({
      chatId: 'c@fake',
      creatorId: 'u@fake',
      mentionIds: [],
      text: 'a\tb 👨‍👩‍👧',
      fireAt: NOW.getTime() + HOUR,
    });
    expect(r.text).toBe('a b 👨‍👩‍👧');
  });

  it.each(['!lembrete', '!lembrete sem barra'])('%s -> uso', async (input) => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: input });
    expect(bot.sent).toContainText(/Use: !lembrete \[DD\/MM\[\/AAAA\]\] HH:mm mensagem/);
  });

  it('só com o horário e sem barra, agenda para hoje', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 10:00 reunião' });
    expect(bot.sent).toContainText('✅ Lembrete criado!\n\n16/10 10:00\nreunião');
  });

  it('recusa data no passado', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 08:00 x' });
    expect(bot.sent).toContainText('❌ A data/hora precisa estar no futuro.');
  });

  it('recusa data a mais de um ano', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10/2028 08:00 x' });
    expect(bot.sent).toContainText(/muito distante/);
  });

  it('recusa texto acima do limite', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: `!lembrete 17/10 08:00 ${'a'.repeat(501)}` });
    expect(bot.sent).toContainText('❌ A mensagem do lembrete passou de 500 caracteres.');
  });
});

describe('disparo', () => {
  it('menciona quem criou, no horário, e some da lista', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    await bot.receive({ text: '!lembrete 16/10 10:00 reunião' });
    bot.transport.clear();

    await vi.advanceTimersByTimeAsync(HOUR - 1000);
    expect(bot.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);

    expect(bot.sent).toHaveLength(1);
    expect(text(bot)[0]).toContain(`@${DEFAULT_SENDER.id}`);
    expect(bot.sent[0]?.chatId).toBe(DEFAULT_CHAT.id);
    expect(bot.sent).toContainText(/⏰ Lembrete: reunião\n@/);
    expect(await (await service()).list(DEFAULT_CHAT.id)).toHaveLength(0);
  });

  it('menciona os marcados no comando', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({
      text: '!lembrete 16/10 10:00 pagar',
      mentions: [{ ...DEFAULT_SENDER, id: 'ana@fake', phone: '5511911111111', tag: '@ana' }],
    });
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(text(bot).at(-1)).toContain('@ana@fake');
  });

  it('sem a capability mentions, avisa sem marcar em vez de perder', async () => {
    bot = await createTestBot({
      plugins: [reminders],
      transport: new FakeTransport({ capabilities: ['send.text', 'quoted'] }),
    });
    await bot.receive({ text: '!lembrete 16/10 10:00 reunião' });
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(bot.sent.at(-1)?.mentions).toEqual([]);
    expect(bot.sent).toContainText(/^⏰ Lembrete: reunião/);
  });

  it('sobrevive a restart', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 10:00 reunião' });
    bot = await bot.restart();
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(bot.sent).toContainText(/⏰ Lembrete: reunião/);
  });
});

describe('!lembretes e !cancelarlembrete', () => {
  it('lista por ordem de disparo, com faltam e estatísticas', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 12:00 depois' });
    await bot.receive({ text: '!lembrete 16/10 10:00 antes' });
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
    await bot.receive({ text: '!lembrete 16/10 10:00 meu' });
    await bot.receive({ text: '!lembretes', chat: 'outro@fake' });
    expect(bot.sent).toContainText(/Nenhum lembrete/);
  });

  it('cancela pelo número e o disparo não acontece', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete 16/10 10:00 reunião' });
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
    dependsOn: { reminders: '^2.0.0' },
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
    dependsOn: { reminders: '^2.0.0' },
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
    await bot.receive({ text: '!lembrete 16/10 10:00 y' });
    expect(text(bot).at(-1)).toContain('16/10 10:00');
  });

  it('parser que lança é ignorado e o próximo é tentado', async () => {
    bot = await createTestBot({ plugins: [reminders, quebrado] });
    await bot.receive({ text: '!lembrete 16/10 10:00 y' });
    expect(bot.sent).toContainText(/Lembrete criado/);
  });
});

describe('tools', () => {
  it('create_reminder agenda com a data ISO e a lista/cancela pelo id', async () => {
    bot = await createTestBot({ plugins: [reminders, aiToolsProbe] });

    await bot.receive({
      text: '!tool create_reminder {"when":"2026-10-16T13:00:00-03:00","text":"reunião"}',
    });
    const created = toolResult(bot) as { id: string };
    expect(created).toEqual({
      ok: true,
      id: expect.any(String),
      when: '16/10 13:00',
      text: 'reunião',
    });

    await bot.receive({ text: '!tool list_reminders' });
    expect(toolResult(bot)).toEqual({
      ok: true,
      reminders: [{ id: created.id, when: '16/10 13:00', text: 'reunião' }],
    });

    await bot.receive({ text: `!tool cancel_reminder {"id":"${created.id}"}` });
    expect(toolResult(bot)).toEqual({ ok: true });
    await bot.receive({ text: `!tool cancel_reminder {"id":"${created.id}"}` });
    expect(toolResult(bot)).toEqual({ ok: false, error: 'not-found' });
  });

  it('create_reminder devolve o código da recusa', async () => {
    bot = await createTestBot({ plugins: [reminders, aiToolsProbe] });

    await bot.receive({
      text: '!tool create_reminder {"when":"2026-10-16T08:00:00-03:00","text":"ontem"}',
    });

    expect(toolResult(bot)).toEqual({ ok: false, error: 'past' });
  });
});

describe('recorrência', () => {
  it('todo dia 8h dispara às 08:00 em dois dias seguidos e continua na lista', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    await bot.receive({ text: '!lembrete todo dia 8h tomar remédio' });
    expect(bot.sent).toContainText(
      '✅ Lembrete criado!\n\n🔁 todo dia às 08:00\n📅 Próximo: 17/10 08:00\ntomar remédio',
    );
    bot.transport.clear();

    // 16/10 09:00 -> 17/10 08:00 (23 h) e 18/10 08:00.
    await vi.advanceTimersByTimeAsync(23 * HOUR + 1000);
    expect(bot.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(bot.sent).toHaveLength(2);
    expect(bot.sent).toContainText(/⏰ Lembrete: tomar remédio/);
    expect(await (await service()).list(DEFAULT_CHAT.id)).toHaveLength(1);
  });

  it('semanal com vários dias mostra a próxima ocorrência', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    // 16/10/2026 é sexta: a próxima segunda é 19/10.
    await bot.receive({ text: '!lembrete toda segunda e quarta 19:00 reunião' });
    expect(bot.sent).toContainText(
      '✅ Lembrete criado!\n\n🔁 toda segunda e quarta às 19:00\n📅 Próximo: 19/10 19:00\nreunião',
    );
  });

  it('a cada 1h30 dispara duas vezes; abaixo do mínimo é recusado', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete a cada 10min x' });
    expect(bot.sent).toContainText('❌ O intervalo mínimo é de 15 minutos.');
    await bot.receive({ text: '!lembrete a cada 1h30 água' });
    bot.transport.clear();

    await vi.advanceTimersByTimeAsync(3 * HOUR + 1000);
    expect(bot.sent).toHaveLength(2);
  });

  it('!lembretes mostra a recorrência e a próxima ocorrência', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete todo dia 8h remédio' });
    await bot.receive({ text: '!lembretes' });
    expect(text(bot).at(-1)).toContain(
      '1. 17/10 08:00\n   remédio\n   🔁 todo dia às 08:00\n   ⏳',
    );
  });

  it('!cancelarlembrete encerra a série inteira', async () => {
    bot = await createTestBot({ plugins: [reminders] });
    await bot.receive({ text: '!lembrete a cada 1h30 água' });
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    await bot.receive({ text: '!cancelarlembrete 1' });
    expect(bot.sent).toContainText('✅ Lembrete removido:\n\nágua');
    bot.transport.clear();

    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(bot.sent).toHaveLength(0);
    await bot.receive({ text: '!lembretes' });
    expect(bot.sent).toContainText(/Nenhum lembrete/);
  });

  it('recorrente inválido no serviço recusa com invalid-recurrence', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const base = { chatId: 'c@fake', creatorId: 'u@fake', mentionIds: [], text: 'x' };
    const svc = await service();
    for (const input of [
      { recurrence: { time: '25:00' } },
      { recurrence: { time: '08:00', days: [7] } },
      { recurrence: { time: '08:00', days: [] } },
      {},
      { fireAt: NOW.getTime() + HOUR, recurrence: { time: '08:00' } },
    ]) {
      const err = await svc.create({ ...base, ...input }).catch((e: unknown) => e);
      expect((err as ReminderError).code).toBe('invalid-recurrence');
    }
    const short = await svc
      .create({ ...base, recurrence: { everyMs: 60_000 } })
      .catch((e: unknown) => e);
    expect((short as ReminderError).code).toBe('interval-too-short');
    expect(await svc.list('c@fake')).toHaveLength(0);
  });

  // Fuso do plugin com horário de verão: a série segue 08:00 locais, então a distância entre
  // disparos é 23 h na entrada e 25 h na saída do horário de verão.
  const ping = (fires: number[]) =>
    definePlugin({
      name: 'ping',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'ping',
          deliver: async () => {
            fires.push(Date.now());
          },
        });
        captured = ctx.services.get('reminders');
      },
    });

  it.each([
    ['entrada', '2026-03-07T12:00:00Z', 23, 4],
    ['saída', '2026-10-31T11:00:00Z', 25, 3],
  ])('horário de verão (%s) mantém 08:00 locais', async (_, start, hours, count) => {
    vi.setSystemTime(new Date(start));
    const fires: number[] = [];
    bot = await createTestBot({
      plugins: [reminders, ping(fires)],
      pluginConfig: { reminders: { timeZone: 'America/New_York' } },
    });
    await (await service()).create({
      chatId: 'c@fake',
      creatorId: 'u@fake',
      mentionIds: [],
      text: 'x',
      kind: 'ping',
      recurrence: { time: '08:00' },
    });
    // Hora a hora: cada ocorrência reagenda a próxima só depois de o handler terminar.
    for (let i = 0; i < 72; i++) await vi.advanceTimersByTimeAsync(HOUR);
    expect(fires).toHaveLength(count);
    expect(((fires[1] ?? 0) - (fires[0] ?? 0)) / HOUR).toBe(hours);
  });
});

describe('série: casos de falha', () => {
  const base = { chatId: 'c@fake', creatorId: 'u@fake', mentionIds: [], text: 'x' };

  it('doc da 1.x, sem kind/data/recurrence, dispara como texto e sai', async () => {
    const storage = createMemoryStorage();
    bot = await createTestBot({ plugins: [reminders, grab], storage });
    const svc = await service();
    const r = await svc.create({ ...base, text: 'antigo', fireAt: NOW.getTime() + HOUR });
    // Simula o doc gravado pela 1.x: esses campos não existiam.
    await storage
      .forNamespace('reminders')
      .collection('reminders')
      .update(r.id, { kind: undefined, data: undefined, recurrence: undefined });

    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(bot.sent).toContainText(/⏰ Lembrete: antigo/);
    expect(await svc.list(base.chatId)).toHaveLength(0);
  });

  it('série cujo deliver não faz I/O dispara em toda ocorrência', async () => {
    const fires: number[] = [];
    const quiet = definePlugin({
      name: 'quiet',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'quiet',
          deliver: async () => {
            fires.push(Date.now());
          },
        });
        captured = ctx.services.get('reminders');
      },
    });
    bot = await createTestBot({ plugins: [reminders, quiet] });
    await (await service()).create({
      ...base,
      kind: 'quiet',
      recurrence: { everyMs: 30 * 60_000 },
    });
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fires).toHaveLength(5);
  });

  it('série cujo kind sumiu registra o warn a cada ocorrência', async () => {
    const warns: string[] = [];
    const logger = createLogger({ level: 'warn', destination: { write: (l) => warns.push(l) } });
    const quiet = definePlugin({
      name: 'quiet',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'quiet',
          deliver: async () => undefined,
        });
        captured = ctx.services.get('reminders');
      },
    });
    bot = await createTestBot({ plugins: [reminders, quiet] });
    await (await service()).create({
      ...base,
      kind: 'quiet',
      recurrence: { everyMs: 30 * 60_000 },
    });
    bot = await bot.restart({ plugins: [reminders, grab], logger });
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(warns.filter((l) => l.includes('kind de lembrete sem plugin'))).toHaveLength(4);
  });

  it('série órfã (doc apagado) é cancelada na próxima ocorrência', async () => {
    const storage = createMemoryStorage();
    bot = await createTestBot({ plugins: [reminders, grab], storage });
    const svc = await service();
    const r = await svc.create({ ...base, recurrence: { everyMs: 30 * 60_000 } });
    await storage.forNamespace('reminders').collection('reminders').delete(r.id);

    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1000);
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(bot.sent).toHaveLength(0);
    // O job vive no storage interno do scheduler: cancelada, a série não deixa linha.
    expect(await storage.forNamespace('$scheduler').collection('jobs').find({})).toHaveLength(0);
  });

  it('série de texto continua disparando depois do restart', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    await (await service()).create({ ...base, recurrence: { everyMs: 30 * 60_000 } });
    bot = await bot.restart({ plugins: [reminders, grab] });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(bot.sent).toHaveLength(2);
  });

  it('kind duplicado: vale o primeiro e avisa uma vez', async () => {
    const warns: string[] = [];
    const logger = createLogger({ level: 'warn', destination: { write: (l) => warns.push(l) } });
    const calls: string[] = [];
    const dup = (name: string) =>
      definePlugin({
        name,
        version: '0.0.0',
        engine: '<1.0.0',
        dependsOn: { reminders: '^2.0.0' },
        setup: (ctx) => {
          ctx.services.contribute('reminders.kinds', {
            kind: 'dup',
            deliver: async () => {
              calls.push(name);
            },
          });
          captured = ctx.services.get('reminders');
        },
      });
    bot = await createTestBot({ plugins: [reminders, dup('um'), dup('dois')], logger });
    await (await service()).create({ ...base, kind: 'dup', recurrence: { everyMs: 30 * 60_000 } });
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(calls).toEqual(['um', 'um', 'um']);
    expect(warns.filter((l) => l.includes('mais de um plugin'))).toHaveLength(1);
  });

  it('série cujo kind sumiu não entrega e continua listada', async () => {
    const fires: number[] = [];
    const ping = definePlugin({
      name: 'ping',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'ping',
          deliver: async () => {
            fires.push(Date.now());
          },
        });
        captured = ctx.services.get('reminders');
      },
    });
    bot = await createTestBot({ plugins: [reminders, ping] });
    await (await service()).create({
      ...base,
      kind: 'ping',
      recurrence: { everyMs: 30 * 60_000 },
    });
    bot = await bot.restart({ plugins: [reminders, grab] });

    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(fires).toHaveLength(0);
    expect(bot.sent).toHaveLength(0);
    expect(await (await service()).list(base.chatId)).toHaveLength(1);
  });

  it('deliver que lança não para a série', async () => {
    let calls = 0;
    const flaky = definePlugin({
      name: 'flaky',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'flaky',
          deliver: async () => {
            calls++;
            if (calls === 1) throw new Error('falhou');
          },
        });
        captured = ctx.services.get('reminders');
      },
    });
    bot = await createTestBot({ plugins: [reminders, flaky] });
    await (await service()).create({
      ...base,
      kind: 'flaky',
      recurrence: { everyMs: 30 * 60_000 },
    });
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(calls).toBe(6);
    expect(await (await service()).list(base.chatId)).toHaveLength(1);
  });

  it('série criada e falha depois (docs.update) é cancelada e o doc some', async () => {
    const storage = createMemoryStorage();
    const forNamespace = storage.forNamespace.bind(storage);
    let reads: MockInstance | undefined;
    storage.forNamespace = (ns) => {
      const store = forNamespace(ns);
      const collection = store.collection.bind(store);
      store.collection = ((name, options) => {
        const col = collection(name, options);
        if (name === 'reminders') {
          vi.spyOn(col, 'update').mockRejectedValue(new Error('disco'));
          reads = vi.spyOn(col, 'get');
        }
        return col;
      }) as typeof store.collection;
      return store;
    };
    const ping = definePlugin({
      name: 'ping',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'ping',
          deliver: () => Promise.resolve(),
        });
        captured = ctx.services.get('reminders');
      },
    });
    bot = await createTestBot({ plugins: [reminders, ping], storage });
    const svc = await service();
    const err = await svc
      .create({ ...base, kind: 'ping', recurrence: { everyMs: 15 * 60_000 } })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe('disco');

    // Série viva dispararia o handler, que lê o doc; cancelada, ninguém lê.
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(reads).not.toHaveBeenCalled();
    expect(await svc.list(base.chatId)).toHaveLength(0);
  });

  it('everyMs fracionado em minutos é inválido e acima de 1 ano é too-far', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const svc = await service();
    const code = async (everyMs: number) =>
      (
        (await svc
          .create({ ...base, recurrence: { everyMs } })
          .catch((e: unknown) => e)) as ReminderError
      ).code;
    expect(await code(15 * 60_000 + 500)).toBe('invalid-recurrence');
    expect(await code(366 * 24 * HOUR)).toBe('too-far');
  });
});

describe('ponto de extensão reminders.kinds', () => {
  it('kind de terceiro recebe o reminder com data e o kind text não envia', async () => {
    const got: unknown[] = [];
    const ping = definePlugin({
      name: 'ping',
      version: '0.0.0',
      engine: '<1.0.0',
      dependsOn: { reminders: '^2.0.0' },
      setup: (ctx) => {
        ctx.services.contribute('reminders.kinds', {
          kind: 'ping',
          deliver: async (r) => {
            got.push(r);
          },
        });
        captured = ctx.services.get('reminders');
      },
    });
    bot = await createTestBot({ plugins: [reminders, ping] });
    const svc = await service();
    await svc.create({
      chatId: 'c@fake',
      creatorId: 'u@fake',
      mentionIds: [],
      text: 'figurinha',
      kind: 'ping',
      data: { x: 1 },
      fireAt: NOW.getTime() + HOUR,
    });
    await vi.advanceTimersByTimeAsync(HOUR + 1000);
    expect(got).toEqual([expect.objectContaining({ kind: 'ping', data: { x: 1 } })]);
    expect(bot.sent).toHaveLength(0);
    expect(await svc.list('c@fake')).toHaveLength(0);
  });

  it('kind desconhecido é recusado', async () => {
    bot = await createTestBot({ plugins: [reminders, grab] });
    const err = await (await service())
      .create({
        chatId: 'c@fake',
        creatorId: 'u@fake',
        mentionIds: [],
        text: 'x',
        kind: 'nada',
        fireAt: NOW.getTime() + HOUR,
      })
      .catch((e: unknown) => e);
    expect((err as ReminderError).code).toBe('unknown-kind');
  });
});

describe('tools com repeat', () => {
  it('create_reminder aceita repeat e list_reminders mostra a recorrência', async () => {
    bot = await createTestBot({ plugins: [reminders, aiToolsProbe] });
    await bot.receive({
      text: '!tool create_reminder {"repeat":{"time":"08:00","days":[1,3]},"text":"reunião"}',
    });
    expect(toolResult(bot)).toMatchObject({
      ok: true,
      recurrence: 'toda segunda e quarta às 08:00',
    });

    await bot.receive({ text: '!tool create_reminder {"text":"sem quando"}' });
    expect(toolResult(bot)).toEqual({ ok: false, error: 'invalid-recurrence' });
    await bot.receive({ text: '!tool create_reminder {"repeat":{"everyMinutes":5},"text":"x"}' });
    expect(toolResult(bot)).toEqual({ ok: false, error: 'interval-too-short' });
  });
});
