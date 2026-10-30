# Dashboard da Luma

SPA (Vite, React, TypeScript, Tailwind v4) que fala com a API HTTP do Bridger. Não é plugin: o bot
não serve o build. Regras visuais e telas em [`DESIGN.md`](./DESIGN.md).

## Rodar

Com o bot rodando (`pnpm dev` na raiz; a API HTTP vem ligada, na porta 3000, salvo `LUMABOT_DASHBOARD_PORT`):

```sh
pnpm --filter @lumabot/dashboard dev      # http://localhost:5173
```

O Vite repassa ao bot `/api`, `/openapi.json` e `/plugins/dashboard` (o painel genérico, usado
por Conexão, Usuários e Chaves de API até o dashboard cobri-los). Assim o app e a API ficam na
mesma origem: o cookie de sessão do core é `Secure; SameSite=Strict` e não há CORS configurado,
então a API só aceita o app sob a mesma origem. O Host não é reescrito (`changeOrigin` fica
desligado) porque o core não o confere.

O bot em outro endereço que `http://127.0.0.1:3000`: defina `LUMA_BOT_URL` (no ambiente ou num
`dashboard/.env`).

No primeiro acesso, o token de bootstrap está em `bootstrap-token`, ao lado do banco do bot.

## Build

```sh
pnpm --filter @lumabot/dashboard build    # dashboard/dist
pnpm --filter @lumabot/dashboard preview  # serve o build, com o mesmo proxy
```

## API tipada

`openapi.json` e `src/lib/api-types.d.ts` são versionados. Rode ao mudar rota de plugin
do app ou ao atualizar o Bridger:

```sh
pnpm --filter @lumabot/dashboard gen:api
```

A spec sai do core mais os plugins de `src/api-plugins.ts` (os do app que registram rotas;
plugin novo com `ctx.http.api` entra nessa lista). Um teste falha se os tipos não batem com a
spec.

## Estrutura

- `src/routes.ts`: tabela única de telas e menu, com a permissão de cada uma.
- `src/pages/`: uma tela por arquivo. Todo título de tela é `<PageTitle>`: o Shell leva o foco
  até ele quando a rota troca.
- `src/components/`: base reutilizável (`ui.tsx`), layout (`Shell.tsx`) e contextos (sessão e
  stream de eventos único, `useLiveEvent`).
- Guarda de saída: tela com alteração pendente chama `useLeaveGuard(dirty, mensagem)`
  (`lib/router.tsx`). Link, `navigate`, voltar do browser, "Sair" e `beforeunload` pedem
  confirmação; mudar só a query (filtro) não conta. `confirmLeave()` serve a ações próprias que
  deixam a tela.
- Foco: o Shell leva o foco ao `<PageTitle>` e troca o `document.title` só quando a *tela* muda
  (outra entrada de `routes.ts`); `/plugins/a` para `/plugins/b` é a mesma tela e não refoca.
- `src/tokens.css`: único lugar com cor literal.
