import { afterEach, describe, expect, it } from 'vitest';
import {
  CHAT_COUNT,
  createWorkload,
  kindOf,
  messageAt,
  PLUGIN_COUNT,
  repliesOf,
  type Workload,
} from './workload.ts';

let workload: Workload | undefined;

afterEach(async () => {
  await workload?.bot.stop();
  workload = undefined;
});

describe('bot de referência', () => {
  it('carrega os 20 plugins e o observador', async () => {
    workload = await createWorkload();
    const report = workload.bot.bot.plugins();
    expect(report).toHaveLength(PLUGIN_COUNT + 1);
    expect(report.every((entry) => entry.status === 'loaded')).toBe(true);
  });

  it('responde o comando e o texto "oi", e não responde o texto solto', async () => {
    workload = await createWorkload();
    const { bot } = workload;

    for (let i = 0; i < 3; i++) {
      bot.transport.clear();
      await bot.receive({ text: messageAt(i).text ?? '' });
      expect(bot.sent).toHaveLength(repliesOf(i));
    }
    expect(workload.pluginErrors()).toBe(0);
  });
});

describe('carga', () => {
  it('alterna comando, texto respondido e texto solto', () => {
    expect([0, 1, 2, 3].map(kindOf)).toEqual(['command', 'reply', 'silent', 'command']);
    expect([0, 1, 2].map((i) => messageAt(i).text)).toEqual(['!ping', 'oi', 'nada']);
  });

  it('circula pelos 500 chats, com um remetente por mensagem', () => {
    expect(messageAt(0).chat.id).toBe(messageAt(CHAT_COUNT).chat.id);
    expect(messageAt(0).chat.id).not.toBe(messageAt(1).chat.id);
    expect(messageAt(0).sender.id).not.toBe(messageAt(CHAT_COUNT).sender.id);
  });
});
