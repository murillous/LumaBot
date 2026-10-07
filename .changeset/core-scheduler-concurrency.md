---
'@zapforge/core': patch
---

Scheduler com concorrência limitada (M1-11): no máximo `maxConcurrentJobs` handlers (padrão 10)
rodam ao mesmo tempo, e os vencidos esperam vaga em ordem de `fireAt`. Antes, depois de um
downtime longo, todos os vencidos disparavam de uma vez. A leitura dos vencidos passa a ser
paginada, e vencidos sem handler não travam os de trás. Quando a remoção de um job falha depois
do handler, o loop agora se rearma e o entrega de novo após `storageRetryMs`; antes, ele ficava
parado no storage até outro evento acordar o loop.
