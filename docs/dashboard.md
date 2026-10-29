# Dashboard

Painel web do [`@usebridger/plugin-dashboard`](https://github.com/murillous/usebridger/blob/develop/packages/plugin-dashboard/docs/README.md),
cliente da API HTTP do core: conexão com QR e código de pareamento, logs (histórico e ao vivo),
plugins, config, métricas do `metrics` (as do kernel e as `ai_*` do [`ai-metrics`](ai-metrics.md)),
auditoria, usuários e API keys. O app só compõe o plugin e liga a `api.auth` em `src/main.ts`;
telas, rotas, login e permissões são do Bridger.

## Ligar

Ligado por padrão, sem nenhuma variável:

```sh
pnpm start
```

No primeiro boot, o terminal mostra `http://127.0.0.1:3000/plugins/dashboard/` e o token do
primeiro acesso. Nos seguintes, só a URL e o caminho do token: o valor sai uma vez, fora do log,
como o QR.

## Primeiro acesso e login

O acesso é por e-mail e senha, com papéis (`owner`, `admin`, `viewer`). Sem nenhum usuário, a tela
de aceite de convite recebe o token do primeiro acesso (`data/bootstrap-token`) e cria o primeiro
`owner`. Com ele criado, o token não vale mais; os outros usuários entram por convite, criado na
tela Usuários.

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `LUMABOT_DASHBOARD_PORT` | `3000` | Porta do HTTP do core (1 a 65535). `off` desliga o dashboard |
| `LUMABOT_DASHBOARD_HOST` | `127.0.0.1` | Interface de escuta. `0.0.0.0` expõe a porta para fora da máquina |
| `BRIDGER_SECRET_KEY` | gerada | Chave mestra que cifra os segredos salvos pela tela Config ([core](https://github.com/murillous/usebridger/blob/develop/packages/core/docs/config.md#segredos-cifrados-no-storage)). Definida, vence o arquivo |

O plugin não tem config própria: um `BRIDGER_DASHBOARD__TOKEN` que sobrou de versão anterior
impede o boot (`o plugin não declara config`). Apague a variável.

## Token e chave mestra gerados

O app gera os dois e os grava, com permissão 0600, na pasta do banco (`LUMABOT_DB`):
`data/bootstrap-token` e `data/secret.key` (a chave só sem `BRIDGER_SECRET_KEY`;).
Com a chave, a tela Config grava as chaves da IA e do Tavily cifradas no banco. O
`data/dashboard-token` de versões anteriores não é mais lido e pode ser apagado.

- **Perdeu a senha do único owner:** `bridger owner-invite` do core gera um convite novo.
- **Não apague nem troque o `secret.key`** com segredos salvos: o boot falha com `undecryptable`.
  Para trocar a chave, siga a rotação do core com `BRIDGER_SECRET_KEY` e
  `BRIDGER_SECRET_KEY_PREVIOUS`.
- **Backup:** quem tem o banco e o `secret.key` tem os segredos. Um backup da pasta `data/`
  inteira leva os dois; guarde-o como guardaria o `.env`.

## Exposição

O padrão é o loopback porque o core não faz TLS: o cookie de sessão sai `Secure` e a senha
trafega no corpo do login. Para acessar de fora, ponha um proxy HTTPS (nginx, Caddy) na frente,
repassando `Host` e `X-Forwarded-Proto`, e só então troque o `LUMABOT_DASHBOARD_HOST` (ou deixe o
proxy na mesma máquina, no loopback). Um `owner` ou `admin` desliga, recarrega e reconfigura
qualquer plugin: o override de config gravado pelo painel vale até alguém removê-lo pela tela.
