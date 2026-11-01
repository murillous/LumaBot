/** `view.env` do `GET /api/plugins/{nome}/config`: a variável de cada campo que vem do ambiente. */
export type EnvNames = Readonly<Record<string, string>>;

/** A variável que define o campo ou, em valor inteiro (array, record), um subcampo dele. */
export function envOf(env: EnvNames, path: string): string | undefined {
  return env[path] ?? Object.entries(env).find(([key]) => key.startsWith(`${path}.`))?.[1];
}
