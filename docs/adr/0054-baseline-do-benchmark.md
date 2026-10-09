# ADR 0054 — Baseline do benchmark medido no mesmo job, a partir do commit base

**Status:** Aceito (2026-10-09) · Detalha **D30** ([ADR 0030](0030-metas-de-performance.md))

## Contexto

O D30 diz que o PR falha se regredir mais de 10%, mas não diz contra o quê. O M2-4.2 (#117) liga
o job de CI e precisa de um baseline. Havia três caminhos:

- **Baseline versionado**, um JSON no repositório atualizado à mão. Os números saem de uma
  máquina, e o runner do GitHub é outra. A diferença entre máquinas passa dos 10% e não diz nada
  sobre o código. O arquivo também envelhece: uma melhora que ninguém registra vira folga para a
  próxima piora.
- **Baseline do último push em `develop`**, guardado como artefato ou cache. É outro runner, com
  o mesmo problema de máquinas diferentes, e o job depende de um artefato que pode ter expirado.
- **Medir a base no mesmo job.** O job faz o build do commit base num `git worktree`, roda o
  benchmark nele e depois no commit testado. Os dois números saem da mesma máquina. O custo é
  rodar o benchmark duas vezes.

O `memory-growth` não cabe numa comparação relativa. A meta dele é "~0", e o valor medido fica
perto de zero, às vezes abaixo (-0,2 MB). Nesses valores, 10% do baseline é menos que o ruído
do heap, e a comparação falharia sem motivo.

## Decisão

- O job `Benchmark` mede o baseline no próprio runner. A base é o primeiro pai do commit
  testado. No PR, o checkout é o merge commit do GitHub, e o primeiro pai dele é a ponta da base.
  No push, é o commit anterior (`fetch-depth: 2`).
- O `pnpm bench --baseline <arquivo>` compara cada cenário com o relatório da base (o JSON do
  `--out`). O job falha se um cenário piorar mais de 10%, sempre no sentido da meta: subir num
  teto, cair num piso. Ele também falha se a medida do commit testado ficar fora da meta.
- O `memory-growth` é comparado só com a meta (< 5 MB), que já é a régua do "~0" com folga para o
  ruído. Cada cenário declara isso em `checksRegression`.
- Cenário novo, que a base ainda não tem, passa sem comparação. Se a base não tem `bench/` (um PR
  para a `main` antes do primeiro release do kernel), vale só a meta.

## Consequências

- O benchmark roda duas vezes por PR, e o job leva uns 10 minutos. Ele roda em paralelo com os
  outros jobs, sem `needs`.
- Nenhum arquivo de baseline para manter: uma melhora vira a nova régua no PR seguinte.
- A base e o commit testado rodam um depois do outro. Uma variação do runner no meio do job ainda
  pode passar de 10%. Se isso acontecer com frequência, o próximo passo é intercalar as execuções
  da base e do commit testado, em vez de alargar a tolerância.
- Uma piora lenta, de menos de 10% por PR, passa. A meta absoluta segura o acumulado.
