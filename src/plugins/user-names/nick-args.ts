/** Limite do apelido, em caracteres (depois da limpeza). */
export const NICK_MAX = 32;

/**
 * Limpa um nome vindo de gente (apelido ou pushName): NFC, sem caracteres de controle/formatação
 * (inclui bidi e largura zero), espaços colapsados. Módulo puro, sem `@usebridger/*`.
 */
export function cleanName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Separa o apelido do texto de `!nick`: tira os trechos de menção (`tag`; sem ele, `@dígitos`
 * como o legacy), só como token inteiro (`@5511` não corta `@55119999`).
 */
export function nickFromArgs(rawArgs: string, tags: readonly (string | undefined)[]): string {
  let text = rawArgs;
  for (const tag of tags) {
    const re = tag ? new RegExp(`(?<!\\S)${escapeRegExp(tag)}(?![\\p{L}\\p{N}])`, 'gu') : /@\d+/g;
    text = text.replace(re, ' ');
  }
  return cleanName(text);
}
