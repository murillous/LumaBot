# apps/lumabot — documentação

O LumaBot sobre o [Bridger](https://github.com/murillous/usebridger), consumido do npm
(`@usebridger/*`). O app só compõe o bot: transport
([Baileys](https://github.com/murillous/usebridger/blob/develop/packages/transport-baileys/docs/README.md)), storage
([SQLite](https://github.com/murillous/usebridger/blob/develop/packages/storage-sqlite/docs/README.md)) e a lista de plugins, e cuida do
processo (sinais, código de saída). O kernel é uma biblioteca sem runner
([ADR 0034](https://github.com/murillous/usebridger/blob/develop/docs/adr/0034-biblioteca-sem-runner.md)).

> M2-5: app mínimo, com o plugin `ping`. As features do legacy chegam como plugins nos marcos
> seguintes.

## Rodar

Na raiz, depois do `pnpm install`:

```sh
pnpm build
pnpm --filter lumabot start   # roda dist/main.mjs
```

Os plugins `sticker`, `sticker-convert` e `download` rodam o `ffmpeg` do sistema, e o `download`,
também o `yt-dlp`: instale os dois e deixe-os no `PATH` (ver [sticker.md](sticker.md#ffmpeg) e
[download.md](download.md#binários)). Para o emoji colorido na legenda das figurinhas, instale
também uma fonte de emoji colorida (`fonts-noto-color-emoji`, ver
[sticker.md](sticker.md#legenda-sticker-text)). No Windows, também é preciso o `FONTCONFIG_FILE`
([sticker.md](sticker.md#emoji-colorido-no-windows)).

Para desenvolver sem build, `pnpm --filter lumabot dev` executa o `.ts` direto (type stripping
do Node).

No primeiro uso o terminal mostra o QR: no celular, *Aparelhos conectados → Conectar aparelho*.
Depois do pareamento o servidor pede um restart e o bot reconecta sozinho. Mande `!ping` de outro
número e o bot responde `pong`, citando a mensagem. Do próprio número não funciona: o middleware
`ignore-self` barra as mensagens da sessão.

`Ctrl+C` (ou `SIGTERM`) encerra pelo `bot.stop()`, que drena as filas e fecha o banco. Um segundo
sinal mata o processo, para o caso de o encerramento travar.

Quando a reconexão desiste (outro processo assumiu o número, `replaced`, ou erro de configuração,
`fatal`), o core loga o motivo e deixa o bot em `failed`, sem atender. O plugin `give-up` avisa o
`main.ts`, que encerra pelo `bot.stop()` com código de saída 1: o supervisor (systemd, pm2) vê a
falha. Queda de rede e sessão deslogada não entram aqui: o bot reconecta ou pede novo pareamento.

## Config

Por variáveis de ambiente, lidas em `src/config.ts`. Variável vazia vale como ausente.

O `start` e o `dev` carregam `apps/lumabot/.env`, se existir (`--env-file-if-exists` do Node).
Variável já definida no ambiente vence a do arquivo. Copie o `.env.example`, que lista as
variáveis do app, do dashboard e da IA. O `.env` fica fora do Git. A exceção é o
`FONTCONFIG_FILE` do Windows, que precisa estar no ambiente do sistema
([sticker.md](sticker.md#emoji-colorido-no-windows)).

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `LUMABOT_DB` | `data/lumabot.sqlite` | Arquivo do banco, relativo ao diretório de onde o processo roda. Guarda as credenciais do WhatsApp: apagar o arquivo (e os `-wal`/`-shm`) obriga a parear de novo |
| `LUMABOT_PAIRING_PHONE` | — | Número com DDI, só dígitos (`5511999999999`). Com ele, o bot pede um código de pareamento em vez do QR: digite-o em *Aparelhos conectados → Conectar com número de telefone* |
| `LUMABOT_YTDLP_COOKIES` | — | Arquivo de cookies (formato Netscape) que o plugin `download` repassa ao yt-dlp ([download.md](download.md#config)) |
| `LUMABOT_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` ou `silent` |
| `LUMABOT_DASHBOARD_PORT` | — | Liga o [dashboard](dashboard.md) nessa porta (exige `BRIDGER_DASHBOARD__TOKEN`) |
| `LUMABOT_DASHBOARD_HOST` | `127.0.0.1` | Interface de escuta do dashboard ([dashboard.md](dashboard.md#exposição)) |

Config inválida de plugin (ex.: `BRIDGER_STICKER_TEXT__COLOR=vermelho`) impede o boot.

A config dos plugins segue o padrão do core (`BRIDGER_<PLUGIN>__<CAMPO>`,
[Config](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md)).

Valor inválido derruba o boot com a variável na mensagem. No terminal, o log sai legível
(`14:03:22 INFO  [sticker] mensagem chave=valor`, com cor); com o stdout redirecionado (serviço,
arquivo, agregador), em JSON, uma linha por evento. O Baileys só escreve a partir de `warn`. O QR
e o código de pareamento saem fora do log, direto no stdout.

## Plugins do app

Ficam em `src/plugins/` e entram na lista do `createBot` em `src/main.ts`. Dos oficiais do
Bridger, o app carrega o `metrics` e, com `LUMABOT_DASHBOARD_PORT`, o [`dashboard`](dashboard.md).

| Plugin | O que faz |
| --- | --- |
| `pairing` | Desenha no terminal o QR (`connection.qr`) ou mostra o código (`connection.pairing-code`). O log do bot só avisa que chegou um QR, sem o valor |
| `ping` | `!ping` responde `pong`: prova o caminho transport → kernel → fila de saída → transport |
| [`ai`](ai.md) | Cadeia de modelos (Gemini, OpenAI, Claude, DeepSeek) com fallback, tool calling e busca nativa. Oferece o serviço `ai` e os pontos `ai.providers` e `ai.observers` |
| [`ai-metrics`](ai-metrics.md) | Consumo, vazão e custo por modelo, pelo serviço `metrics`. Oferece o serviço `aiMetrics` |
| [`luma`](luma.md) | A personagem: responde em PV, quando citada, chamada ou mencionada; histórico, personas e `!persona`, `!luma clear`/`stats`. Oferece o serviço `luma` |
| [`spontaneous`](spontaneous.md) | Reação com emoji às mensagens dos grupos, decidida pela IA |
| [`resumo`](resumo.md) | Resumo da conversa: `!resumo [n]`. Oferece o serviço `resumo` |
| [`transcribe`](transcribe.md) | Transcrição de áudio: `!transcribe` (`!t`). Oferece o serviço `transcription` |
| [`web-search`](web-search.md) | Busca na internet (Tavily, com Google Grounding de reserva). Oferece o serviço `webSearch` |
| [`help`](help.md) | Menu de comandos gerado do kernel: `!help`, `!menu`, `!ajuda`. Oferece o serviço `help` e o ponto `help.sections` |
| [`sticker`](sticker.md) | Figurinha de imagem, vídeo ou link: `!sticker`. Oferece o serviço `sticker` |
| [`sticker-text`](sticker.md) | Texto do `!sticker` como legenda; estende o serviço `sticker` |
| [`sticker-convert`](sticker-convert.md) | Figurinha de volta a imagem ou vídeo: `!image`, `!gif` |
| [`pdf`](pdf.md) | Imagem → PDF e junção de PDFs: `!pdf`, `!mergepdf` |
| [`reminders`](reminders.md) | Lembretes agendados: `!lembrete`, `!lembretes`, `!cancelarlembrete`. Oferece o serviço `reminders` e o ponto `reminders.parsers` |
| [`user-names`](user-names.md) | Apelidos e nome de exibição: `!nick`, serviço `userNames` |
| [`download`](download.md) | Vídeo, foto, áudio e figurinha de links pelo yt-dlp: `!download`, `!audio`, `!downloadsticker` |
| [`rank`](rank.md) | Ranking de interações: `!rank`, serviço `rank` |
| [`utils`](utils.md) | `!meunumero`/`!meuid` (número e ID do chat) e `!prefixo` (prefixo por chat, só admin). Ponto de extensão `utils.info` |

Cada plugin (menos `pairing`, `ping`, `ai`, `ai-metrics`, `spontaneous` e `sticker-text`) também contribui tools que a IA pode
chamar por function calling: ver [ai-tools.md](ai-tools.md).

Um plugin pode estender outro ou usá-lo pelos serviços do kernel (`ctx.services`), sem importar
o código dele ([ADR 0001](../../../docs/adr/0001-plugins-compostos-por-servico.md)); o exemplo é
o `sticker`, em [sticker.md](sticker.md#serviço-sticker).

Os testes sobem cada plugin num bot de verdade sobre o transport falso do
[`@usebridger/testing`](https://github.com/murillous/usebridger/blob/develop/packages/testing/docs/README.md).
