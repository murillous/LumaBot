# Contribuindo com o ZapForge

Obrigado pelo interesse! O ZapForge é um kernel de bot de mensageria extensível por plugins,
extraído do LumaBot. Antes de começar, vale ler:

- [`ZAPFORGE_PLAN.md`](ZAPFORGE_PLAN.md) — visão, arquitetura e roadmap;
- [`docs/adr/`](docs/adr/README.md) — o porquê de cada decisão (D01–D31);
- [`README.md`](README.md) — setup, comandos e convenções de pacote.

Ao participar, você concorda com o [Código de Conduta](CODE_OF_CONDUCT.md).

## Antes de codar

- **Bug**: abra uma issue com o template de bug, com passos para reproduzir.
- **Feature ou mudança de API**: abra uma issue primeiro e espere o alinhamento. O escopo do
  core é fechado ([ADR 0013](docs/adr/0013-escopo-do-core.md)) — muita coisa cabe melhor num
  plugin.
- **Decisão arquitetural**: proponha um ADR novo em `docs/adr/`. ADR aceito não é reescrito; a
  mudança vira um ADR que o substitui ([formato](docs/adr/README.md)).
- Issues com `good first issue` são um bom ponto de partida.

## Fluxo

1. Faça fork e crie uma branch a partir de **`develop`** (ex.: `m1-2-router`, `fix-quoted-media`).
2. Commits em [Conventional Commits](https://www.conventionalcommits.org/pt-br/), descrição em
   PT-BR e o ID da issue do roadmap quando houver: `feat(core): roteador de comandos (M1-2.1)`.
3. Abra o PR contra **`develop`** — nunca contra `main`, que alimenta a produção do legacy.
   Referencie a issue (`Closes #123`) e preencha o checklist do template.

## Definição de pronto

Todo PR precisa:

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` verdes (o CI roda os mesmos);
- [ ] testes novos para o comportamento novo — **nenhum teste existente apagado ou reescrito**
      sem autorização do mantenedor;
- [ ] docs do COMO atualizadas (`docs/` do pacote ou `docs/` da raiz);
- [ ] ADR quando houver decisão arquitetural;
- [ ] changeset (`pnpm changeset`) se mudou um pacote publicável — ver
      [`.changeset/README.md`](.changeset/README.md);
- [ ] sem regressão de benchmark > 10% (a partir do M2).

## Convenções de código

Codificadas no Biome e verificadas no CI (detalhes no [README](README.md#regras-do-biome)):

- TypeScript, ESM, **named exports apenas**;
- imports entre pacotes pelo nome (`@zapforge/*`); dentro do pacote, nada de `../` — use o
  alias `#` do próprio pacote;
- nunca engolir erros: trate, relance ou registre;
- nenhum `process.env` fora da camada de config;
- comentários em PT-BR explicando o **porquê**, não o óbvio.

A menor solução que resolve é a melhor: sem abstração ou configuração que a tarefa não exige.

## `legacy/`

O LumaBot atual vive em `legacy/`, em produção até a paridade, com ferramentas próprias (npm,
`npx vitest run`) rodadas a partir de `legacy/`. Leia [`legacy/CLAUDE.md`](legacy/CLAUDE.md)
antes de mexer nele.

## Licença

Contribuições ao monorepo entram sob [Apache-2.0](LICENSE), a mesma licença do projeto; as
feitas em `legacy/` seguem [MIT](legacy/LICENSE). Não há CLA.
