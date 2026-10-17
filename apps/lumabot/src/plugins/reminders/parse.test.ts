import { describe, expect, it } from 'vitest';
import { formatRecurrence, formatWhen, remaining, stats } from './format.ts';
import { brParser, recurringParser } from './parse.ts';
import { isValidTimeZone, zonedToEpoch } from './zone.ts';

const SP = 'America/Sao_Paulo';
// 16/10/2026 09:00 em Brasília (UTC-3).
const NOW = new Date('2026-10-16T12:00:00Z');
// O brParser só produz disparo único; o cast evita estreitar a união em cada asserção.
const parse = brParser(SP) as (text: string, now: Date) => { fireAt: number; text: string } | null;

describe('brParser', () => {
  it('lê data, hora e mensagem no horário de Brasília', () => {
    expect(parse('20/10 14:30 ligar para a Ana', NOW)).toEqual({
      fireAt: Date.parse('2026-10-20T17:30:00Z'),
      text: 'ligar para a Ana',
    });
  });

  it('aceita o ano e dia/mês de um dígito', () => {
    expect(parse('5/1/2027 8:05 oi', NOW)).toEqual({
      fireAt: Date.parse('2027-01-05T11:05:00Z'),
      text: 'oi',
    });
  });

  it('mantém o "|" do texto', () => {
    expect(parse('20/10 14:30 a | b', NOW)?.text).toBe('a | b');
  });

  it('usa o ano do fuso, não o do processo, na virada', () => {
    // 01/01/2027 01:00 UTC ainda é 31/12/2026 em Brasília.
    const newYear = new Date('2027-01-01T01:00:00Z');
    expect(parse('31/12 23:00 x', newYear)?.fireAt).toBe(Date.parse('2027-01-01T02:00:00Z'));
  });

  it.each([
    ['31/02 10:00 x', 'dia que não existe'],
    ['20/13 10:00 x', 'mês inexistente'],
    ['20/10 25:00 x', 'hora inexistente'],
  ])('%s -> fireAt NaN (%s)', (input) => {
    expect(parse(input, NOW)?.fireAt).toBeNaN();
  });

  it('mensagem vazia casa o formato com texto vazio', () => {
    expect(parse('20/10 10:00 ', NOW)?.text).toBe('');
  });

  it('sem a barra, a mensagem vem logo depois do horário', () => {
    expect(parse('20/10 14:30 ligar para a Ana', NOW)).toEqual({
      fireAt: Date.parse('2026-10-20T17:30:00Z'),
      text: 'ligar para a Ana',
    });
  });

  it('sem data, vale o dia de hoje no fuso', () => {
    expect(parse('14:30 ligar para a Ana', NOW)).toEqual({
      fireAt: Date.parse('2026-10-16T17:30:00Z'),
      text: 'ligar para a Ana',
    });
    // 01:00 UTC de 17/10 ainda é 16/10 em Brasília.
    expect(parse('23:00 x', new Date('2026-10-17T01:00:00Z'))?.fireAt).toBe(
      Date.parse('2026-10-17T02:00:00Z'),
    );
  });

  it('só o horário casa o formato com texto vazio', () => {
    expect(parse('14:30', NOW)?.text).toBe('');
  });

  it.each([
    ['14:30x', 'mensagem colada no horário'],
    ['20/10 x', 'data sem horário'],
    ['amanhã 9h | x', 'outro formato'],
    ['', 'vazio'],
  ])('%s -> null (%s)', (input) => {
    expect(parse(input, NOW)).toBeNull();
  });
});

