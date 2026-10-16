# ADR 0003 — Tools da IA por ponto de extensão

**Status:** Aceito (2026-10-16)

## Contexto

Todos os plugins do app precisam poder ser chamados pela IA por function calling (#375,
pré-requisito do tool calling do #349). Se o plugin `ai` tivesse a lista de tools, cada plugin
novo mexeria nele, e ele importaria o código de todos. O ADR 0002 já resolve esse tipo de
variação com pontos de extensão do kernel.

## Decisão

1. **O ponto é `ai.tools`, sem dono.** O contrato mora em `src/plugins/ai-tools.ts`: o tipo
   `AiTool`, a declaração em `ExtensionPoints` e as funções puras que o consumidor usa. O módulo
   não depende do plugin `ai`. Diferente do ADR 0002 item 2, quem contribui **não** declara
   `dependsOn` no `ai`: o kernel aceita contribuição a um ponto que ninguém lê, então sem a IA a
   tool só fica parada, e desligar o plugin tira as tools dele.
2. **Cada plugin contribui as próprias tools no `setup`**, com `aiTool({...})` (só infere o tipo
   dos argumentos). O `run` chama a mesma regra do comando: o serviço do plugin ou as funções
   internas dele. Não chama o comando, porque o roteador não é exposto aos plugins.
3. **`args` é um schema Zod.** O consumidor valida antes do `run` e gera o JSON Schema dos
   parâmetros com `z.toJSONSchema`. Por isso o schema não usa `transform`.
4. **`requires` filtra a oferta.** `offeredTools(tools, capabilities)` tira a tool cujo transport
   não tem as capabilities dela. O `requires` do plugin continua valendo: plugin que não carrega
   não contribui.
5. **O resultado é para o modelo, nunca para o chat.** `run` devolve JSON (`ok()` ou
   `fail('código')`); o que o usuário recebe sai pelo `reply` do `AiToolContext`, que traz a
   mensagem de origem (chat, remetente, menções, mídia e citada), o `signal` e o `log`. O
   contexto não traz `send`: a tool roda dentro do plugin, que já tem o `ctx.send` dele.
6. **Erro esperado vira código; o resto, `failed`.** A tool traduz as recusas que conhece
   (`no-media`, `too-large`, o `code` do `ReminderError`). `invokeTool` devolve argumento
   inválido como `invalid-args` e qualquer outra exceção como `failed`, registrada no log, para o
   modelo poder explicar ou tentar de novo.

## Consequências

- O `ai` (#349) lê `ctx.services.extensionPoint('ai.tools').list()`, filtra com
  `offeredTools` e roda com `invokeTool`, sem lista no código.
- Os comandos e as tools dividem a regra; onde a regra estava dentro do comando (`!meunumero`,
  `!download`), ela saiu para uma função do plugin usada pelos dois.
- As tools não reagem com ⏳/✅/❌ como os comandos: o andamento é do `ai`, que já mostra que está
  respondendo.
- O consumidor de teste `ai-tools-probe.ts` (`!tool <nome> <json>`) prova cada tool antes de o
  `ai` existir.
- Nome e argumentos de uma tool são contrato com o prompt do modelo: mudar de forma
  incompatível segue o item 6 do ADR 0002.
