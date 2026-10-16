import { describe, expect, it } from 'vitest';
import { formatWhen, remaining, stats } from './format.ts';
import { brParser } from './parse.ts';
import { isValidTimeZone, zonedToEpoch } from './zone.ts';

const SP = 'America/Sao_Paulo';
// 16/10/2026 09:00 em Brasília (UTC-3).
const NOW = new Date('2026-10-16T12:00:00Z');
const parse = brParser(SP);

describe('brParser', () => {
  it('lê data, hora e mensagem no horário de Brasília', () => {
    expect(parse('20/10 14:30 | ligar para a Ana', NOW)).toEqual({
      fireAt: Date.parse('2026-10-20T17:30:00Z'),
      text: 'ligar para a Ana',
    });
  });

  it('aceita o ano e dia/mês de um dígito', () => {
    expect(parse('5/1/2027 8:05|oi', NOW)).toEqual({
      fireAt: Date.parse('2027-01-05T11:05:00Z'),
      text: 'oi',
    });
  });

  it('mantém o "|" do texto', () => {
    expect(parse('20/10 14:30 | a | b', NOW)?.text).toBe('a | b');
  });

  it('usa o ano do fuso, não o do processo, na virada', () => {
    // 01/01/2027 01:00 UTC ainda é 31/12/2026 em Brasília.
    const newYear = new Date('2027-01-01T01:00:00Z');
    expect(parse('31/12 23:00 | x', newYear)?.fireAt).toBe(Date.parse('2027-01-01T02:00:00Z'));
  });

  it.each([
    ['31/02 10:00 | x', 'dia que não existe'],
    ['20/13 10:00 | x', 'mês inexistente'],
    ['20/10 25:00 | x', 'hora inexistente'],
  ])('%s -> fireAt NaN (%s)', (input) => {
    expect(parse(input, NOW)?.fireAt).toBeNaN();
  });

  it('mensagem vazia casa o formato com texto vazio', () => {
    expect(parse('20/10 10:00 |   ', NOW)?.text).toBe('');
  });

  it.each([
    ['20/10 10:00 x', 'sem a barra'],
    ['amanhã 9h | x', 'outro formato'],
    ['', 'vazio'],
  ])('%s -> null (%s)', (input) => {
    expect(parse(input, NOW)).toBeNull();
  });
});

describe('zona', () => {
  it('converte sem depender do TZ do processo', () => {
    const asia = zonedToEpoch({ year: 2026, month: 10, day: 16, hour: 9, minute: 0 }, 'Asia/Tokyo');
    expect(asia).toBe(Date.parse('2026-10-16T00:00:00Z'));
  });

  it('recusa a hora pulada pelo horário de verão', () => {
    // 08/03/2026 02:30 não existe em Nova York.
    const gap = { year: 2026, month: 3, day: 8, hour: 2, minute: 30 };
    expect(zonedToEpoch(gap, 'America/New_York')).toBeNull();
  });

  it('valida o nome do fuso', () => {
    expect(isValidTimeZone(SP)).toBe(true);
    expect(isValidTimeZone('Marte/Olympus')).toBe(false);
  });
});

describe('format', () => {
  it('mostra DD/MM HH:mm no fuso', () => {
    expect(formatWhen(Date.parse('2026-10-20T17:30:00Z'), SP)).toBe('20/10 14:30');
  });

  it.each([
    [30 * 60_000, 'remMinutes', { n: 30, d: 0 }],
    [5 * 3_600_000, 'remHours', { n: 5, d: 0 }],
    [3 * 86_400_000, 'remDays', { n: 3, d: 0 }],
    [14 * 86_400_000, 'remWeeks', { n: 2, d: 0 }],
    [10 * 86_400_000, 'remWeeksDays', { n: 1, d: 3 }],
    [-5 * 60_000, 'remMinutes', { n: 0, d: 0 }],
  ])('faltam %i ms -> %s', (ms, key, values) => {
    expect(remaining(1_000_000 + ms, 1_000_000)).toEqual({ key, values });
  });

  it('conta hoje, semana e mês pelo calendário do fuso', () => {
    const now = NOW.getTime();
    const at = (iso: string) => Date.parse(iso);
    expect(
      stats(
        [
          at('2026-10-16T20:00:00Z'), // hoje
          at('2026-10-20T12:00:00Z'), // semana
          at('2026-10-30T12:00:00Z'), // só no mês
          at('2026-11-02T12:00:00Z'), // outro mês
        ],
        now,
        SP,
      ),
    ).toEqual({ total: 4, today: 1, week: 2, month: 3 });
  });
});
