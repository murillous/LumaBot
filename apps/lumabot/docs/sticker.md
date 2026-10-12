# Plugins `sticker` e `sticker-text`

Figurinha a partir de imagem, vídeo ou link (`sticker`) e a legenda escrita nela
(`sticker-text`). O `sticker` oferece o serviço `sticker`, e o `sticker-text` só se encaixa
nele: desligar o `sticker-text` tira a legenda, e a figurinha segue igual
([ADR 0001](../../../docs/adr/0001-plugins-compostos-por-servico.md)).

Código em `src/plugins/sticker/` (`sticker.ts`: comando e serviço; `convert.ts`: conversões;
`fetch-url.ts`: download do link) e `src/plugins/sticker-text/` (`caption.ts`: a legenda).
Port do `!sticker` do `MediaPlugin` do legacy.

## Comando

| Comando | Entrada | Saída |
| --- | --- | --- |
| `!sticker [texto]` / `!s` | Imagem, vídeo, GIF, figurinha ou link | Figurinha 512×512 |

A mídia vem da própria mensagem ou, na falta, da citada; mídia de visualização única é recusada.
Com o `sticker-text` carregado, o texto depois do comando (sem o link) vira legenda na
figurinha estática, até 90 caracteres, com emoji colorido (ver [Legenda](#legenda-sticker-text)).
Sem ele, o texto é ignorado. Figurinha animada nunca leva legenda.

Enquanto converte, o bot reage ⏳ na mensagem e depois ✅ ou ❌; num transport sem `reactions`, a
reação é ignorada. Erro de conversão vai para o log (`falha ao processar mídia`) e o chat recebe
`conversionError`; link que não baixa recebe `urlError`.

## Serviço `sticker`

Outros plugins usam a figurinha pelo `ctx.services.get('sticker')`, sem importar o código do
`sticker`. O tipo vem por declaration merging de `src/plugins/sticker/sticker.ts`.

| Método | O que faz |
| --- | --- |
| `decorate(step, signal)` | Acrescenta uma etapa à figurinha estática: recebe o PNG 512×512 e o `{ text }` do comando, devolve outro PNG 512×512. Etapas rodam na ordem de registro, depois do redimensionamento e antes do WebP |
| `create(media, { animated, text, signal })` | Bytes → figurinha pronta (WebP com o pacote no EXIF). Estática passa pelas etapas; `animated` (vídeo, GIF) vai pelo FFmpeg, sem etapas |

Dois jeitos de compor:

- **Estender** (`sticker-text`): declare `dependsOn: { sticker: '^0.0.0' }` e registre a etapa
  no `setup` com o `ctx.signal` do plugin. O sinal aborta no teardown e no reload, e o serviço
  tira a etapa sozinho: não há o que desfazer à mão.

  ```ts
  setup: (ctx) => ctx.services.get('sticker').decorate(addCaption, ctx.signal),
  ```

- **Usar** (`!downloadsticker` do [`download`](download.md)): sem `dependsOn`, confira
  `ctx.services.has('sticker')` a cada uso e responda em texto se faltar. O plugin carrega sem o
  `sticker`, e o `get` na hora do comando pega o serviço novo depois de um reload.

Num reload do `sticker` (mudança de config, por exemplo), o serviço é provido de novo, sem
etapas, e o kernel recarrega em cascata quem tem `dependsOn: { sticker }`, que registra a etapa
outra vez.

## Legenda (`sticker-text`)

O texto sai pelo Pango (entrada `text` do Sharp), quebrado por palavra e centralizado, com
contorno. A legenda ocupa no máximo um terço da figurinha: texto que passa disso encolhe até
caber.

| Config | Padrão | O quê |
| --- | --- | --- |
| `font` | `Sans Bold` | Família e estilo no formato do Pango (`Impact`, `DejaVu Sans Bold`). Fonte que o sistema não tem cai na fonte padrão do fontconfig |
| `fontSize` | `58` | Tamanho em px, de 16 a 128 |
| `color` | `#ffffff` | Cor do texto, `#rrggbb` |
| `strokeColor` | `#000000` | Cor do contorno |
| `strokeWidth` | `5` | Espessura do contorno em px, de 0 (sem contorno) a 16 |
| `position` | `bottom` | `bottom` ou `top` |

Vem da config do bot como qualquer config de plugin: variável (`BRIDGER_STICKER_TEXT__FONT_SIZE=48`,
`BRIDGER_STICKER_TEXT__POSITION=top`), arquivo ou override no dashboard. Valor inválido (cor fora
de `#rrggbb`, tamanho fora da faixa) deixa o plugin de fora no boot, com o campo no relatório; numa
mudança em funcionamento, a mudança é recusada e a legenda segue com o estilo anterior. Mudança
válida recarrega o `sticker-text`, que registra a etapa com o estilo novo.

**Emoji colorido** depende de uma fonte de emoji colorida no sistema: instale
`fonts-noto-color-emoji` (Debian/Ubuntu). Sem ela, o emoji sai na cor do texto, e o `setup` avisa
no log (`fonte de emoji colorido não encontrada`). O SVG, usado antes, não serve: o librsvg pinta
o emoji com a cor do texto mesmo com a fonte instalada.

## Capabilities

O `sticker` exige `media.download` e `send.sticker`. Sem eles não carrega, e o `sticker-text`
fica de fora com `dependency-skipped`; o `!downloadsticker` responde `stickerUnavailable`.

## FFmpeg

Vídeo → figurinha roda o binário `ffmpeg`, que precisa estar no `PATH` (com `libwebp`, como nos
builds do apt e do gyan.dev). Figurinha de imagem não depende dele: usa o Sharp. Por isso, sem o
FFmpeg, o plugin sobe mesmo assim: o `setup` só registra o aviso `ffmpeg indisponível` no log. O
FFmpeg trabalha em arquivos num diretório temporário (`os.tmpdir()`), apagado ao fim de cada
conversão.

## Limites

| O quê | Limite | Por quê |
| --- | --- | --- |
| Prazo do comando | 60 s | Conversão segura o chat; o padrão do bot é curto para um vídeo |
| Figurinha de vídeo | 20 s, 15 fps, até 800 KB | Figurinha animada pesada chega, mas não baixa no WhatsApp |
| Download do link | 5 MB, até 3 redirecionamentos | O link vem de qualquer pessoa no chat |

O link do `!sticker` só é baixado se todos os endereços do host forem públicos: loopback, redes
privadas, link-local (metadados de nuvem) e multicast são recusados, a cada redirecionamento.
O tipo do arquivo sai dos bytes iniciais (GIF, MP4/MOV, WebM viram figurinha animada).

Vídeo nítido (como os do `!download`) passa fácil de 800 KB. A figurinha é refeita com qualidade,
duração e fps menores até caber: 75/20 s/15 fps, 50/10 s/15 fps, 40/8 s/12 fps, 30/6 s/10 fps e
20/4 s/10 fps. Se nem a última cabe, o comando responde erro de conversão em vez de mandar uma
figurinha que não baixa.

O `!sticker` roda fora da fila do chat (`background`): as outras mensagens do chat não esperam a
conversão.

## Textos

Os textos ao usuário ficam em `messages` e a config do bot os sobrescreve
(`stickerPack` → `BRIDGER_STICKER__MESSAGES__STICKER_PACK`, ver
[Config](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md)).
Isso inclui `stickerPack` e `stickerAuthor`, o nome e o autor do pacote que o WhatsApp mostra
nos detalhes da figurinha (gravados no EXIF do WebP), também nas figurinhas do `!downloadsticker`.
`{prefix}` nos textos de uso vira o prefixo do chat. O `sticker-text` não tem textos, só o
estilo (ver [Legenda](#legenda-sticker-text)).

## Diferenças do legacy

- Figurinha de vídeo e de GIF têm o mesmo limite de 20 s (o legacy dava 15 s ao GIF).
- A legenda é um plugin à parte, que pode ser desligado, com estilo configurável e emoji
  colorido.
- As métricas (`stickers_created`...) não foram portadas.
