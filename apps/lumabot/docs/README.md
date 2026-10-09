# apps/lumabot — documentação

O LumaBot sobre o kernel ZapForge. O app só compõe o bot: transport
([Baileys](../../../packages/transport-baileys/docs/README.md)), storage
([SQLite](../../../packages/storage-sqlite/docs/README.md)) e a lista de plugins, e cuida do
processo (sinais, código de saída). O kernel é uma biblioteca sem runner
([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)).

> M2-5: app mínimo, com o plugin `ping`. As features do legacy chegam como plugins nos marcos
> seguintes.

## Rodar

Na raiz, depois do `pnpm install`:

```sh
pnpm build
pnpm --filter @zapforge/lumabot start   # roda dist/main.mjs
```

Para desenvolver sem build, `pnpm --filter @zapforge/lumabot dev` executa o `.ts` direto (type
stripping do Node, com a condição `@zapforge/source`).

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
| `LUMABOT_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` ou `silent` |

A config dos plugins segue o padrão do core (`ZAPFORGE_<PLUGIN>__<CAMPO>`,
[Config](../../../packages/core/docs/config.md)).

Valor inválido derruba o boot com a variável na mensagem. O log sai em JSON, uma linha por evento;
o QR e o código de pareamento saem fora dele, direto no stdout.

## Plugins do app

Ficam em `src/plugins/` e entram na lista do `createBot` em `src/main.ts`.

| Plugin | O que faz |
| --- | --- |
| `pairing` | Desenha no terminal o QR (`connection.qr`) ou mostra o código (`connection.pairing-code`). O log do bot só avisa que chegou um QR, sem o valor |
| `ping` | `!ping` responde `pong`: prova o caminho transport → kernel → fila de saída → transport |

Os testes sobem cada plugin num bot de verdade sobre o transport falso do
[`@zapforge/testing`](../../../packages/testing/docs/README.md).
