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

Os plugins `media` e `download` rodam o `ffmpeg` do sistema, e o `download`, também o `yt-dlp`:
instale os dois e deixe-os no `PATH` (ver [media.md](media.md#ffmpeg) e
[download.md](download.md#binários)).

Para desenvolver sem build, `pnpm --filter lumabot dev` executa o `.ts` direto (type stripping
do Node).

No primeiro uso o terminal mostra o QR: no celular, *Aparelhos conectados → Conectar aparelho*.
Depois do pareamento o servidor pede um restart e o bot reconecta sozinho. Mande `!ping` de outro
número e o bot responde `pong`, citando a mensagem. Do próprio número não funciona: o middleware
`ignore-self` barra as mensagens da sessão.

`Ctrl+C` (ou `SIGTERM`) encerra pelo `bot.stop()`, que drena as filas e fecha o banco. Um segundo
sinal mata o processo, para o caso de o encerramento travar.

## Config

Por variáveis de ambiente, lidas em `src/config.ts`. Variável vazia vale como ausente.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `LUMABOT_DB` | `data/lumabot.sqlite` | Arquivo do banco, relativo ao diretório de onde o processo roda. Guarda as credenciais do WhatsApp: apagar o arquivo (e os `-wal`/`-shm`) obriga a parear de novo |
| `LUMABOT_PAIRING_PHONE` | — | Número com DDI, só dígitos (`5511999999999`). Com ele, o bot pede um código de pareamento em vez do QR: digite-o em *Aparelhos conectados → Conectar com número de telefone* |
| `LUMABOT_YTDLP_COOKIES` | — | Arquivo de cookies (formato Netscape) que o plugin `download` repassa ao yt-dlp ([download.md](download.md#config)) |
| `LUMABOT_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` ou `silent` |

A config dos plugins segue o padrão do core (`BRIDGER_<PLUGIN>__<CAMPO>`,
[Config](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md)).

Valor inválido derruba o boot com a variável na mensagem. O log sai em JSON, uma linha por evento;
o QR e o código de pareamento saem fora dele, direto no stdout.

## Plugins do app

Ficam em `src/plugins/` e entram na lista do `createBot` em `src/main.ts`.

| Plugin | O que faz |
| --- | --- |
| `pairing` | Desenha no terminal o QR (`connection.qr`) ou mostra o código (`connection.pairing-code`). O log do bot só avisa que chegou um QR, sem o valor |
| `ping` | `!ping` responde `pong`: prova o caminho transport → kernel → fila de saída → transport |
| [`media`](media.md) | Figurinha, imagem, GIF e PDF: `!sticker`, `!image`, `!gif`, `!pdf`, `!mergepdf` |
| [`download`](download.md) | Vídeo, foto e áudio de links pelo yt-dlp: `!download`, `!audio` |

Os testes sobem cada plugin num bot de verdade sobre o transport falso do
[`@usebridger/testing`](https://github.com/murillous/usebridger/blob/develop/packages/testing/docs/README.md).
