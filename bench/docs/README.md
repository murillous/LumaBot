# Benchmark — documentação

Mede as metas de performance do [plano §7](../../ZAPFORGE_PLAN.md#7-metas-de-performance)
([ADR 0030](../../docs/adr/0030-metas-de-performance.md)) sobre o `FakeTransport`, sem rede.

## Rodar

Na raiz:

```sh
pnpm bench                              # todos os cenários (~3 min)
pnpm bench --only overhead,boot         # só alguns
pnpm bench --out resultado.json         # grava o resultado em JSON (caminho relativo a bench/)
pnpm bench --baseline base.json         # compara com o --out de outra execução
```

O `pnpm bench` faz o build do workspace e roda `bench/dist/main.mjs`. O benchmark mede o código
compilado, como ele roda em produção: executar o `.ts` direto carrega o type stripping do Node,
que soma ~14 MB de RSS e estoura a meta de memória ociosa sem ter nada a ver com o kernel. Depois
de mudar o core, rode o `pnpm bench` da raiz (que refaz o build), e não o script do pacote.

Cada execução de cenário roda num processo novo: memória e boot dependem de o processo não ter
carregado nada antes. O valor reportado é a mediana das execuções. Se algum cenário fica fora da
meta, o comando sai com código 1.

```
overhead       0.215 ms (meta < 1; execuções: 0.221, 0.215, 0.211) ok
throughput     12693 msg/s (meta ≥ 5000; execuções: 12693, 12883, 12546) ok
idle-memory    73.8 MB (meta < 80; execuções: 73.9, 73.8, 73.7) ok
memory-growth  -0.231 MB (meta < 5; execuções: -0.231) ok
boot           29.6 ms (meta < 500; execuções: 28.5, 25.0, 31.4, 29.6, 39.0) ok
```

## Bot de referência

Todos os cenários usam o mesmo bot (`src/workload.ts`), montado com o `createTestBot`:

- 20 plugins, cada um com config Zod, `messages`, dois comandos e dois listeners. Os 19 últimos
  dependem do primeiro (`dependsOn`), para o boot ordenar um grafo.
- Middlewares oficiais (`ignoreSelf`, `sanitize`), mais `rateLimit` por remetente com teto alto,
  `chatFilter` com uma lista de bloqueio e um middleware do app.
- Fila de saída com `globalIntervalMs` e `chatIntervalMs` em 0
  ([ADR 0047](../../docs/adr/0047-espera-na-fila-de-saida-fora-do-prazo.md)): a taxa anti-ban é
  política e dominaria a medida.

A carga alterna três mensagens em 500 chats: `!ping` (comando que responde), `oi` (um listener
responde) e um texto que nenhum plugin responde. Um listener espera um ciclo do event loop, como
um plugin que faz I/O. Cada mensagem tem remetente próprio.

No fim, o cenário confere a carga: mensagens processadas, nenhuma descartada, nenhum
`plugin.error`, nenhum envio perdido e o número de respostas esperado. Um plugin ignorado no
boot também falha o cenário. Se algo diverge, ele lança em vez de reportar uma medida de outra
coisa.

## Cenários

| Cenário | Meta | O que mede |
| --- | --- | --- |
| `overhead` | p99 < 1 ms | Uma mensagem por vez, do `emit` do transport até o `bot.settled()`: middlewares, roteador, listeners e fila de saída. 20 mil mensagens depois de 5 mil de aquecimento |
| `throughput` | ≥ 5.000 msg/s | Rajadas de 5 mil mensagens (10 por chat), esperando o bot assentar entre elas. 200 mil mensagens depois de 20 mil de aquecimento |
| `idle-memory` | < 80 MB | RSS do processo com o bot no ar e ocioso, depois de um `gc()` |
| `memory-growth` | < 5 MB | Heap depois de 1M mensagens menos o heap depois de 100 mil de aquecimento, ambos após `gc()` |
| `boot` | < 500 ms | Do `createBot` ao fim do `start()` com os 20 plugins, num processo frio (sem contar o `import`) |

Como ler as metas:

- **`memory-growth` < 5 MB** é o "~0" do plano. O remetente novo a cada mensagem faz um `Map`
  por remetente que nunca se limpa (o `rateLimiter` do legacy) crescer com a carga. Um objeto
  pequeno retido por mensagem já passa de 45 MB em 1M mensagens; a folga de 5 MB absorve o ruído
  do heap.
- **`idle-memory`** mede o processo inteiro. Cerca de 45 MB são do próprio Node. O bot vem do
  `@zapforge/testing/bot`, que não importa o Vitest: o entry principal o carrega para registrar
  os matchers, o que soma ~6 MB que não são do kernel. No runner do CI (Linux), o RSS fica uns
  10 MB acima do medido no Windows.
- **`overhead`** inclui o custo do `settled()`, então é um teto do overhead real.

O ruído de máquina compartilhada é compensado pelas execuções repetidas (mediana) e pela margem
de 10% do job de CI.

## Comparar com um baseline

Com `--baseline <arquivo>`, o runner lê o JSON gravado pelo `--out` de outra execução e, depois
de medir, compara cada cenário com a mesma medida no baseline. O comando sai com código 1 se um
cenário piorou mais de 10%. A piora é medida no sentido da meta: subir num teto (`overhead`,
`idle-memory`, `boot`), cair num piso (`throughput`).

```
Comparação com o baseline (tolerância 10%):
overhead       0.293 → 0.290 (-1.1% melhor) ok
boot           24.3 → 25.1 (+3.3% pior) ok
idle-memory    70.2 → 70.6 (+0.5% pior) ok
memory-growth  -0.231 → 0.104 (vale só a meta)
throughput     11233 (sem baseline)
```

- O `memory-growth` não entra na comparação (`checksRegression: false`). Perto de zero, 10% do
  baseline é menos que o ruído do heap. A meta de < 5 MB é a régua dele.
- Um cenário que o baseline não tem passa sem comparação.
- O arquivo é lido antes de medir: um caminho errado falha na hora.

Para medir o efeito de uma mudança na sua máquina, grave o baseline antes dela e compare depois:

```sh
git stash && pnpm bench --out base.json && git stash pop
pnpm bench --baseline base.json
```

## No CI

O job `Benchmark` (`.github/workflows/ci.yml`) mede o baseline no próprio runner
([ADR 0054](../../docs/adr/0054-baseline-do-benchmark.md)). Entre máquinas diferentes, a
variação passa dos 10%, então um baseline versionado ou de outro job não serviria.

1. Faz o build do primeiro pai do commit testado num `git worktree` e roda o benchmark com
   `--out`. No PR, o primeiro pai do merge commit é a ponta da base; no push, é o commit anterior.
2. Roda `pnpm bench --baseline` no commit testado.

O job falha se algum cenário ficar fora da meta ou piorar mais de 10%. Se a base não tem `bench/`,
vale só a meta. O log do passo `Benchmark` mostra a tabela da comparação.

Se o job falhar com uma piora que você não esperava, rode a mesma comparação localmente (acima)
antes de concluir que é ruído.

## Adicionar um cenário

1. Escreva a função em `src/scenarios.ts`. Ela sobe o bot com `createWorkload()`, mede e chama
   `finish()` com o total de mensagens e de respostas.
2. Registre em `SCENARIOS` com a unidade, a meta (`max` ou `min`) e o número de execuções.
3. Teste em `src/scenarios.test.ts` com uma carga pequena.
