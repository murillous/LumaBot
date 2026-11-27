# ai-google, ai-openai, ai-anthropic, ai-deepseek

Um plugin por provider de IA, cada um com a própria chave. Cada plugin contribui o provider no
ponto `ai.providers` ([ai.md](ai.md#ponto-aiproviders)), e o item `provider:modelo` da cadeia
passa a valer. O `ai` não conhece nenhum deles: quem traz o SDK (`@ai-sdk/<provider>`) é o
plugin. O código fica em `src/plugins/ai-<provider>/`, e todos usam o `keyProvider` de
`src/plugins/ai/key-provider.ts`.

| Plugin | Provider | Texto | Imagem (`imageModel`) | Busca nativa |
| --- | --- | --- | --- | --- |
| `ai-google` | `google` (Gemini) | sim, com áudio na entrada | sim | Google Grounding (`google_search`) |
| `ai-openai` | `openai` | sim | sim | — |
| `ai-anthropic` | `anthropic` (Claude) | sim; sem `temperature` | — | — |
| `ai-deepseek` | `deepseek` | sim, sem áudio | — | — |

## Config

Todos têm um único campo:

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `key` | — | Chave da API do provider (secreta) |

Pelo dashboard, a chave é gravada na seção **Chaves** da tela IA. Pelo ambiente:

```sh
BRIDGER_AI_GOOGLE__KEY=...
BRIDGER_AI_OPENAI__KEY=...
BRIDGER_AI_ANTHROPIC__KEY=...
BRIDGER_AI_DEEPSEEK__KEY=...
```

O menor bot com IA tem só o `ai` e um provider:

```jsonc
{ "ai-deepseek": { "key": "..." },
  "ai": { "models": [{ "model": "deepseek:deepseek-flash" }] } }
```

Um plugin **sem chave** sobe mesmo assim, registra `ai-<provider>.key.missing` (`info`) e entra
no ponto só para o catálogo, marcado sem chave (`AiProvider.key.configured: false`). A tela IA
mostra a linha **sem chave** e pede a chave. A cadeia pula os itens dele como `unregistered`, com
o `ai.provider.unregistered` de sempre.

## Chaves de antes (compatibilidade)

Antes, os quatro providers vinham embutidos no `ai`, com as chaves em `ai.keys.<provider>`. As
chaves de antes continuam valendo sem ninguém redigitar:

- **Salvas pelo dashboard** (cifradas em nome do `ai`): o `ai` ainda declara `keys` no schema
  como campo obsoleto e repassa a chave pelo `legacyKey(provider)` do serviço `ai`. O plugin do
  provider usa essa chave quando a própria `key` está vazia. Salvar uma chave nova na tela IA
  grava em `ai-<provider>.key`, que vence a antiga.
- **Do ambiente**: o `pluginEnv` do app (`src/config.ts`) copia `BRIDGER_AI__KEYS__<PROVIDER>`
  para `BRIDGER_AI_<PROVIDER>__KEY` quando a nova não está definida. O dashboard mostra a chave
  como vinda da variável nova.
- **No arquivo de config** (`pluginConfig.ai.keys`): vale pelo mesmo legado das chaves salvas.

O legado sai quando o Bridger souber migrar um segredo de um plugin para outro
([usebridger#345](https://github.com/murillous/usebridger/issues/345)). Até lá, o campo
`ai.keys` só existe para leitura: a tela IA não grava mais nele.

## Provider novo por chave

Provider cuja config é só uma chave usa o mesmo `keyProvider`:

```ts
import { createMistral } from '@ai-sdk/mistral';
import { keyProvider } from '#plugins/ai/key-provider.ts';

export const aiMistral = keyProvider({
  plugin: 'ai-mistral',
  version: '0.1.0',
  provider: { name: 'mistral', label: 'Mistral', models: [{ id: 'mistral-large-latest' }] },
  create: (apiKey) => {
    const mistral = createMistral({ apiKey });
    return { languageModel: (id) => mistral.languageModel(id) };
  },
});
```

O `provider` (nome, rótulo, modelos, faixa de `temperature`) aparece no catálogo mesmo sem chave.
O `create` recebe a chave e devolve `languageModel` e, se o provider tiver, `imageModel` e
`nativeSearch`. Provider com outra config (URL, conta e token) contribui no ponto direto, como o
[`cloudflare-ai`](cloudflare-ai.md).

## Testes

`src/plugins/ai/key-provider.test.ts` cobre a chave própria, o legado, o provider sem chave e os
quatro plugins, sem chamada de rede.
