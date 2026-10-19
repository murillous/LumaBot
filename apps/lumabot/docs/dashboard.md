# Dashboard

Painel web do [`@usebridger/plugin-dashboard`](https://github.com/murillous/usebridger/blob/develop/packages/plugin-dashboard/docs/README.md):
status da conexão, QR e código de pareamento, logs ao vivo, enable/disable/reload de plugins,
config dos plugins e as métricas do `metrics` (as do kernel e as `ai.*` do
[`ai-metrics`](ai-metrics.md), na seção "Todas as métricas registradas"). O app só compõe o
plugin em `src/main.ts`; telas, rotas e segurança são do Bridger.

## Ligar

Desligado por padrão: sem `LUMABOT_DASHBOARD_PORT`, o app não abre porta nem carrega o plugin.

```sh
LUMABOT_DASHBOARD_PORT=3000
BRIDGER_DASHBOARD__TOKEN=<segredo aleatório, 16+ caracteres>
pnpm --filter lumabot start
```

Abra `http://127.0.0.1:3000/plugins/dashboard/` e entre com o token. Com a porta e sem o token
(ou com token curto), a config do plugin é inválida e o boot para com o campo na mensagem.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `LUMABOT_DASHBOARD_PORT` | — | Porta do HTTP do core (1 a 65535). Liga o dashboard |
| `LUMABOT_DASHBOARD_HOST` | `127.0.0.1` | Interface de escuta. `0.0.0.0` expõe a porta para fora da máquina |
| `BRIDGER_DASHBOARD__TOKEN` | — | Token de acesso (segredo, mascarado no log e na tela Config) |

Os outros campos do plugin (`logBufferSize`, `cookieMaxAgeSec`) seguem o padrão
`BRIDGER_DASHBOARD__<CAMPO>`.

## Exposição

O padrão é o loopback porque o core não faz TLS nem limita tentativas de login. Para acessar de
fora, ponha um proxy HTTPS (nginx, Caddy) na frente, repassando `Host` e `X-Forwarded-Proto`,
e só então troque o `LUMABOT_DASHBOARD_HOST` (ou deixe o proxy na mesma máquina, no loopback).
O token dá acesso aos logs e ao controle dos plugins: trate-o como senha de admin.

## Admin

O `dashboard` entra em `adminPlugins`: as telas Plugins e Config podem desligar, recarregar e
reconfigurar qualquer plugin do app. O override de config gravado pelo painel vale até alguém
removê-lo pela própria tela. A sessão de login fica em memória e cai no restart.
