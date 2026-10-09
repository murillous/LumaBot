// `owners` da config do bot. Uma string é telefone, comparado com `Contact.phone`, que o transport
// entrega só com dígitos (M1-16). Normalizar aqui deixa o operador escrever o número como está
// acostumado (`+55 (11) 99999-9999`) sem que a comparação dependa da formatação. `{ id }` é o ID
// nativo do contato (`Contact.id`), para plataformas sem telefone (ADR 0056).

// Pontuação comum em telefone escrito à mão. Qualquer outra coisa (letra, `@` de JID) é erro:
// melhor recusar no boot do que nunca reconhecer o dono.
const SEPARATORS = /[\s+().-]/g;
// E.164 tem no máximo 15 dígitos; menos de 8 não é número internacional completo.
const PHONE = /^\d{8,15}$/;

/** Dono reconhecido pelo ID nativo do contato (`Contact.id`), comparado sem normalizar. */
export interface OwnerId {
  readonly id: string;
}

/** Entrada de `owners`: telefone (com ou sem pontuação) ou `{ id }`. */
export type BotOwner = string | OwnerId;

/** Config do bot inválida (ex.: `owners` com telefone malformado). */
export class BotConfigError extends Error {
  override readonly name = 'BotConfigError';
}

/**
 * Telefone só com dígitos, com DDI: `'+55 11 99999-9999'` → `'5511999999999'`. Lança
 * `BotConfigError` se sobrar algo além de dígitos ou se o tamanho não for de um telefone.
 */
export function normalizePhone(value: string, label = 'telefone'): string {
  const digits = value.replace(SEPARATORS, '');
  if (!PHONE.test(digits)) {
    throw new BotConfigError(
      `${label}: "${value}" não é um telefone válido. Use só o número com DDI e DDD ` +
        '(ex.: "5511999999999" ou "+55 11 99999-9999"); para um ID de contato (JID, ID do ' +
        'Discord ou do Telegram), use { id: "..." }.',
    );
  }
  return digits;
}

function ownerId(owner: unknown, label: string): OwnerId {
  const id = typeof owner === 'object' && owner !== null ? (owner as { id?: unknown }).id : owner;
  // O ID é comparado por igualdade exata: espaço nas pontas é engano de config, e número perde
  // precisão (um snowflake do Discord passa de 2^53). Recusar no boot em vez de nunca casar.
  if (typeof id !== 'string' || id === '' || id.trim() !== id) {
    throw new BotConfigError(
      `${label}: esperava um telefone ou { id: "..." } com o ID em texto, não vazio e sem ` +
        `espaço nas pontas; recebido ${JSON.stringify(owner)}.`,
    );
  }
  return { id };
}

/**
 * Normaliza `owners`: telefones por `normalizePhone`, `{ id }` validado e mantido como está. Sem
 * repetidos, na ordem dada. Telefone e ID com o mesmo texto não se fundem: são espaços diferentes.
 */
export function normalizeOwners(owners: readonly BotOwner[]): BotOwner[] {
  const unique = new Map<string, BotOwner>();
  owners.forEach((owner, index) => {
    const label = `owners[${index}]`;
    if (typeof owner === 'string') {
      const phone = normalizePhone(owner, label);
      unique.set(`phone:${phone}`, phone);
    } else {
      const normalized = ownerId(owner, label);
      unique.set(`id:${normalized.id}`, normalized);
    }
  });
  return [...unique.values()];
}
