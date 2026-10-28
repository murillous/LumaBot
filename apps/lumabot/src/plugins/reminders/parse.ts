// Parsers do argumento do `!lembrete`: disparo único (`[DD/MM[/AAAA]] HH:mm mensagem`) e
// recorrente (`todo dia 8h ...`, `toda segunda 19:00 ...`, `a cada 1h30 ...`).
// Módulo puro: sem @usebridger.

import { partsAt, zonedToEpoch } from './zone.ts';

/**
 * Recorrência no fuso do plugin: intervalo fixo (`everyMs`) ou horário `HH:mm` (24 h) nos dias
 * da semana (`days`, 0 = domingo … 6 = sábado; ausente = todo dia).
 */
export type Recurrence =
  | { readonly everyMs: number }
  | { readonly time: string; readonly days?: readonly number[] };

/** Resultado de um parser: disparo único (`fireAt`, epoch ms) ou série, e o texto do lembrete. */
export type ParsedReminder =
  | { readonly fireAt: number; readonly text: string }
  | { readonly recurrence: Recurrence; readonly text: string };

/** Tenta entender o argumento do `!lembrete`; `null` = não é o meu formato. */
export type WhenParser = (text: string, now: Date) => ParsedReminder | null;

const BR_FORMAT = /^(?:(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+)?(\d{1,2}):(\d{2})(?:\s+|$)([\s\S]*)$/;

/**
 * `[DD/MM[/AAAA]] HH:mm mensagem` no horário do fuso. Sem data, vale o dia de hoje no fuso;
 * sem ano, o ano corrente.
 */
export function brParser(timeZone: string): WhenParser {
  return (input, now) => {
    const m = BR_FORMAT.exec(input.trim());
    if (!m) return null;
    const [, day, month, year, hour, minute, text] = m;
    const today = partsAt(now.getTime(), timeZone);
    const fireAt = zonedToEpoch(
      {
        year: year ? Number(year) : today.year,
        month: month ? Number(month) : today.month,
        day: day ? Number(day) : today.day,
        hour: Number(hour),
        minute: Number(minute),
      },
      timeZone,
    );
    // Formato reconhecido mas inválido: o serviço recusa com o motivo certo (data/texto).
    return { fireAt: fireAt ?? Number.NaN, text: text?.trim() ?? '' };
  };
}

const DAY_WORD =
  '(?:domingo|dom|segunda(?:-feira)?|seg|ter[cç]a(?:-feira)?|ter|quarta(?:-feira)?|qua|quinta(?:-feira)?|qui|sexta(?:-feira)?|sex|s[aá]bado|s[aá]b|sab)s?(?![a-zà-ÿ])';
const DAY_LIST = `${DAY_WORD}(?:(?:\\s*,\\s*|\\s+e\\s+)${DAY_WORD})*`;
// Hora `HH:mm`, `8h`, `8h30` ou `8h30min`, com `às`/`as` opcional; a mensagem é o que sobra.
const TIME_AND_TEXT =
  '(?:[àa]s\\s+)?(\\d{1,2})(?::(\\d{2})|h(\\d{2})?(?:min)?)(?:\\s+|$)([\\s\\S]*)';
const DAILY = new RegExp(`^(?:todo\\s+dia|todos\\s+os\\s+dias)\\s+${TIME_AND_TEXT}`, 'i');
const WEEKLY = new RegExp(`^tod[oa]s?(?:\\s+(?:os|as))?\\s+(${DAY_LIST})\\s+${TIME_AND_TEXT}`, 'i');
// `1h30`, `1h 30min`, `1 hora e meia` (só essa fração) ou `45min`.
const INTERVAL =
  /^a\s+cada\s+(?:(\d+)\s*(?:horas?|h)(?:(\d{1,2})(?:min\w*|m(?![a-zà-ÿ]))?|\s+(\d{1,2})\s*min\w*|\s+(e\s+meia))?|(\d+)\s*(?:minutos?|min))(?:\s+|$)([\s\S]*)/i;

const DAY_INDEX = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

const normalizeTime = (hour: string, minute: string | undefined) =>
  `${hour.padStart(2, '0')}:${minute ?? '00'}`;

// Sem acento e minúsculo, as 3 primeiras letras identificam o dia ("terça-feira" -> "ter").
const dayOf = (word: string) =>
  DAY_INDEX.indexOf(word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().slice(0, 3));

/**
 * Lembretes recorrentes: `todo dia|todos os dias HH:mm`, `toda segunda[, quarta e sexta] HH:mm`
 * e `a cada 1h30|45min`. Não depende do `now` nem do fuso: quem aplica a série é o serviço.
 */
export function recurringParser(): WhenParser {
  return (input) => {
    const text = input.trim();
    const interval = INTERVAL.exec(text);
    if (interval) {
      const [, hours, adjacent, spaced, half, onlyMinutes, rest] = interval;
      const minutes = adjacent ?? spaced;
      // Minuto de intervalo vai de 0 a 59; acima disso o formato não é este.
      if (Number(minutes ?? 0) > 59) return null;
      const everyMs = onlyMinutes
        ? Number(onlyMinutes) * 60_000
        : Number(hours) * 3_600_000 + (half ? 30 : Number(minutes ?? 0)) * 60_000;
      return { recurrence: { everyMs }, text: rest?.trim() ?? '' };
    }
    const weekly = WEEKLY.exec(text);
    if (weekly) {
      const [, list, hour, colonMinute, hMinute, rest] = weekly;
      const days = [...new Set((list?.match(new RegExp(DAY_WORD, 'gi')) ?? []).map(dayOf))].sort(
        (a, b) => a - b,
      );
      return {
        recurrence: { time: normalizeTime(hour ?? '', colonMinute ?? hMinute), days },
        text: rest?.trim() ?? '',
      };
    }
    const daily = DAILY.exec(text);
    if (daily) {
      const [, hour, colonMinute, hMinute, rest] = daily;
      return {
        recurrence: { time: normalizeTime(hour ?? '', colonMinute ?? hMinute) },
        text: rest?.trim() ?? '',
      };
    }
    return null;
  };
}