describe('recurringParser', () => {
  const rec = recurringParser();
  const at = (input: string) => rec(input, NOW);

  it.each([
    ['todo dia 08:00 tomar remédio', '08:00'],
    ['todo dia às 8h tomar remédio', '08:00'],
    ['Todos os dias as 8h30 tomar remédio', '08:30'],
    ['TODO   DIA   7:05 tomar remédio', '07:05'],
  ])('%s -> diária %s', (input, time) => {
    expect(at(input)).toEqual({ recurrence: { time }, text: 'tomar remédio' });
  });

  it.each([
    ['toda segunda 19:00 reunião', '19:00', [1]],
    ['toda segunda e quarta às 19h reunião', '19:00', [1, 3]],
    ['toda segunda, quarta e sexta 19:00 reunião', '19:00', [1, 3, 5]],
    ['todo sábado 10h reunião', '10:00', [6]],
    ['todo domingo 10h reunião', '10:00', [0]],
    ['toda terça-feira 9:30 reunião', '09:30', [2]],
    ['toda terca e sabado 9:30 reunião', '09:30', [2, 6]],
    ['toda sex, seg e sex 9:30 reunião', '09:30', [1, 5]],
    ['toda dom e qui 9:30 reunião', '09:30', [0, 4]],
  ])('%s -> semanal', (input, time, days) => {
    expect(at(input)).toEqual({ recurrence: { time, days }, text: 'reunião' });
  });

  it.each([
    ['a cada 1h30 beber água', 90 * 60_000],
    ['a cada 2h beber água', 2 * 3_600_000],
    ['a cada 45min beber água', 45 * 60_000],
    ['a cada 45 minutos beber água', 45 * 60_000],
    ['a cada 1 hora beber água', 3_600_000],
    ['a cada 2 horas beber água', 2 * 3_600_000],
  ])('%s -> intervalo', (input, everyMs) => {
    expect(at(input)).toEqual({ recurrence: { everyMs }, text: 'beber água' });
  });

  it.each([
    ['a cada 1h 30min beber água', 90 * 60_000],
    ['a cada 1h30m beber água', 90 * 60_000],
    ['a cada 1h30min beber água', 90 * 60_000],
    ['a cada 1 hora e meia beber água', 90 * 60_000],
  ])('%s -> intervalo composto', (input, everyMs) => {
    expect(at(input)).toEqual({ recurrence: { everyMs }, text: 'beber água' });
  });

  it('minutos do intervalo vão de 0 a 59 e número solto depois do "h" é da mensagem', () => {
    expect(at('a cada 1h75 x')).toBeNull();
    expect(at('a cada 2h 30 vezes')).toEqual({
      recurrence: { everyMs: 2 * 3_600_000 },
      text: '30 vezes',
    });
  });

  it('todo dia 8h30min -> 08:30', () => {
    expect(at('todo dia 8h30min x')).toEqual({ recurrence: { time: '08:30' }, text: 'x' });
  });

  it.each([
    ['todas as segundas 19h x', '19:00', [1]],
    ['todas as segundas e quartas 19h x', '19:00', [1, 3]],
    ['todos os sábados 10h x', '10:00', [6]],
  ])('%s -> semanal no plural', (input, time, days) => {
    expect(at(input)).toEqual({ recurrence: { time, days }, text: 'x' });
  });

  it('hora fora de faixa e intervalo zero são devolvidos para o serviço recusar', () => {
    expect(at('todo dia 25:00 x')).toEqual({ recurrence: { time: '25:00' }, text: 'x' });
    expect(at('todo dia 10:75 x')).toEqual({ recurrence: { time: '10:75' }, text: 'x' });
    expect(at('a cada 0min x')).toEqual({ recurrence: { everyMs: 0 }, text: 'x' });
  });

  it('sem mensagem devolve texto vazio', () => {
    expect(at('todo dia 8h')?.text).toBe('');
    expect(at('a cada 2h')?.text).toBe('');
  });

  it.each([
    ['20/10 15:00 x', 'formato do brParser'],
    ['15:00 x', 'só horário'],
    ['todo dia x', 'sem hora'],
    ['toda segunda x', 'dia sem hora'],
    ['todo dia 8:00x', 'mensagem colada'],
    ['toda segundafeira 10h x', 'dia inventado'],
    ['a cada x', 'intervalo sem número'],
    ['', 'vazio'],
  ])('%s -> null (%s)', (input) => {
    expect(at(input)).toBeNull();
  });

  it('o brParser não é afetado: recorrência não é o formato dele', () => {
    expect(parse('todo dia 8h x', NOW)).toBeNull();
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
  it.each([
    [{ time: '08:00' }, 'todo dia às 08:00'],
    [{ time: '19:00', days: [1] }, 'toda segunda às 19:00'],
    [{ time: '19:00', days: [3, 1] }, 'toda segunda e quarta às 19:00'],
    [{ time: '19:00', days: [5, 1, 3] }, 'toda segunda, quarta e sexta às 19:00'],
    [{ time: '10:00', days: [6] }, 'todo sábado às 10:00'],
    [{ time: '10:00', days: [0] }, 'todo domingo às 10:00'],
    [{ time: '10:00', days: [0, 1] }, 'toda segunda e domingo às 10:00'],
    [{ time: '10:00', days: [6, 0] }, 'todo sábado e domingo às 10:00'],
    [{ time: '10:00', days: [0, 1, 2, 3, 4, 5, 6] }, 'todo dia às 10:00'],
    [{ everyMs: 90 * 60_000 }, 'a cada 1h30'],
    [{ everyMs: 2 * 3_600_000 }, 'a cada 2h'],
    [{ everyMs: 45 * 60_000 }, 'a cada 45min'],
  ])('recorrência %j -> %s', (r, expected) => {
    expect(formatRecurrence(r)).toBe(expected);
  });

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
