# LumaBot

[![CI](https://github.com/murillous/LumaBot/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/murillous/LumaBot/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=nodedotjs&logoColor=white)](.nvmrc)
[![pnpm](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![Bridger](https://img.shields.io/npm/v/@usebridger/core?label=bridger&color=6E56CF)](https://github.com/murillous/usebridger)
[![Licença](https://img.shields.io/github/license/murillous/LumaBot)](LICENSE)

Bot de WhatsApp com a **Luma**, assistente virtual com personalidade: conversa por IA (Gemini,
OpenAI, Claude, DeepSeek), faz figurinhas, transcreve áudio, resume a conversa, agenda lembretes e
baixa vídeos de links.

O LumaBot é escrito sobre o [Bridger](https://github.com/murillous/usebridger) (`@usebridger/*` no
npm). Este repositório só compõe o bot: transport
([Baileys](https://github.com/murillous/usebridger/blob/develop/packages/transport-baileys/docs/README.md)),
storage ([SQLite](https://github.com/murillous/usebridger/blob/develop/packages/storage-sqlite/docs/README.md))
e os plugins da Luma, e cuida do processo (sinais, código de saída). O kernel, os plugins oficiais
e o roadmap vivem no `usebridger`: bug ou feature do Bridger vai para lá.

## Sumário

- [O que ela faz](#o-que-ela-faz)
- [Requisitos](#requisitos)
- [Rodar](#rodar)
- [Dashboard](#dashboard)
- [Config](#config)
- [Plugins](#plugins)
- [Desenvolvimento](#desenvolvimento)

## O que ela faz

| Comando | O que faz |
| --- | --- |
| Conversa | Responde em PV e, nos grupos, quando citada, chamada ou mencionada. Troca de persona com `!persona` |
| `!sticker` (`!s`) | Figurinha de imagem, vídeo, GIF ou link, com legenda opcional |
| `!image` / `!gif` | Figurinha de volta a imagem ou vídeo |
| `!transcribe` (`!t`) | Transcreve o áudio |
| `!resumo [n]` | Resume as últimas mensagens do chat |
| `!lembrete` | Agenda um lembrete, único ou recorrente |
| `!download` / `!audio` | Vídeo, foto ou áudio de um link (yt-dlp) |
| `!pdf` / `!mergepdf` | Imagem para PDF e junção de PDFs |
| `!rank` | Ranking de interações do grupo |
| `!help` | Menu com todos os comandos |

Boa parte disso também está ao alcance da IA: pedir "faz uma figurinha disso" na conversa funciona
([ai-tools.md](docs/ai-tools.md)).

## Requisitos

| O quê | Para quê |
| --- | --- |
| [Node](https://nodejs.org) 24+ (`.nvmrc`) | Roda o bot |
| [pnpm](https://pnpm.io) (versão em `packageManager`) | Dependências. Com `corepack enable`, o `pnpm install` baixa a versão certa |
| [FFmpeg](https://ffmpeg.org) com `libwebp`, no `PATH` | Figurinha de vídeo (`sticker`), `!gif` (`sticker-convert`) e `!download`. Sem ele, só esses recursos falham |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp), no `PATH` | `!download`, `!audio` e `!downloadsticker` ([download.md](docs/download.md#binários)) |
| Chave de um provedor de IA | Gemini, OpenAI, Anthropic ou DeepSeek. Sem uma cadeia `models`, a IA recusa responder; o resto funciona |

No Debian/Ubuntu, de uma vez:

```sh
sudo apt install ffmpeg yt-dlp
```

A fonte do emoji colorido na legenda das figurinhas vem no repositório (`fonts/`), em qualquer SO,
inclusive no Windows ([sticker.md](docs/sticker.md#legenda-sticker-text)). Rode o bot da raiz do
repositório, que é onde ele procura a fonte e o banco.

## Rodar

```sh
corepack enable
pnpm install
pnpm build
pnpm start   # roda dist/main.mjs
```

Nenhuma variável é obrigatória. No primeiro boot, o terminal mostra:

1. **O QR do WhatsApp.** No celular: *Aparelhos conectados → Conectar aparelho*. Depois do
   pareamento o servidor pede um restart e o bot reconecta sozinho. Prefere código a QR? Defina
   `LUMABOT_PAIRING_PHONE` ([Config](#config)).
2. **A URL do [dashboard](#dashboard)** e o caminho do token do primeiro acesso. Entre por ali e
   configure a IA na tela Config.

Para testar, mande `!ping` de **outro** número: o bot responde `pong`, citando a mensagem. Do
próprio número não funciona, porque o middleware `ignore-self` barra as mensagens da sessão.

`Ctrl+C` (ou `SIGTERM`) encerra pelo `bot.stop()`, que drena as filas e fecha o banco. Um segundo
sinal mata o processo, para o caso de o encerramento travar.

Quando a reconexão desiste (outro processo assumiu o número, `replaced`, ou erro de configuração,
`fatal`), o core loga o motivo e o plugin `give-up` faz o `bot.ts` encerrar com código de saída 1:
o supervisor (systemd, pm2) vê a falha. Queda de rede e sessão deslogada não entram aqui: o bot
reconecta ou pede novo pareamento.

## Dashboard

Painel web do
[`@usebridger/plugin-dashboard`](https://github.com/murillous/usebridger/blob/develop/packages/plugin-dashboard/docs/README.md),
ligado por padrão em `http://127.0.0.1:3000/plugins/dashboard/`. O painel é genérico do Bridger
(telas, rotas, login e permissões vêm de lá); o app só o compõe em `src/bot.ts`. Ele mostra:

- **Conexão:** QR e código de pareamento.
- **Config:** os campos de cada plugin (modelos e chaves da IA, Luma, busca, estilo da legenda...),
  editáveis sem reiniciar. As chaves são gravadas cifradas no banco.
- **Logs** (histórico e ao vivo), **plugins** (ligar, desligar, recarregar) e **auditoria**.
- **Métricas** do `metrics`: as do kernel, as `ai_*` de consumo e custo da IA
  ([ai-metrics.md](docs/ai-metrics.md)) e as `luma_*` dos plugins
  ([logs-e-metricas.md](docs/logs-e-metricas.md)).
- **Usuários e API keys.**

### Primeiro acesso

O acesso é por e-mail e senha, com papéis (`owner`, `admin`, `viewer`). Sem nenhum usuário, a tela
de aceite de convite recebe o token do primeiro acesso (`data/bootstrap-token`) e cria o primeiro
`owner`. Depois disso o token não vale mais; os outros usuários entram por convite, criado na tela
Usuários. Perdeu a senha do único owner? `bridger owner-invite` do core gera um convite novo.

O app gera, com permissão 0600 na pasta do banco, o `data/bootstrap-token` e o `data/secret.key`
(a chave mestra que cifra os segredos da tela Config; só sem `BRIDGER_SECRET_KEY`).

- **Não apague nem troque o `secret.key`** com segredos salvos: o boot falha com `undecryptable`.
  Para trocar a chave, siga a
  [rotação do core](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md#segredos-cifrados-no-storage)
  com `BRIDGER_SECRET_KEY` e `BRIDGER_SECRET_KEY_PREVIOUS`.
- **Backup:** quem tem o banco e o `secret.key` tem os segredos. Guarde um backup da pasta `data/`
  como guardaria o `.env`.

### Auditoria

O log de auditoria do kernel (tela **Auditoria**) guarda **1 ano** (`AUDIT_RETENTION_DAYS` em
`src/config.ts`, repassado como `audit.retentionDays`; o padrão do core é 5 anos). Além do que o
kernel já audita (plugins, config, segredos, login), a Luma registra:

- `command.owner`: toda execução de comando `role: 'owner'` (plugin `command` em `src/owner-audit.ts`),
  sem os argumentos; recusa vira `denied`.
- `luma.persona.set|create|delete` e `luma.history.clear` ([luma.md](docs/luma.md#auditoria)).
- `reminders.delete`, só quando quem cancela não é o dono ([reminders.md](docs/reminders.md#auditoria)).
- `pairing.session.paired` (conectou depois de QR ou código) e `pairing.session.lost`
  (`logged-out` ou `auth-failed`).

Contatos (`sender`, `contact`, `actor`, `creator`) e o id de chat privado (`target.id`,
`details.chat`, que é o número do contato) vão pseudonimizados com `ctx.pseudonym`, nunca o
JID cru; id de grupo fica cru (não identifica pessoa); quem tem a permissão `pseudonyms.resolve` desfaz pelo dashboard ou pela API. Em
`command.owner`, `details.status` traz o status cru (`ran`, `rejected`, `failed`; `rejected`
cobre também recusa por `accepts`).

Mensagem comum e resposta da IA não são auditadas.

### Exposição

O padrão é o loopback porque o core não faz TLS: o cookie de sessão sai `Secure` e a senha trafega
no corpo do login. Para acessar de fora, ponha um proxy HTTPS (nginx, Caddy) na frente, repassando
`Host` e `X-Forwarded-Proto`, e só então troque o `LUMABOT_DASHBOARD_HOST` (ou deixe o proxy na
mesma máquina, no loopback). Um `owner` ou `admin` desliga, recarrega e reconfigura qualquer
plugin: o override gravado pelo painel vale até alguém removê-lo pela tela.

## Config

Há dois tipos de config:

- **Do app:** as variáveis `LUMABOT_*` abaixo, lidas em `src/config.ts`. Só mudam os padrões.
- **Dos plugins:** pela tela Config do dashboard ou por variável no padrão do core,
  `BRIDGER_<PLUGIN>__<CAMPO>`
  ([Config do core](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md)).
  A variável vence o dashboard, que passa a mostrar o campo como `env`, sem edição. Os campos de
  cada plugin estão na doc dele ([Plugins](#plugins)).

O `start` e o `dev` carregam o `.env` da raiz, se existir (`--env-file-if-exists` do Node), e o
`.env.example` traz as variáveis comentadas. Variável já definida no ambiente vence a do arquivo;
variável vazia vale como ausente. O `.env` fica fora do Git.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `LUMABOT_DB` | `data/lumabot.sqlite` | Arquivo do banco, relativo ao diretório de onde o processo roda. Guarda as credenciais do WhatsApp: apagar o arquivo (e os `-wal`/`-shm`) obriga a parear de novo |
| `LUMABOT_PAIRING_PHONE` | — | Número com DDI, só dígitos (`5511999999999`). Com ele, o bot pede um código de pareamento em vez do QR: digite-o em *Aparelhos conectados → Conectar com número de telefone* |
| `LUMABOT_YTDLP_COOKIES` | — | Arquivo de cookies (formato Netscape) que o `download` repassa ao yt-dlp ([download.md](docs/download.md#config)) |
| `LUMABOT_LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` ou `silent` |
| `LUMABOT_DASHBOARD_PORT` | `3000` | Porta do HTTP do core (1 a 65535). `off` desliga o dashboard e o HTTP |
| `LUMABOT_DASHBOARD_HOST` | `127.0.0.1` | Interface de escuta. `0.0.0.0` expõe a porta para fora da máquina ([Exposição](#exposição)) |
| `BRIDGER_SECRET_KEY` | gerada | Chave mestra dos segredos salvos pela tela Config. Definida, vence o `data/secret.key` |

Valor inválido, do app ou de plugin (ex.: `BRIDGER_STICKER_TEXT__COLOR=vermelho`), impede o boot
com a variável na mensagem. Um `BRIDGER_DASHBOARD__TOKEN` que sobrou de versão anterior também
impede (`o plugin não declara config`): apague a variável.

No terminal, o log sai legível (`14:03:22 INFO  [sticker] mensagem chave=valor`, com cor); com o
stdout redirecionado (serviço, arquivo, agregador), em JSON, uma linha por evento. O Baileys só
escreve a partir de `warn`. O QR, o código de pareamento e o token saem fora do log, direto no
stdout.

## Plugins

Ficam em `src/plugins/` e entram na lista do `createBot` em `src/bot.ts`. Dos oficiais do Bridger,
o app carrega o `metrics` e, salvo `LUMABOT_DASHBOARD_PORT=off`, o `dashboard`.

| Plugin | O que faz |
| --- | --- |
| `pairing` | Desenha no terminal o QR ou mostra o código de pareamento. O log só avisa que chegou um QR, sem o valor |
| `ping` | `!ping` responde `pong`: prova o caminho transport → kernel → fila de saída → transport |
| [`ai`](docs/ai.md) | Cadeia de modelos (Gemini, OpenAI, Claude, DeepSeek) com fallback, tool calling e busca nativa. Oferece o serviço `ai` e os pontos `ai.providers` e `ai.observers` |
| [`ai-metrics`](docs/ai-metrics.md) | Consumo, vazão e custo por modelo, pelo serviço `metrics`. Oferece o serviço `aiMetrics` |
| [`luma`](docs/luma.md) | A personagem: responde em PV, quando citada, chamada ou mencionada; histórico, personas e `!persona`, `!luma clear`/`stats`. Oferece o serviço `luma` |
| [`spontaneous`](docs/spontaneous.md) | Reação com emoji às mensagens dos grupos, decidida pela IA |
| [`resumo`](docs/resumo.md) | Resumo da conversa: `!resumo [n]`. Oferece o serviço `resumo` |
| [`transcribe`](docs/transcribe.md) | Transcrição de áudio: `!transcribe` (`!t`). Oferece o serviço `transcription` |
| [`web-search`](docs/web-search.md) | Busca na internet (Tavily, com Google Grounding de reserva). Oferece o serviço `webSearch` |
| [`help`](docs/help.md) | Menu de comandos gerado do kernel: `!help`, `!menu`, `!ajuda`. Oferece o serviço `help` e o ponto `help.sections` |
| [`sticker`](docs/sticker.md) | Figurinha de imagem, vídeo ou link: `!sticker`. Oferece o serviço `sticker` |
| [`sticker-text`](docs/sticker.md#legenda-sticker-text) | Texto do `!sticker` como legenda; estende o serviço `sticker` |
| [`sticker-convert`](docs/sticker-convert.md) | Figurinha de volta a imagem ou vídeo: `!image`, `!gif` |
| [`pdf`](docs/pdf.md) | Imagem → PDF e junção de PDFs: `!pdf`, `!mergepdf` |
| [`reminders`](docs/reminders.md) | Lembretes agendados: `!lembrete`, `!lembretes`, `!cancelarlembrete`. Oferece o serviço `reminders` e o ponto `reminders.parsers` |
| [`user-names`](docs/user-names.md) | Apelidos e nome de exibição: `!nick`, serviço `userNames` |
| [`download`](docs/download.md) | Vídeo, foto, áudio e figurinha de links pelo yt-dlp: `!download`, `!audio`, `!downloadsticker` |
| [`rank`](docs/rank.md) | Ranking de interações: `!rank`, serviço `rank` |
| [`utils`](docs/utils.md) | `!meunumero`/`!meuid` (número e ID do chat) e `!prefixo` (prefixo por chat, só admin). Ponto de extensão `utils.info` |

Cada plugin (menos `pairing`, `ping`, `ai`, `ai-metrics`, `spontaneous` e `sticker-text`) também
contribui tools que a IA chama por function calling ([ai-tools.md](docs/ai-tools.md)). Um plugin
estende outro ou o usa pelos serviços do kernel (`ctx.services`), sem importar o código dele; o
exemplo é o `sticker` ([sticker.md](docs/sticker.md#serviço-sticker)).

### Dependências

| Pacote | Para quê |
| --- | --- |
| `@usebridger/core` | Kernel: plugins, comandos, filas, config, serviços, API HTTP |
| `@usebridger/transport-baileys` | Conexão com o WhatsApp (Baileys) |
| `@usebridger/storage-sqlite` | Banco SQLite: credenciais, dados dos plugins, config salva |
| `@usebridger/plugin-dashboard` | O [dashboard](#dashboard) |
| `@usebridger/plugin-metrics` | Métricas do kernel e da IA, agregação diária e `GET /metrics` (Prometheus) |
| `ai` e `@ai-sdk/*` | AI SDK: os provedores Google, OpenAI, Anthropic e DeepSeek |
| `sharp` | Imagem da figurinha e a legenda (Pango) |
| `node-webpmux` | EXIF do WebP: nome e autor do pacote da figurinha |
| `pdf-lib` | `!pdf` e `!mergepdf` |
| `qrcode-terminal` | O QR no terminal |
| `zod` | Schema da config dos plugins e dos argumentos das tools |

## Desenvolvimento

| Comando | O que faz |
| --- | --- |
| `pnpm dev` | Roda o `.ts` direto, sem build (type stripping do Node) |
| `pnpm build` / `pnpm start` | `tsdown` para `dist/` e roda o build |
| `pnpm lint` / `pnpm lint:fix` | Biome: lint, formatação e organização de imports |
| `pnpm typecheck` | `tsc`, só checagem de tipos |
| `pnpm test` | Vitest |

Os testes sobem cada plugin num bot de verdade sobre o transport falso do
[`@usebridger/testing`](https://github.com/murillous/usebridger/blob/develop/packages/testing/docs/README.md).
Os de figurinha rodam o FFmpeg, então pedem os mesmos [requisitos](#requisitos) do bot. O CI ([`ci.yml`](.github/workflows/ci.yml)) roda lint,
typecheck, testes e build em todo push e PR para `main`/`develop`.

### Convenções

- TypeScript strict e ESM. Em dev o Node executa o `.ts` direto, então só vale sintaxe apagável
  (sem `enum`, `namespace`, parameter properties) e os imports levam a extensão `.ts`.
- Import relativo só para a mesma pasta ou abaixo; para subir, o alias `#` do `package.json`
  (`import { loadConfig } from '#config.ts'`).
- O Biome barra `export default` (exceto em `*.config.ts`), `../`, `process.env` fora de
  `src/config.ts` e `catch` sem instrução ([`biome/`](biome/no-swallowed-catch.grit)).
- Branch a partir de `develop`, PR para `develop`; a `main` é a versão estável. Commits em
  [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em PT-BR.

## Licença

[Apache-2.0](LICENSE).
