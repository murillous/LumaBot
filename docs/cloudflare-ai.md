# cloudflare-ai

Provider `cloudflare` no ponto `ai.providers` ([ai.md](ai.md#ponto-aiproviders)), só com modelos de
**imagem**: os FLUX.2 do Workers AI, pela API REST. Quem os usa é o
[`sticker-edit`](sticker-edit.md). Código em `src/plugins/cloudflare-ai/cloudflare-ai.ts`.

## Plano grátis

O Workers AI dá **10.000 neurons por dia** no plano grátis da Cloudflare. A cota zera às
00:00 UTC e não acumula. Quando acaba, a API recusa a chamada; no plano grátis **não há cobrança**.

| Modelo | Custo | Figurinhas por dia (512×512) |
| --- | --- | --- |
| `flux-2-klein-4b` | 5,37 neurons por tile 512×512 de entrada, 26,05 por tile de saída | ~300 |
| `flux-2-klein-9b` | 1363,64 neurons pelo primeiro MP, mais 181,82 por MP de entrada | ~7 |

Os números são da [página de preços](https://developers.cloudflare.com/workers-ai/platform/pricing/).
O 9B gasta a mesma cota diária: na cadeia, ele não serve de reserva para o 4B.

## Configurar

1. Crie uma conta grátis em [dash.cloudflare.com](https://dash.cloudflare.com).
2. Em **AI → Workers AI → Use REST API**, copie o **Account ID** e crie um **API token** com a
   permissão Workers AI.
3. Configure o plugin pelo dashboard (tela Plugins) ou pelo `.env`:

```sh
BRIDGER_CLOUDFLARE_AI__ACCOUNT_ID=...
BRIDGER_CLOUDFLARE_AI__API_TOKEN=...
```

Sem os dois, o plugin carrega sem contribuir o provider (`cloudflare-ai.disabled` no log) e os
itens `cloudflare:` das cadeias são pulados.

## Modelos

O id curto vira o caminho do Workers AI: `cloudflare:flux-2-klein-4b` chama
`@cf/black-forest-labs/flux-2-klein-4b`. Um id que começa com `@` passa como veio
(`cloudflare:@cf/...`).

A imagem de referência vai em `input_image_0`, reduzida a menos de 512×512 (limite do modelo). A
saída é 512×512 quando quem chama não pede tamanho. Um erro HTTP vira `APICallError` com o
status, para a cadeia reconhecer o 429, e com o motivo do `errors` do corpo no texto, que é o que
o log mostra.

### Filtro de conteúdo

O Workers AI barra a imagem gerada com o erro `3030` ("Your output has been flagged"), comum com
personagens famosos e pessoas reais. Como o filtro olha a saída, que muda com a seed, o adaptador
gera de novo uma vez com outra seed (quando quem chama não fixou a seed). Barrada de novo, o
`APICallError` sai com `data.flagged`, que o `isContentFlagged` do `ai` reconhece. A segunda
geração gasta a cota como a primeira.

O provider não tem modelo de texto: `cloudflare:` na cadeia do `ai` falha com essa causa.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `accountId` | — | ID da conta Cloudflare |
| `apiToken` | — | Token com permissão Workers AI (segredo: cifrado pelo dashboard, censurado no log) |
