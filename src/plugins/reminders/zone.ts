// Fuso sem depender do TZ do processo: tudo passa pelo Intl com o fuso IANA informado.

export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    // RangeError do Intl = fuso desconhecido; é a resposta da função, não uma falha.
    return false;
  }
}

/** Relógio de parede de `epoch` no fuso. */
export function partsAt(epoch: number, timeZone: string): ZonedParts {
  const got = new Map<string, number>();
  for (const p of formatter(timeZone).formatToParts(epoch)) got.set(p.type, Number(p.value));
  return {
    year: got.get('year') ?? 0,
    month: got.get('month') ?? 0,
    day: got.get('day') ?? 0,
    hour: got.get('hour') ?? 0,
    minute: got.get('minute') ?? 0,
  };
}

const asUtc = (p: ZonedParts) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);

/**
 * Relógio de parede no fuso → epoch. `null` se o horário não existe lá (31/02, hora pulada pelo
 * horário de verão): o ida-e-volta não devolve o que foi pedido.
 */
export function zonedToEpoch(want: ZonedParts, timeZone: string): number | null {
  const guess = asUtc(want);
  // Duas passadas: o deslocamento do chute pode diferir do deslocamento do instante real.
  let epoch = guess - (asUtc(partsAt(guess, timeZone)) - guess);
  epoch = guess - (asUtc(partsAt(epoch, timeZone)) - epoch);
  const back = partsAt(epoch, timeZone);
  const same =
    back.year === want.year &&
    back.month === want.month &&
    back.day === want.day &&
    back.hour === want.hour &&
    back.minute === want.minute;
  return same ? epoch : null;
}
