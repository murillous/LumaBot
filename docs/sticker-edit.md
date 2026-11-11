# sticker-edit

Edição de figurinha por IA: o comando `!editar`, o serviço `stickerEdit` e a tool `edit_sticker`.
Código em `src/plugins/sticker-edit/sticker-edit.ts`. Só figurinha: foto não é aceita.

Quem entende o pedido é a Luma, na cadeia principal (DeepSeek ou outra): ela chama a tool com o
pedido detalhado e em inglês. Quem altera os pixels é a cadeia de **modelos de imagem** deste
plugin, que por padrão só tem o modelo grátis do Cloudflare ([cloudflare-ai.md](cloudflare-ai.md)).
A figurinha final sai pelo serviço `sticker`, com o pacote no EXIF.

## Comando

| Comando | O que faz |
| --- | --- |
| `!editar <pedido>` (`!edit`) | Edita a figurinha da mensagem ou da citada e responde com a figurinha editada |

### Imagem de referência

Para usar uma foto (o rosto de alguém, um objeto, um estilo), **responda à figurinha mandando a
foto** com o `!editar` na legenda:

> *responde à figurinha com uma foto:* `!editar coloca o rosto dessa pessoa na figurinha`

A figurinha citada é a que é editada; a foto ou figurinha da própria mensagem vai como referência,
depois dela, e o prompt diz ao modelo qual é qual. Cada referência soma uns 5 neurons no
Cloudflare. O klein 4B é rápido e barato, mas a identidade de um rosto sai aproximada; recortar o
rosto na foto ajuda, porque a referência também vai com menos de 512×512.

Os modelos devolvem JPEG, sem transparência: a figurinha vai ao modelo sobre fundo branco e, se
era recortada, o branco ligado às bordas da imagem editada volta a ser transparente (o branco
dentro do desenho fica). Figurinha que já tinha fundo volta como o modelo a devolveu.

Reage ⏳ enquanto trabalha, ✅ quando envia e ❌ se falha. Sem pedido ou sem figurinha, explica
como usar. Mídia de visualização única é recusada. Figurinha animada é editada a partir do
primeiro quadro e volta estática. Se o filtro de conteúdo do modelo recusa (personagem famoso, pessoa real), o
comando diz isso e sugere outra figurinha ou outro pedido. Se a cadeia falha por outro motivo (a
cota do dia acabou, por exemplo), responde uma frase curta e a causa vai só para o log. Roda em segundo plano, com prazo de 120 s.

## Tool da IA

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `edit_sticker` | `request` | Edita a figurinha da mensagem ou da citada e envia no chat, com a foto ou figurinha da própria mensagem como referência quando a figurinha é a citada; devolve o `model` que editou | `no-sticker`, `view-once`, `too-large`, `flagged`, `unavailable` |

## Serviço `stickerEdit`

```ts
edit(sticker: Buffer, request: string, options: { signal, references? }): Promise<{ sticker, model }>
```

Converte a figurinha para PNG (primeiro quadro) e as `references` (até três) para PNG desvirado
pelo EXIF, percorre a cadeia e devolve a figurinha pronta.
Lança `StickerTooLargeError` (figurinha ou referência acima de `maxBytes`),
`StickerEditFlaggedError` (o filtro de conteúdo recusou em algum modelo e nenhum editou) e
`StickerEditUnavailableError` (nenhum modelo
editou).

## Cadeia de modelos de imagem

Os modelos vêm do método `imageModel` dos providers do ponto `ai.providers`
([ai.md](ai.md#ponto-aiproviders)). Item sem provider com chave, ou sem `imageModel` (Claude,
DeepSeek), é pulado sem chamada.

Diferente da cadeia de texto, **qualquer** erro passa para o próximo modelo, não só os
transitórios: cota esgotada, modelo que a chave não acessa e recusa de conteúdo variam de um
modelo para outro. Só o cancelamento de quem chamou interrompe. Um 429 manda o modelo para o fim
da cadeia por `cooldownMs`.

O padrão é só `cloudflare:flux-2-klein-4b`: no plano grátis do Cloudflare, uma figurinha
512×512 gasta uns 31 dos 10.000 neurons do dia (perto de 300 edições). Acabou a cota, a API
recusa até as 00:00 UTC, sem cobrar.

> **Custo:** os modelos de imagem do Google (`google:gemini-2.5-flash-image`...) e da OpenAI
> (`openai:gpt-image-1`...) também funcionam na cadeia, mas **cobram** se a chave tiver billing
> ou saldo. O Gemini Image, em geral, nem tem cota gratuita. Por isso ficam fora do padrão.

## Config

| Campo | Padrão | Efeito |
| --- | --- | --- |
| `models` | `["cloudflare:flux-2-klein-4b"]` | Modelos de imagem (`provider:modelo`), em ordem |
| `maxBytes` | `2097152` | Figurinha ou referência maior que isso nem vai ao modelo |
| `timeoutMs` | `60000` | Prazo de cada tentativa |
| `cooldownMs` | `1800000` | Quanto tempo um modelo que respondeu 429 vai para o fim da cadeia |

Por variável: `BRIDGER_STICKER_EDIT__MODELS='["cloudflare:flux-2-klein-4b"]'`.

`messages`: `usage`, `viewOnce`, `conversionError`, `tooLarge`, `flagged` (`{prefix}` é o prefixo do chat).

## Log e métricas

`sticker-edit.edit.done` / `.refused` / `.failed`, com `kind` (`sticker`), `model`, `bytes` e `references` (quantas);
nunca o pedido nem a imagem. Cada modelo que falha e passa a vez registra
`sticker-edit.model.failed` com o erro (é onde aparece a cota esgotada). Com o `metrics`:
`luma_sticker_edit_total{kind, outcome}` e `luma_sticker_edit_seconds{kind}`.
