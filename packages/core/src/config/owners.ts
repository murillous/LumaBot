// `owners` da config do bot: telefones comparados com `Contact.phone`, que o transport entrega
// só com dígitos (M1-16). Normalizar aqui deixa o operador escrever o número como está
// acostumado (`+55 (11) 99999-9999`) sem que a comparação dependa da formatação.

// Pontuação comum em telefone escrito à mão. Qualquer outra coisa (letra, `@` de JID) é erro:
// melhor recusar no boot do que nunca reconhecer o dono.
const SEPARATORS = /[\s+().-]/g;
// E.164 tem no máximo 15 dígitos; menos de 8 não é número internacional completo.
const PHONE = /^\d{8,15}$/;

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
        '(ex.: "5511999999999" ou "+55 11 99999-9999"); JID e letras não são aceitos.',
    );
  }
  return digits;
}

/** Normaliza `owners` (ver `normalizePhone`), sem repetidos, na ordem dada. */
export function normalizeOwners(owners: readonly string[]): string[] {
  const normalized = owners.map((owner, index) => normalizePhone(owner, `owners[${index}]`));
  return [...new Set(normalized)];
}
