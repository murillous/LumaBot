# Plugins `sticker` e `sticker-text`

Figurinha a partir de imagem, vídeo ou link (`sticker`) e a legenda escrita nela
(`sticker-text`). O `sticker` oferece o serviço `sticker`, e o `sticker-text` só se encaixa
nele: desligar o `sticker-text` tira a legenda, e a figurinha segue igual.

Código em `src/plugins/sticker/` (`sticker.ts`: comando e serviço; `convert.ts`: conversões;
`fetch-url.ts`: download do link) e `src/plugins/sticker-text/` (`caption.ts`: a legenda).

## Comando

| Comando | Entrada | Saída |
| --- | --- | --- |
| `!sticker [texto]` / `!s` | Imagem, vídeo, GIF, figurinha ou link | Figurinha 512×512 |
| `!stickeraudio` / `!sa` | Vídeo com som; ou figurinha + áudio | Figurinha WebP com áudio nativo (OGG/Opus) de até 20 s |

A mídia vem da própria mensagem ou, na falta, da citada; mídia de visualização única é recusada.
Com o `sticker-text` carregado, o texto depois do comando (sem o link) vira legenda na
figurinha estática, até 90 caracteres, com emoji colorido (ver [Legenda](#legenda-sticker-text)).
Sem ele, o texto é ignorado. Figurinha animada nunca leva legenda.

### Figurinha com áudio (`!sa`)

O `!sa` (ou `!stickeraudio`), na mensagem do vídeo ou respondendo a ele, gera uma figurinha animada em
**WebP** com `"sound-sha256"` no chunk EXIF e envia o som do vídeo (OGG/Opus, até 20 s) no campo
`audioMessage` (26) do `StickerMessage` via `@usebridger/transport-baileys`. Se o vídeo não tiver
faixa de áudio, responde `stickerNoAudio` e registra `sticker.create.refused` com
`reason: 'no-audio'`. Num transport sem a capability `send.sticker.audio`, o comando responde
`stickerAudioUnavailable` antes de converter.

Som e animação ficam em sincronia:

- **Mesmo início.** Os dois saem da mesma linha do tempo do vídeo. Se a faixa de áudio começa
  depois da de vídeo (comum em gravação de celular), o som ganha silêncio no começo; se é o vídeo
  que começa depois, o primeiro quadro cobre o intervalo.
- **Mesma duração.** A animação é convertida primeiro, e o áudio é cortado (ou completado com
  silêncio) na duração real dela, ao milissegundo.

A duração enviada ao WhatsApp, em segundos inteiros, sai da última página do OGG (sem `ffprobe`).
Vídeo que não muda (uma foto com música, por exemplo) vira figurinha estática: o encoder junta os
quadros iguais, não há animação para sincronizar, e o som vai inteiro até 20 s.

#### Juntar figurinha e áudio

O WhatsApp não deixa texto em figurinha nem em áudio, então o `!sa` recebe uma metade e pede a
outra:

1. `!sa` respondendo a uma **figurinha**: o bot responde `stickerAudioAskAudio` e espera o próximo
   áudio ou nota de voz da pessoa.
2. `!sa` respondendo a um **áudio** ou nota de voz: o bot responde `stickerAudioAskSticker` e espera
   a próxima figurinha.

A espera é a resposta esperada do kernel
([conversas](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/conversations.md)):
vale 2 minutos, só para quem mandou o `!sa`, naquele chat, e fica em memória (um restart a perde).
A figurinha segue como veio (estática ou animada, em loop), com o EXIF trocado pelo do pacote e o
`sound-sha256`; o som vai até 20 s. Se a pessoa manda outra coisa, a espera acaba e o bot responde
`stickerAudioJoinCancelled`; um comando digitado também a cancela, sem aviso. No log, essa
figurinha conta com `kind: 'join'`.

Enquanto converte, o bot reage ⏳ na mensagem e depois ✅ ou ❌; num transport sem `reactions`, a
reação é ignorada. Erro de conversão vai para o log (`sticker.create.failed`) e o chat recebe
`conversionError`; link que não baixa recebe `urlError`.

## Tools da IA

Contribuídas ao ponto `ai.tools` ([ai-tools.md](ai-tools.md)). O resultado vai para o modelo;
o que o usuário recebe sai como resposta no chat.

| Tool | Argumentos | O que faz | Recusas (`error`) |
| --- | --- | --- | --- |
| `create_sticker` | `url?`, `caption?` | Figurinha do link ou da imagem/vídeo/figurinha da mensagem ou da citada; `caption` passa pelas etapas (`sticker-text`) | `no-media`, `view-once`, `url-failed` |

## Serviço `sticker`

Outros plugins usam a figurinha pelo `ctx.services.get('sticker')`, sem importar o código do
`sticker`. O tipo vem por declaration merging de `src/plugins/sticker/sticker.ts`.

| Método | O que faz |
| --- | --- |
| `create(media, { animated, text, signal })` | Bytes → figurinha pronta (WebP com o pacote no EXIF). Estática passa pelas etapas; `animated` (vídeo, GIF) vai pelo FFmpeg, sem etapas |

Dois jeitos de compor:

- **Estender** (`sticker-text`): contribua ao ponto de extensão `sticker.steps`
  ([ADR 0096 do Bridger](https://github.com/murillous/usebridger) e `services.md`), com
  `dependsOn: { sticker: '^1.0.0' }`. A etapa recebe o PNG 512×512 e o `{ text }` do comando e
  devolve outro PNG 512×512; roda na ordem de carga dos contribuidores, depois do redimensionamento
  e antes do WebP. O registry tira a contribuição no teardown, reload e disable de quem a fez: não
  há o que desfazer à mão.

  ```ts
  setup: (ctx) => ctx.services.contribute('sticker.steps', addCaption),
  ```

- **Usar** (`!downloadsticker` do [`download`](download.md)): sem `dependsOn`, confira
  `ctx.services.has('sticker')` a cada uso e responda em texto se faltar. O plugin carrega sem o
  `sticker`, e o `get` na hora do comando pega o serviço novo depois de um reload.

O `sticker` lê as etapas com `list()` a cada figurinha. Num reload dele, quem tem
`dependsOn: { sticker }` recarrega em cascata e contribui de novo, sem duplicar.

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
de `#rrggbb`, tamanho fora da faixa) impede o boot (`PluginBootError`, com o campo na mensagem); numa
mudança em funcionamento, a mudança é recusada e a legenda segue com o estilo anterior. Mudança
válida recarrega o `sticker-text`, que registra a etapa com o estilo novo.

**Emoji colorido** sai da [Noto Color Emoji](https://github.com/googlefonts/noto-emoji)
versionada em `fonts/NotoColorEmoji.ttf` (licença OFL, em `fonts/OFL.txt`), carregada pelo
`fontfile` do Sharp: não precisa instalar fonte no sistema. O caminho é relativo ao diretório de
onde o processo roda, como o banco; rodando de fora da raiz, o emoji sai na cor do texto e o
`setup` avisa no log (`sticker-text.emoji-font.missing`). O SVG, usado antes, não serve: o
librsvg pinta o emoji com a cor do texto mesmo com a fonte.

Para atualizar a fonte, troque o arquivo pelo `2D/fonts/NotoColorEmoji.ttf` de uma versão nova do
`googlefonts/noto-emoji`.

### Emoji colorido no Windows

O bot cuida disso sozinho; a explicação fica para quem estranhar o processo duplicado.

A fonte carregada não basta no Windows. O Pango pede o emoji pela família genérica `emoji`, e o
fontconfig embutido no Sharp (Windows) não tem o alias `emoji → Noto Color Emoji` que as distros
Linux trazem: o emoji cai na Segoe UI Symbol, monocromática. O `fontconfig/windows.conf` acrescenta
o alias e mantém as pastas de fontes do sistema e do usuário.

Quem lê o `FONTCONFIG_FILE` é o fontconfig nativo do Sharp, pelo `getenv` do runtime C, que só vê o
ambiente do início do processo: o `.env`, o `--env-file` do Node e o `process.env` chegam tarde
demais. Por isso o `src/main.ts`, no Windows e sem a variável, relança o próprio processo com ela
apontando para o `windows.conf` e só repassa o código de saída do filho. Um `FONTCONFIG_FILE` já
definido no ambiente vence, e aí não há relançamento.

Os testes não passam pelo `main.ts`: no Windows, defina a variável antes do `pnpm test` para o
teste `o emoji da legenda sai colorido` passar.

```powershell
$env:FONTCONFIG_FILE = "C:\repos\LumaBot\fontconfig\windows.conf"
```

## Capabilities

O `sticker` exige `media.download` e `send.sticker`. Sem eles o boot cai com `PluginBootError`
(o `sticker-text` junto, por `dependency-skipped`), a menos que o `sticker` e o `sticker-text`
estejam em `disabledPlugins`; então o `!downloadsticker` responde `stickerUnavailable`.

## FFmpeg

Vídeo → figurinha roda o binário `ffmpeg`, que precisa estar no `PATH` (com `libwebp` e `libopus`,
como nos builds do apt e do gyan.dev). Figurinha de imagem não depende dele: usa o Sharp. Por isso, sem o
FFmpeg, o plugin sobe mesmo assim: o `setup` só registra o aviso `sticker.ffmpeg.missing` no log. O
FFmpeg trabalha em arquivos num diretório temporário (`os.tmpdir()`), apagado ao fim de cada
conversão.

## Limites

| O quê | Limite | Por quê |
| --- | --- | --- |
| Prazo do comando | 60 s | Conversão segura o chat; o padrão do bot é curto para um vídeo |
| Figurinha de vídeo | 20 s, 15 fps, até 800 KB | Figurinha animada pesada chega, mas não baixa no WhatsApp |
| Figurinha com áudio | 20 s, 4 a 15 fps, até 800 KB | O som toca inteiro: fps e qualidade se ajustam ao vídeo |
| Espera da outra metade do `!sa` | 2 min | Tempo de achar o áudio ou a figurinha no celular |
| Download do link | 5 MB, até 3 redirecionamentos | O link vem de qualquer pessoa no chat |

O link do `!sticker` só é baixado se todos os endereços do host forem públicos: loopback, redes
privadas, link-local (metadados de nuvem) e multicast são recusados, a cada redirecionamento.
O tipo do arquivo sai dos bytes iniciais (GIF, MP4/MOV, WebM viram figurinha animada).

A animação sai do encoder `libwebp_anim` do FFmpeg (o WebPAnimEncoder), que regrava só a parte do
quadro que mudou e junta quadros iguais, depois de um `gblur` leve (sigma 0,8) que tira o detalhe
fino que pesa e nem aparece no tamanho da figurinha. Num vídeo de meme de 15 s, os dois juntos
deixam a figurinha 26% menor que o `libwebp` puro, o que vira mais fps e qualidade no mesmo limite.
A transparência (GIF, WebM, MOV com alfa) é mantida; o `hqdn3d` ficou de fora porque a apaga.

Vídeo nítido (como os do `!download`) passa fácil de 800 KB. A figurinha é refeita com qualidade,
duração e fps menores até caber: 75/20 s/15 fps, 50/10 s/15 fps, 40/8 s/12 fps, 30/6 s/10 fps e
20/4 s/10 fps. Se nem a última cabe, o comando responde erro de conversão em vez de mandar uma
figurinha que não baixa.

A figurinha com áudio (`!sa`) não encurta primeiro: o som precisa tocar inteiro. O plano é
dinâmico, pelo peso de cada vídeo:

1. Três amostras a 2 fps do vídeo inteiro (até 20 s), nas qualidades 50, 30 e 15, dão o peso médio
   por quadro de cada uma. O peso cresce linear com o fps, então a amostra prevê o resultado.
2. Com um orçamento de 92% dos 800 KB, escolhe a melhor qualidade que ainda dá 8 fps (até 15).
   Se nenhuma dá, usa a qualidade 15 no maior fps que couber.
3. Só se nem 4 fps cabem, encurta a figurinha (e o som) até caber a 4 fps.
4. Se o resultado ainda passar do limite, replaneja com o peso medido nele (até 3 vezes).

Um vídeo de meme de 15 s (720×1280, granulado) sai inteiro a 5 fps em uns 8 s de conversão; um
vídeo leve sai a 15 fps na qualidade 50.

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
