/**
 * Separa o apelido do texto de `!nick`: tira os trechos de menção (`tag`; sem ele, `@dígitos`
 * como o legacy) e espaços repetidos. Módulo puro, sem `@usebridger/*`.
 */
export function nickFromArgs(rawArgs: string, tags: readonly (string | undefined)[]): string {
  let text = rawArgs;
  for (const tag of tags) {
    text = tag ? text.replaceAll(tag, ' ') : text.replace(/@\d+/g, ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}
