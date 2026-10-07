# ADR 0034 — ZapForge é uma biblioteca, sem runner

**Status:** Aceito (2026-10-07)

## Contexto

O esboço do plano (§6.1) mostrava um arquivo `zapforge.config.ts` exportando
`defineConfig({...})`, o formato típico de um framework com runner (`zapforge start`) que
descobre e carrega a config. O M1 entregou só `createBot(config)`, e o `defineConfig` ficou
pendente sem ninguém que o consumisse: sem runner, ele é uma função identidade.

A pergunta de fundo é quem usa o ZapForge e o que essa pessoa precisa conhecer. O público
principal escreve **plugins**: implementa os comandos e listeners que quer e não deveria
precisar entender filas, pipeline, host de plugins ou scheduler. Quem monta o app escreve um
arquivo curto, uma vez. Quem escreve transport ou storage é um terceiro público, menor.

Hoje o `index.ts` do core exporta tudo para todos: além da API de plugin e do `createBot`, saem
`createPluginHost`, `createEventBus`, `InboundQueue`, `sortPlugins`, `normalizeWhere` e outros
internos. Depois da 1.0, tudo o que é exportado fica preso ao ciclo de depreciação (ADR 0027).

Alternativas consideradas: runner/CLI na v1, com `defineConfig` e descoberta do arquivo de
config; manter um único ponto de entrada com tudo exportado e marcar internos com `@internal`.

## Decisão

- **O ZapForge é uma biblioteca.** O app importa `@zapforge/core`, monta o bot com
  `createBot({ transport, storage, plugins, ... })` e chama `start()`. Não há runner, CLI de
  execução, arquivo de config descoberto por convenção nem `defineConfig`. O `apps/lumabot` é
  um exemplo dessa composição, não um molde obrigatório.
- **A API pública se organiza por público:**
  - `@zapforge/core` — o que o autor de plugin usa (`definePlugin`, `command`, `secret`, os
    tipos dos contextos, os erros que ele trata) e o pouco que o app usa para compor
    (`createBot` e sua config, middlewares oficiais, `createLogger`);
  - `@zapforge/core/adapter` — o que autores de transport e storage usam (contratos
    `Transport`/`StoragePort`, `TypedEmitter`, `createMessage`, `createMedia`,
    `ReconnectionPolicy`, normalização de consultas);
  - `@zapforge/core/storage-contract` — a suíte de contrato, como hoje.
  - Peças internas (host de plugins, barramento, filas, scheduler, ordenação, semver) deixam de
    ser exportadas.
- Um runner pode surgir depois como pacote separado, construído sobre esta API pública, sem
  mudar o core.

## Consequências

- O autor de plugin vê no autocomplete só o que lhe serve; o kit de testes (ADR 0022) completa
  o que ele precisa sem expor o kernel.
- O §6.1 do plano passa a mostrar `createBot`; o `defineConfig` sai do roadmap.
- Divisão do `index.ts` é breaking change, barata agora (`0.x`, sem consumidores externos) e
  cara depois da 1.0.
- Testes e pacotes do monorepo que usam internos passam a importá-los pelo caminho interno
  (`#...`) dentro do core, ou pela API de adapter nos pacotes de transport/storage.
- O app continua responsável pelo processo (sinais, `stop()` no SIGTERM, variáveis de ambiente);
  a documentação mostra o padrão.
