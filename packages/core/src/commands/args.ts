// Aspas de abertura → fechamento aceitas. As tipográficas entram porque o teclado do celular
// (iOS principalmente) troca `"` por `“ ”` sozinho. Aspas simples ficam de fora: o apóstrofo
// aparece em texto comum ("d'água") e quebraria o argumento.
const QUOTES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['“', '”'],
]);

const WHITESPACE = /\s/;

/**
 * Quebra o texto em argumentos por espaço em branco, respeitando trechos entre aspas
 * (`"a b"` vira um argumento só, sem as aspas). Aspa sem fechamento estende o argumento até o
 * fim do texto: é o que o usuário quis dizer na maioria das vezes, e não há como responder
 * "erro de sintaxe" de forma útil num chat.
 */
export function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  // Distingue "nenhum argumento em curso" de argumento vazio vindo de `""`.
  let inArg = false;
  let closing: string | null = null;

  for (const char of input) {
    if (closing !== null) {
      if (char === closing) closing = null;
      else current += char;
      continue;
    }
    const close = QUOTES.get(char);
    if (close !== undefined) {
      closing = close;
      inArg = true;
      continue;
    }
    if (WHITESPACE.test(char)) {
      if (inArg) {
        args.push(current);
        current = '';
        inArg = false;
      }
      continue;
    }
    current += char;
    inArg = true;
  }
  if (inArg) args.push(current);
  return args;
}
