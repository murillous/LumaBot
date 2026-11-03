import { describe, expect, it } from 'vitest';
import { botUrl, type Supervised, supervise } from './start-all.ts';

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

  it('dashboard que cai com erro vale mesmo se o bot parar limpo na cascata', async () => {
    const bot = fake('bot', 0);
    const web = fake('dashboard');
    const { done } = supervise([bot.proc, web.proc]);
    web.exit(1);
    expect(await done).toBe(1);
    expect(bot.stops()).toBe(1);
  });

  it('dashboard que morre por sinal sai com 1', async () => {
    const bot = fake('bot');
    const web = fake('dashboard');
    const { done } = supervise([bot.proc, web.proc]);
    web.exit(null);
    expect(await done).toBe(1);
  });

  it('o pedido de encerramento para os dois e vale o código do bot', async () => {
    const bot = fake('bot', 0);
    const web = fake('dashboard');
    const { done, request } = supervise([bot.proc, web.proc]);
    request(true);
    expect(await done).toBe(0);
    expect(bot.stops()).toBe(1);
    expect(web.stops()).toBe(1);
  });

  it('pedido sem matar os filhos (Windows) só espera; o código do bot vale', async () => {
    const bot = fake('bot');
    const web = fake('dashboard');
    const { done, request } = supervise([bot.proc, web.proc]);
    request(false);
    web.exit(1);
    expect(bot.stops()).toBe(0);
    bot.exit(0);
    expect(await done).toBe(0);
  });
});

describe('botUrl', () => {
  it('troca o host de escuta 0.0.0.0 por loopback', () => {
    expect(botUrl({ port: 3000, hostname: '0.0.0.0' })).toBe('http://127.0.0.1:3000');
    expect(botUrl({ port: 8080, hostname: '10.0.0.5' })).toBe('http://10.0.0.5:8080');
  });
});
