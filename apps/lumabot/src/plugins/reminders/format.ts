// Formatação da lista de lembretes. Módulo puro: sem @usebridger.

import type { Recurrence } from './parse.ts';
import { partsAt } from './zone.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const MINUTE = 60_000;

/** `DD/MM HH:mm` no fuso. */
export function formatWhen(fireAt: number, timeZone: string): string {
  const p = partsAt(fireAt, timeZone);
  return `${pad(p.day)}/${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

export type RemainingKey = 'remMinutes' | 'remHours' | 'remDays' | 'remWeeks' | 'remWeeksDays';

/** Quanto falta, como chave de `messages` mais os valores. Atrasado (bot ficou fora) vale 0 min. */
export function remaining(
  fireAt: number,
  now: number,
): { key: RemainingKey; values: { n: number; d: number } } {
  const minutes = Math.max(0, Math.floor((fireAt - now) / MINUTE));
  if (minutes < 60) return { key: 'remMinutes', values: { n: minutes, d: 0 } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'remHours', values: { n: hours, d: 0 } };
  const days = Math.floor(hours / 24);
  if (days < 7) return { key: 'remDays', values: { n: days, d: 0 } };
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  return rest === 0
    ? { key: 'remWeeks', values: { n: weeks, d: 0 } }
    : { key: 'remWeeksDays', values: { n: weeks, d: rest } };
}

/** Contagens do rodapé da lista; hoje e mês seguem o calendário do fuso. */
export type Stats = { total: number; today: number; week: number; month: number };

export function stats(fireAts: readonly number[], now: number, timeZone: string): Stats {
  const today = partsAt(now, timeZone);
  const weekLimit = now + 7 * 24 * 60 * MINUTE;
  let day = 0;
  let week = 0;
  let month = 0;
  for (const fireAt of fireAts) {
    const p = partsAt(fireAt, timeZone);
    const sameMonth = p.year === today.year && p.month === today.month;
    if (sameMonth) month++;
    if (sameMonth && p.day === today.day) day++;
    if (fireAt >= now && fireAt <= weekLimit) week++;
  }
  return { total: fireAts.length, today: day, week, month };
}

// Índice = dia da semana (0 = domingo).
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Texto curto da recorrência para a lista: `toda segunda e quarta às 19:00`, `a cada 1h30`. */
export function formatRecurrence(r: Recurrence): string {
  if ('everyMs' in r) {
    const total = Math.floor(r.everyMs / MINUTE);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `a cada ${m}min`;
    return `a cada ${h}h${m === 0 ? '' : pad(m)}`;
  }
  const days = DISPLAY_ORDER.filter((d) => r.days?.includes(d));
  if (days.length === 0 || days.length === 7) return `todo dia às ${r.time}`;
  const names = days.map((d) => DAY_NAMES[d] ?? '');
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
  // Sábado e domingo são masculinos; o primeiro dia da lista dá o gênero.
  const first = days[0];
  return `${first === 0 || first === 6 ? 'todo' : 'toda'} ${list} às ${r.time}`;
}
