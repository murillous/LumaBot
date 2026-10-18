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
    // 429 é limite de taxa e 432/433 são plano ou crédito esgotado; o texto cobre o resto.
    this.quota = [429, 432, 433].includes(status) || /quota|limit|credit/i.test(body);
  }
}

const SNIPPET = 350;
const SHOWN = 4;

/** Resumo do Tavily e as primeiras fontes, no tamanho que cabe no contexto do modelo. */
export function formatTavily(data: TavilyResponse): string {
  const lines: string[] = [];
  if (data.answer) lines.push(`Resumo: ${data.answer}`, '');
  (data.results ?? []).slice(0, SHOWN).forEach((r, i) => {
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
    ...(signal && { signal }),
  });
  if (!response.ok) throw new TavilyError(response.status, await response.text().catch(() => ''));
  const data = (await response.json()) as TavilyResponse;
  if (data.error) throw new TavilyError(response.status, data.error);
  return formatTavily(data);
}
