# ADR 0012 — Pipeline de 3 estágios

**Status:** Aceito (2026-10-06) · Decisão **D12** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

No LumaBot o `CommandRouter` é um `if` gigante com `includes()` (falsos positivos),
e os plugins são chamados em série com "o primeiro que retornar true". Isso cria
conflitos como Luma × Spontaneous, ambos querendo responder à mesma mensagem.

Alternativas consideradas: listeners em série com "primeiro que retornar true".

## Decisão

Cada mensagem passa por três estágios ([plano §5.3](../../ZAPFORGE_PLAN.md#53-fluxo-de-uma-mensagem)):

1. **Middlewares** em onion (estilo Koa), por prioridade: ignore-self, rate limit,
   allow/blocklist, sanitização, papéis custom.
2. **Comando**: match por token inicial exato; se casar, valida `role` e `accepts`,
   roda e **consome** a mensagem.
3. **Listeners** em paralelo, cada um com try/catch + timeout; `ctx.claim()` sinaliza
   aos de menor prioridade que alguém já respondeu.

## Consequências

- Performance com isolamento: listeners não esperam uns pelos outros.
- O conflito Luma × Spontaneous se resolve por `claim()` e prioridade.
- Listeners paralelos exigem que o plugin consulte `ctx.claimed` quando a resposta
  for exclusiva.
