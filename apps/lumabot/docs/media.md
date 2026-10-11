# Plugin `media`

Figurinha, imagem, GIF e PDF. Código em `src/plugins/media/`: `media.ts` (comandos),
`convert.ts` (conversões) e `fetch-url.ts` (download do link do `!sticker`). Port do
`MediaPlugin` do legacy.

## Comandos

Cada comando usa a mídia da própria mensagem ou, na falta, a da mensagem citada.

| Comando | Entrada | Saída |
| --- | --- | --- |
| `!sticker` / `!s` | Imagem, vídeo, GIF, figurinha ou link | Figurinha 512×512. Texto depois do comando vira legenda na figurinha (até 3 linhas, 90 caracteres; só em imagem) |
| `!image` / `!i` | Figurinha | PNG. Figurinha animada vira o primeiro quadro |
| `!gif` / `!g` | Figurinha animada | Vídeo MP4 H.264 (figurinha estática: sugere o `!image`) |
| `!pdf [nome]` | Imagem | PDF de uma página, com `nome` em slug (`Relatório Março` → `relatorio-marco.pdf`); padrão `imagem.pdf` |
| `!mergepdf` / `!joinpdf` | PDF | Adiciona o PDF à lista de quem mandou, naquele chat |
| `!mergepdf done [nome]` | — | Junta a lista na ordem e envia; padrão `pdf-juntado.pdf`. Também `pronto`, `finalizar` |
| `!mergepdf clear` | — | Esvazia a lista. Também `limpar`, `cancelar` |

Enquanto converte, o bot reage ⏳ na mensagem e depois ✅ ou ❌, se o transport tiver
`reactions`. Erro de conversão vai para o log (`falha ao processar mídia`) e o chat recebe
`conversionError`.

## Capabilities

O plugin exige só `media.download`. Cada comando confere no `ctx.capabilities` a capability do
que envia (`send.sticker`, `send.image`, `send.video`, `send.document`) e, sem ela, responde
`unsupported`. Assim um transport sem figurinha, como o Discord, mantém imagem e PDF.

## FFmpeg

Vídeo → figurinha e figurinha animada → MP4 rodam o binário `ffmpeg`, que precisa estar no
`PATH` (com `libwebp` e `libx264`, como nos builds do apt e do gyan.dev). Imagem e PDF não
dependem dele: usam Sharp e pdf-lib. Por isso, sem o FFmpeg, o plugin sobe mesmo assim: o `setup`
só registra o aviso `ffmpeg indisponível` no log. O FFmpeg trabalha em arquivos num diretório temporário
(`os.tmpdir()`), apagado ao fim de cada conversão.

O FFmpeg não lê WebP animado, então o `!gif` passa a figurinha para GIF com o Sharp antes.

## Limites

| O quê | Limite | Por quê |
| --- | --- | --- |
| Prazo dos comandos | 60 s | Conversão segura o chat; o padrão do bot é curto para um vídeo |
| Figurinha de vídeo | 20 s, 15 fps, até 800 KB | Figurinha animada pesada chega, mas não baixa no WhatsApp |
| Download do link | 5 MB, até 3 redirecionamentos | O link vem de qualquer pessoa no chat |
| Lista do `!mergepdf` | 50 MB por pessoa; some 30 min depois do último PDF | Vive em memória |

O link do `!sticker` só é baixado se todos os endereços do host forem públicos: loopback, redes
privadas, link-local (metadados de nuvem) e multicast são recusados, a cada redirecionamento.
O tipo do arquivo sai dos bytes iniciais (GIF, MP4/MOV, WebM viram figurinha animada).

Vídeo nítido (como os do `!download`) passa fácil de 800 KB. A figurinha é refeita com qualidade,
duração e fps menores até caber: 75/20 s/15 fps, 50/10 s/15 fps, 40/8 s/12 fps, 30/6 s/10 fps e
20/4 s/10 fps. Se nem a última cabe, o comando responde erro de conversão em vez de mandar uma
figurinha que não baixa.

A lista do `!mergepdf` fica em memória: um restart a esvazia.

## Textos

Todos os textos ao usuário ficam em `messages` e a config do bot os sobrescreve
(`stickerPack` → `BRIDGER_MEDIA__MESSAGES__STICKER_PACK`, ver
[Config](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md)).
Isso inclui `stickerPack` e `stickerAuthor`, o nome e o autor do pacote que o WhatsApp mostra
nos detalhes da figurinha (gravados no EXIF do WebP).

## Diferenças do legacy

- `!gif` envia o MP4 como vídeo comum, não no modo GIF do WhatsApp (`gifPlayback`, que toca
  em loop): decisão do dono, o vídeo basta.
- Figurinha de vídeo e de GIF têm o mesmo limite de 20 s (o legacy dava 15 s ao GIF).
- As métricas (`stickers_created`, `pdfs_merged`...) não foram portadas.
