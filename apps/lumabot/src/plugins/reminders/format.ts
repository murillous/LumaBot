// Formatação da lista de lembretes. Módulo puro: sem @usebridger.

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
