// Cliente do Tavily (busca para IA). Puro de bot: recebe o `fetch` e a chave, devolve texto.

export interface TavilyOptions {
  readonly apiKey: string;
  readonly maxResults: number;
  readonly searchDepth: 'basic' | 'advanced';
  readonly signal?: AbortSignal | undefined;
}

interface TavilyResponse {
  readonly answer?: string | null;
  readonly results?: readonly { readonly title?: string; readonly content?: string }[];
  readonly error?: string;
}

/** O Tavily recusou: `quota` quando o plano acabou (vale esperar), senão falha comum. */
export class TavilyError extends Error {
  override readonly name = 'TavilyError';
  readonly status: number;
  readonly quota: boolean;

  constructor(status: number, body: string) {
    super(`Tavily HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.status = status;
    // 429 é limite de taxa e 432/433 são plano ou crédito esgotado. O texto só vale em 401/402/403
    // (chave sem crédito); em qualquer outro status, "limit" no corpo (ex.: 400) é falha comum.
    this.quota =
      [429, 432, 433].includes(status) ||
      ([401, 402, 403].includes(status) && /quota|limit|credit/i.test(body));
  }
}

const SNIPPET = 350;
/** Prazo do Tavily: curto para um Tavily travado não consumir o signal inteiro do listener. */
export const TAVILY_TIMEOUT_MS = 10_000;

/** Resumo do Tavily e as `shown` primeiras fontes, no tamanho que cabe no contexto do modelo. */
export function formatTavily(data: TavilyResponse, shown: number): string {
  const lines: string[] = [];
  if (data.answer) lines.push(`Resumo: ${data.answer}`, '');
  (data.results ?? []).slice(0, shown).forEach((r, i) => {
    lines.push(`[${i + 1}] ${r.title ?? ''}`);
    if (r.content) lines.push(r.content.slice(0, SNIPPET));
    lines.push('');
  });
  return lines.join('\n').trim() || 'Nenhum resultado encontrado.';
}

export async function searchTavily(
  query: string,
  { apiKey, maxResults, searchDepth, signal }: TavilyOptions,
  fetchFn: typeof fetch,
): Promise<string> {
  const response = await fetchFn('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: true,
    }),
    // Estouro do prazo é falha comum (cai na busca nativa), não cota.
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(TAVILY_TIMEOUT_MS)])
      : AbortSignal.timeout(TAVILY_TIMEOUT_MS),
  });
  if (!response.ok) throw new TavilyError(response.status, await response.text().catch(() => ''));
  const data = (await response.json()) as TavilyResponse;
  if (data.error) throw new TavilyError(response.status, data.error);
  return formatTavily(data, maxResults);
}
