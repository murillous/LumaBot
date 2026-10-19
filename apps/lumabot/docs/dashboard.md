# Dashboard

Painel web do [`@usebridger/plugin-dashboard`](https://github.com/murillous/usebridger/blob/develop/packages/plugin-dashboard/docs/README.md):
status da conexão, QR e código de pareamento, logs ao vivo, enable/disable/reload de plugins,
config dos plugins e as métricas do `metrics` (as do kernel e as `ai.*` do
[`ai-metrics`](ai-metrics.md), na seção "Todas as métricas registradas"). O app só compõe o
plugin em `src/main.ts`; telas, rotas e segurança são do Bridger.

## Ligar

Ligado por padrão, sem nenhuma variável:

```sh
pnpm --filter lumabot start
```

No primeiro boot, o terminal mostra `http://127.0.0.1:3000/plugins/dashboard/` e o token. Nos
seguintes, só a URL e o caminho do token: o valor sai uma vez, fora do log, como o QR.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `LUMABOT_DASHBOARD_PORT` | `3000` | Porta do HTTP do core (1 a 65535). `off` desliga o dashboard |
| `LUMABOT_DASHBOARD_HOST` | `127.0.0.1` | Interface de escuta. `0.0.0.0` expõe a porta para fora da máquina |
| `BRIDGER_DASHBOARD__TOKEN` | gerado | Token de acesso (segredo, mascarado no log e na tela Config). Definido, vence o arquivo |
| `BRIDGER_SECRET_KEY` | gerada | Chave mestra que cifra os segredos salvos pela tela Config ([core](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md#segredos-cifrados-no-storage)). Definida, vence o arquivo |

Os outros campos do plugin (`logBufferSize`, `cookieMaxAgeSec`) seguem o padrão
`BRIDGER_DASHBOARD__<CAMPO>`.

## Token e chave mestra gerados

Sem as duas variáveis, o app gera os valores e os grava, com permissão 0600, na pasta do banco
(`LUMABOT_DB`): `data/dashboard-token` e `data/secret.key` ([ADR 0006](../../../docs/adr/0006-config-pelo-dashboard-com-segredos-gerados.md)).
Com a chave, a tela Config grava as chaves da IA e do Tavily cifradas no banco.

- **Trocar o token:** apague `data/dashboard-token` e reinicie; o novo aparece no terminal.
- **Não apague nem troque o `secret.key`** com segredos salvos: o boot falha com `undecryptable`.
  Para trocar a chave, siga a rotação do core com `BRIDGER_SECRET_KEY` e
  `BRIDGER_SECRET_KEY_PREVIOUS`.
- **Backup:** quem tem o banco e o `secret.key` tem os segredos. Um backup da pasta `data/`
  inteira leva os dois; guarde-o como guardaria o `.env`.

## Exposição

O padrão é o loopback porque o core não faz TLS nem limita tentativas de login. Para acessar de
fora, ponha um proxy HTTPS (nginx, Caddy) na frente, repassando `Host` e `X-Forwarded-Proto`,
e só então troque o `LUMABOT_DASHBOARD_HOST` (ou deixe o proxy na mesma máquina, no loopback).
O token dá acesso aos logs e ao controle dos plugins: trate-o como senha de admin.

## Admin

O `dashboard` entra em `adminPlugins`: as telas Plugins e Config podem desligar, recarregar e
reconfigurar qualquer plugin do app. O override de config gravado pelo painel vale até alguém
removê-lo pela própria tela. A sessão de login fica em memória e cai no restart.
