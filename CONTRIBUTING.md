# Contribuindo com o LumaBot

Obrigado pelo interesse! Antes de começar, vale ler o [`README.md`](README.md) — setup,
comandos e convenções.

Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).

## LumaBot ou Bridger?

O app da Luma usa o [Bridger](https://github.com/murillous/usebridger) (`@usebridger/*`) como
kernel. Bug, feature ou mudança de API do kernel e dos plugins oficiais vai para o
[`usebridger`](https://github.com/murillous/usebridger/issues). Aqui ficam a Luma (o
comportamento do bot, os plugins do app) e o `legacy/`.

## Antes de codar

- **Bug**: abra uma issue com o template de bug, com passos para reproduzir.
- **Feature**: abra uma issue primeiro e espere o alinhamento.
- Issues com `good first issue` são um bom ponto de partida.

## Fluxo

1. Faça fork e crie uma branch a partir de **`develop`** (ex.: `fix-quoted-media`).
2. Commits em [Conventional Commits](https://www.conventionalcommits.org/pt-br/), descrição em
   PT-BR: `feat(lumabot): comando de lembrete`.
3. Abra o PR contra **`develop`** — nunca contra `main`, que alimenta a produção do legacy.
   Referencie a issue (`Closes #123`) e preencha o checklist do template.

## Definição de pronto

Todo PR precisa:

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes (o CI roda os mesmos);
- [ ] testes novos para o comportamento novo — **nenhum teste existente apagado ou reescrito**
      sem autorização do mantenedor;
- [ ] docs do COMO atualizadas (`docs/` do app);
- [ ] ADR em `docs/adr/` quando houver decisão arquitetural.

## Convenções de código

Codificadas no Biome e verificadas no CI (detalhes no [README](README.md#regras-do-biome)):

- TypeScript, ESM, **named exports apenas**;
- dentro do app, nada de `../` — use o alias `#` do próprio app;
- nunca engolir erros: trate, relance ou registre;
- nenhum `process.env` fora da camada de config;
- comentários em PT-BR explicando o **porquê**, não o óbvio.

A menor solução que resolve é a melhor: sem abstração ou configuração que a tarefa não exige.

## `legacy/`

O LumaBot em produção vive em `legacy/`, até a paridade, com ferramentas próprias (npm,
`npx vitest run`) rodadas a partir de `legacy/`. Leia [`legacy/CLAUDE.md`](legacy/CLAUDE.md)
antes de mexer nele.

## Licença

Contribuições em `apps/*` entram sob [Apache-2.0](LICENSE); as feitas em `legacy/` seguem
[MIT](legacy/LICENSE). Não há CLA.
