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

A mídia vem da própria mensagem ou, na falta, da citada; mídia de visualização única é recusada.
Com o `sticker-text` carregado, o texto depois do comando (sem o link) vira legenda na
figurinha estática, até 90 caracteres, com emoji colorido (ver [Legenda](#legenda-sticker-text)).
Sem ele, o texto é ignorado. Figurinha animada nunca leva legenda.

Enquanto converte, o bot reage ⏳ na mensagem e depois ✅ ou ❌; num transport sem `reactions`, a
reação é ignorada. Erro de conversão vai para o log (`falha ao processar mídia`) e o chat recebe
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
`setup` avisa no log (`fonte de emoji colorido não encontrada`). O SVG, usado antes, não serve: o
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
