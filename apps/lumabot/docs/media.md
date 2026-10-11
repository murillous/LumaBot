# Plugin `media`

Figurinha, imagem, GIF e PDF. Código em `src/plugins/media/`: `media.ts` (comandos),
`convert.ts` (conversões) e `fetch-url.ts` (download do link do `!sticker`). Port do
`MediaPlugin` do legacy.

## Comandos

Cada comando usa a mídia da própria mensagem ou, na falta, a da mensagem citada. O tipo é
conferido no `accepts` do comando (o `!mergepdf` aceita só documento `application/pdf`); mídia de
outro tipo recebe o texto de uso.

| Comando | Entrada | Saída |
| --- | --- | --- |
| `!sticker` / `!s` | Imagem, vídeo, GIF, figurinha ou link | Figurinha 512×512. Texto depois do comando vira legenda na figurinha (até 3 linhas, 90 caracteres; só em imagem) |
| `!image` / `!i` | Figurinha | PNG. Figurinha animada vira o primeiro quadro |
| `!gif` / `!g` | Figurinha animada | Vídeo MP4 H.264 (figurinha estática: sugere o `!image`) |
| `!pdf [nome]` | Imagem | PDF de uma página, com `nome` em slug (`Relatório Março` → `relatorio-marco.pdf`); padrão `imagem.pdf` |
| `!mergepdf` / `!joinpdf` | PDF | Adiciona o PDF à lista de quem mandou, naquele chat |
| `!mergepdf done [nome]` | — | Junta a lista na ordem e envia; padrão `pdf-juntado.pdf`. Também `pronto`, `finalizar` |
| `!mergepdf clear` | — | Esvazia a lista. Também `limpar`, `cancelar` |

Enquanto converte, o bot reage ⏳ na mensagem e depois ✅ ou ❌; num transport sem
`reactions`, a reação é ignorada. Erro de conversão vai para o log (`falha ao processar mídia`) e o chat recebe
`conversionError`.

## Capabilities

O plugin exige só `media.download`. Cada comando declara no `requires` a capability do que envia
(`send.sticker`, `send.image`, `send.video`, `send.document`) e, sem ela, não é registrado: some
do roteador e da lista de comandos. Assim um transport sem figurinha, como o Discord, mantém
imagem e PDF.

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
| Prazo dos comandos | 60 s | O padrão do bot é curto para converter um vídeo |
| `!sticker` e `!gif` simultâneos | 2 de cada, no bot inteiro (`concurrency`); o excedente espera a vez dentro do prazo | Cada FFmpeg ocupa um núcleo e centenas de MB |
| Figurinha de vídeo | 20 s, 15 fps, até 800 KB | O WhatsApp recusa figurinha animada pesada |
| Download do link | 5 MB, até 3 redirecionamentos | O link vem de qualquer pessoa no chat |
| Lista do `!mergepdf` | 50 MB por pessoa; some 30 min depois do último PDF | Vive em memória |

O link do `!sticker` só é baixado se todos os endereços do host forem públicos: loopback, redes
privadas, link-local (metadados de nuvem) e multicast são recusados, a cada redirecionamento.
O tipo do arquivo sai dos bytes iniciais (GIF, MP4/MOV, WebM viram figurinha animada).

A lista do `!mergepdf` fica em memória: um restart a esvazia.

O `!sticker` e o `!gif` rodam fora da fila do chat (`background`): as outras mensagens do chat
não esperam a conversão. O `!mergepdf` fica na fila, para o `done` não passar à frente do último
PDF adicionado.

## Textos

Todos os textos ao usuário ficam em `messages` e a config do bot os sobrescreve
(`stickerPack` → `BRIDGER_MEDIA__MESSAGES__STICKER_PACK`, ver
[Config](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md)).
Isso inclui `stickerPack` e `stickerAuthor`, o nome e o autor do pacote que o WhatsApp mostra
nos detalhes da figurinha (gravados no EXIF do WebP).

Os textos usam placeholders: `{prefix}` vira o prefixo do chat (`ℹ️ Responda a um sticker com
{prefix}image`) e o `mergeAdded` recebe `{count}`, o tamanho da lista. A sobrescrita só pode usar
os placeholders do texto padrão.

## Diferenças do legacy

- `!gif` envia o MP4 como vídeo comum, não no modo GIF do WhatsApp (`gifPlayback`, que toca
  em loop): decisão do dono, o vídeo basta.
- Figurinha de vídeo e de GIF têm o mesmo limite de 20 s (o legacy dava 15 s ao GIF).
- As métricas (`stickers_created`, `pdfs_merged`...) não foram portadas.
