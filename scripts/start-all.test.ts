import { describe, expect, it } from 'vitest';
import { type Supervised, supervise } from './start-all.ts';

/** Processo falso: `stop` faz como o de verdade e termina, com o código que o teste escolher. */
function fake(name: string, codeOnStop: number | null = null) {
  let exit: (code: number | null) => void = () => undefined;
  let stops = 0;
  const proc: Supervised = {
    name,
    stop: () => {
      stops += 1;
      exit(codeOnStop);
    },
    onExit: (cb) => {
      exit = cb;
    },
  };
  return { proc, exit: (code: number | null) => exit(code), stops: () => stops };
}

describe('supervise', () => {
  it('quando o bot termina, derruba o dashboard e sai com o código do bot', async () => {
    const bot = fake('bot');
    const web = fake('dashboard');
    const { done } = supervise([bot.proc, web.proc]);
    bot.exit(3);
    expect(await done).toBe(3);
    expect(web.stops()).toBe(1);
  });

  it('quando o dashboard cai primeiro, derruba o bot e sai com erro', async () => {
    const bot = fake('bot');
    const web = fake('dashboard');
    const { done } = supervise([bot.proc, web.proc]);
    web.exit(null);
    expect(await done).toBe(1);
    expect(bot.stops()).toBe(1);
  });

  it('o pedido de encerramento para os dois e vale o código do bot', async () => {
    const bot = fake('bot', 0);
    const web = fake('dashboard');
    const { done, stopAll } = supervise([bot.proc, web.proc]);
    stopAll();
    expect(await done).toBe(0);
    expect(bot.stops()).toBe(1);
    expect(web.stops()).toBe(1);
  });
});
