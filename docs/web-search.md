# web-search

Busca na internet para a IA: a tool `search_web` e o serviço `webSearch`. Código em
`src/plugins/web-search/` (`web-search.ts` e `tavily.ts`).

## Como busca

1. **Tavily**, se há `tavily.apiKey` e ele não está de lado: resumo e até `tavily.maxResults` fontes
   (título, URL e 350 caracteres de trecho cada), para o modelo ler. A requisição tem prazo próprio de 10 s, somado ao
   signal de quem chamou.
2. **Busca nativa do provider** (Google Grounding) pelo [`ai`](ai.md), se o Tavily não tem chave,
   está sem cota ou falhou. Só os itens da cadeia cujo provider tem busca nativa (o Gemini) são
   tentados. O resumo leva junto a lista `Fontes:` com as URLs que o provider
   devolveu (`sources` do `generate`), quando há.
3. Nada serve: `SearchUnavailableError`, e a tool devolve `fail('unavailable')`.

Cota esgotada (HTTP 429, 432 ou 433; em 401/402/403 também se o texto fala de cota, limite ou
crédito) põe o Tavily de lado por `quotaCooldownMs` (1 h), sem timer: compara com o relógio.
Falha comum (rede, prazo estourado, 5xx, 400 com "limit" no corpo) cai no fallback **sem**
esperar. O `ai` é opcional (`optionalDependsOn`): sem ele, só o Tavily.

Todo resultado leva as URLs das fontes porque, sem elas, o modelo que precisa mandar um link
inventa um. A Luma só manda link que veio de uma ferramenta ([luma.md](luma.md)).

## Tools da IA

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `search_web` | `query` | Busca e devolve o texto (`results`) só ao modelo | `unavailable` |
| `search_images` | `query` | Busca imagens pela descrição e devolve até `tavily.maxResults` (`images`: `url` e, quando o Tavily dá, `description`) só ao modelo | `unavailable` (sem chave do Tavily ou sem cota), `not-found` |
| `send_image` | `url`, `caption?` | Baixa a imagem do link e envia no chat (`send.image`) | `url-failed`, `not-image` |

## Imagem e meme da internet

"Manda um meme de X" é um encadeamento que o modelo faz com as tools:

- **Imagem:** `search_images` → `send_image` com a URL escolhida pela descrição.
- **Figurinha:** `search_images` → `create_sticker` com `url` ([sticker.md](sticker.md)).
- **Vídeo:** `search_web` (que traz as URLs) → `download_media` ([download.md](download.md)).

`search_images` só tem o Tavily: a busca nativa não devolve imagens. O `send_image` baixa pelo
`fetchUrl` do `sticker` (`src/plugins/sticker/fetch-url.ts`): recusa endereço interno (também nos
redirecionamentos) e passa de 5 MB. O tipo é conferido pelos primeiros bytes (JPEG, PNG, GIF ou
WebP; `image-type.ts`), porque o link pode levar a uma página HTML. O link que não baixa vai ao log
como `web-search.image.refused`, só com o host.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `tavily.apiKey` | — | Chave do Tavily (secreta): `BRIDGER_WEB_SEARCH__TAVILY__API_KEY` |
| `tavily.maxResults` / `tavily.searchDepth` | `5` / `basic` | Parâmetros da busca; `maxResults` também é o limite do que é mostrado |
| `models` | `[]` | Cadeia da busca nativa, no formato do `ai`. Vazio usa a principal |
| `quotaCooldownMs` | `3600000` | Quanto o Tavily fica de lado depois de acusar cota |

## Serviço `webSearch`

```ts
search(query: string, signal?: AbortSignal, by?: Message): Promise<string>  // lança SearchUnavailableError; by conta no usage
```
