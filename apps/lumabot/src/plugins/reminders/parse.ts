// Parser do formato `[DD/MM[/AAAA]] HH:mm mensagem`. Módulo puro: sem @usebridger.

import { partsAt, zonedToEpoch } from './zone.ts';

/** Resultado de um parser: quando disparar e o texto do lembrete. */
export interface ParsedReminder {
  readonly fireAt: number;
  readonly text: string;
}

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
