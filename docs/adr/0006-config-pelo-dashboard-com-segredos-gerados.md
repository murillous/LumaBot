# ADR 0006 — Config pelo dashboard, com token e chave mestra gerados

**Status:** Aceito (2026-10-19)

## Contexto

Para a Luma responder, o `.env` precisava de umas dez variáveis: porta e token do dashboard,
cadeia de modelos e chaves da IA, além dos ajustes de cada plugin. A tela Config do dashboard já
edita a config dos plugins e grava segredos cifrados no storage. Três coisas impediam usá-la com o
`.env` vazio:

- o dashboard só subia com `LUMABOT_DASHBOARD_PORT`;
- o token dele é obrigatório e não pode vir do próprio dashboard;
- sem `BRIDGER_SECRET_KEY`, o core recusa gravar segredos, e as chaves da IA são segredos.

## Decisão

1. **Dashboard ligado por padrão** em `127.0.0.1:3000`. `LUMABOT_DASHBOARD_PORT=off` desliga. O
   host continua no loopback: o core não faz TLS nem limita tentativas de login.
2. **Token e chave mestra gerados no primeiro boot**, quando a variável falta. O `main.ts` grava
   os valores em `dashboard-token` (24 bytes) e `secret.key` (32 bytes), em base64, com permissão
   0600, na pasta do banco. Depois injeta os dois no `env` do `createBot`. Variável definida
   vence o arquivo, então quem já usa `.env` ou um gerenciador de segredos não muda nada.
3. **O token sai no stdout, fora do log**, como o QR, e só no boot que o gera. Nos seguintes, o
   terminal mostra só o caminho do arquivo.
4. **A config dos plugins mora no dashboard.** O `.env.example` passa a listar só as variáveis do
   app. As `BRIDGER_*` seguem valendo e vencem o que o dashboard salvou.

## Consequências

- `pnpm --filter lumabot start` com o `.env` vazio sobe o bot e o dashboard. A cadeia `models`
  e as chaves da IA se configuram pela tela Config, com reload e sem reiniciar o processo.
- A chave mestra fica ao lado do banco, contra a recomendação do core de guardá-la fora dele e do
  backup. Foi uma troca consciente pela simplicidade: um backup da pasta `data/` inteira leva os
  segredos junto. Quem quiser a separação define `BRIDGER_SECRET_KEY` no ambiente.
- Apagar o `secret.key` com segredos salvos faz o boot falhar com `undecryptable`. A troca da
  chave segue a rotação do core (`BRIDGER_SECRET_KEY_PREVIOUS`).
- Um erro de leitura que não seja arquivo ausente (permissão, diretório no lugar) derruba o boot
  em vez de gerar outro valor por cima.
